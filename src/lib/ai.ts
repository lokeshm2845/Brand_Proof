/**
 * Server-only AI layer: redaction guard → retrieval-grounded Gemini review → verifier.
 * The AI never sees confidential terms or personal data, and none of its findings reach the
 * user unless they cite a real rule and quote text that actually exists in the content.
 */
import "server-only";
import { retrieveRules, runRuleEngine, spanOverlap, uid } from "./engine";
import type { BrandKit, Finding, ReviewMeta, Rule, Severity } from "./types";

export const MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
export const hasAI = () => Boolean(process.env.GEMINI_API_KEY);

// ---------------- redaction ----------------
export function redact(text: string, kit: BrandKit) {
  const map: [string, string][] = [];
  let out = text;
  const patterns: RegExp[] = [
    /[\w.+-]+@[\w-]+\.[\w.]+/g, // emails
    /(?:\+91[\s-]?)?\b[6-9]\d{9}\b/g, // Indian mobile numbers
    /\b\d{4}\s?\d{4}\s?\d{4}\s?\d{4}\b/g, // card-like numbers
    /\b\d{4}\s?\d{4}\s?\d{4}\b/g, // Aadhaar-like numbers
    /\b[A-Z]{5}\d{4}[A-Z]\b/g, // PAN
  ];
  for (const term of kit.confidentialTerms.filter(Boolean)) {
    patterns.push(new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"));
  }
  for (const re of patterns) {
    out = out.replace(re, (m) => {
      const token = `[[R${map.length + 1}]]`;
      map.push([token, m]);
      return token;
    });
  }
  const restore = (s: string) => map.reduce((acc, [t, v]) => acc.split(t).join(v), s);
  return { text: out, count: map.length, restore };
}

// ---------------- Gemini call ----------------
async function gemini(parts: unknown[], schema: unknown, timeoutMs = 25000): Promise<any> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("no key");
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        signal: ctrl.signal,
        body: JSON.stringify({
          contents: [{ role: "user", parts }],
          generationConfig: {
            temperature: 0,
            responseMimeType: "application/json",
            responseSchema: schema,
            ...(MODEL.includes("2.5") ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
          },
        }),
      },
    );
    if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = await res.json();
    const txt = (data?.candidates?.[0]?.content?.parts ?? []).map((p: any) => p.text ?? "").join("");
    return JSON.parse(txt);
  } finally {
    clearTimeout(t);
  }
}

const FINDINGS_SCHEMA = {
  type: "OBJECT",
  properties: {
    findings: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          rule_id: { type: "STRING" },
          fact_id: { type: "STRING" },
          quote: { type: "STRING" },
          issue: { type: "STRING" },
          explanation: { type: "STRING" },
          suggestion: { type: "STRING" },
          severity: { type: "STRING", enum: ["high", "medium", "low"] },
          confidence: { type: "NUMBER" },
        },
        required: ["rule_id", "quote", "issue", "explanation", "severity", "confidence"],
      },
    },
  },
  required: ["findings"],
};

function buildPrompt(text: string, kit: BrandKit, rules: Rule[], intent: Intent, known: Finding[]) {
  const ruleLines = rules
    .map((r) => `- ${r.id} [${r.category}, ${r.severity}] ${r.title}: ${r.description}${r.doExample ? ` (Do: "${r.doExample}")` : ""}${r.dontExample ? ` (Don't: "${r.dontExample}")` : ""}`)
    .join("\n");
  const factLines = kit.facts.map((f) => `- ${f.id} ${f.label}: ${f.statement} (valid until ${f.expiresOn})`).join("\n");
  const glossary = kit.glossary.map((g) => `${g.preferred} (not: ${g.variants.join(", ")})`).join("; ");
  const knownLines = known.length
    ? known.map((f) => `- ${f.ruleId}: "${f.quote}"${f.suggestion === undefined ? " (NO FIX YET — you may propose one)" : ""}`).join("\n")
    : "- none";
  return `You are BrandProof, a careful brand-governance reviewer for the brand "${kit.brandName}".
Judge the CONTENT only against the BRAND RULES and APPROVED FACTS below. Do not use outside knowledge about the brand.

BRAND VOICE: ${kit.voice}

BRAND RULES (you may only cite these IDs):
${ruleLines}

APPROVED FACTS (the only acceptable source for numbers and claims):
${factLines}

GLOSSARY: ${glossary}

CREATOR INTENT — channel: ${intent.channel || "n/a"}; audience: ${intent.audience || "n/a"}; goal: ${intent.goal || "n/a"}.

ALREADY FOUND BY THE DETERMINISTIC RULE ENGINE:
${knownLines}

TASK:
1. Find additional brand issues the rule engine could not catch: tone that does not match the voice, weak or pushy messaging, claims that need an approved fact, misleading implications.
2. For items above marked "NO FIX YET", return a finding with the SAME rule_id and quote and a good suggestion.
3. Do not report anything that already complies. If the content is fine, return an empty list.

STRICT OUTPUT RULES:
- "quote" MUST be copied character-for-character from CONTENT (max 25 words). Never paraphrase it.
- "rule_id" MUST be one of the rule IDs listed above. Use "fact_id" when an approved fact is relevant.
- "suggestion" is a drop-in replacement for the quote that fixes the issue, keeps the creator's goal and channel, and matches the brand voice. Never invent numbers that are not in APPROVED FACTS.
- "confidence" is 0–1. Use below 0.6 when unsure.
- Placeholders like [[R1]] are redacted private data — keep them unchanged.

CONTENT:
"""
${text}
"""`;
}

export interface Intent {
  channel?: string;
  audience?: string;
  goal?: string;
}

// ---------------- verifier ----------------
function verify(
  raw: any[],
  text: string,
  kit: BrandKit,
  allowed: Rule[],
  ruleFindings: Finding[],
  restore: (s: string) => string,
) {
  const kept: Finding[] = [];
  const dropped: { reason: string; quote: string }[] = [];
  const allowedMap = new Map(allowed.map((r) => [r.id, r]));
  const allRules = new Map(kit.rules.map((r) => [r.id, r]));

  for (const r of raw) {
    let quote = restore(String(r.quote ?? "")).trim();
    const factId = r.fact_id && kit.facts.some((f) => f.id === r.fact_id) ? String(r.fact_id) : undefined;
    let rule = allowedMap.get(String(r.rule_id)) ?? allRules.get(String(r.rule_id));
    if (!rule && factId) rule = allRules.get("F-RULE");
    if (!rule) {
      dropped.push({ reason: `cited rule "${r.rule_id}" does not exist in the Brand Kit`, quote });
      continue;
    }
    if (!quote) {
      dropped.push({ reason: "no quote from the content", quote });
      continue;
    }
    let idx = text.indexOf(quote);
    if (idx < 0) {
      const li = text.toLowerCase().indexOf(quote.toLowerCase());
      if (li >= 0) {
        quote = text.slice(li, li + quote.length);
        idx = li;
      }
    }
    if (idx < 0) {
      dropped.push({ reason: "quoted text is not in the content (possible hallucination)", quote });
      continue;
    }
    const conf = Math.max(0, Math.min(1, Number(r.confidence) || 0));
    if (conf < 0.6) {
      dropped.push({ reason: `low confidence (${conf.toFixed(2)})`, quote });
      continue;
    }
    let suggestion: string | undefined = r.suggestion != null ? restore(String(r.suggestion)) : undefined;
    let note = "";
    if (suggestion !== undefined && suggestion.trim() === quote.trim()) suggestion = undefined;
    if (suggestion) {
      const reCheck = runRuleEngine(suggestion, kit).filter(
        (f) => (f.severity === "high" || f.severity === "medium") && f.category !== "accessibility" && f.ruleId !== "C-07",
      );
      if (reCheck.length) {
        note = ` (AI suggestion withheld: it would break ${reCheck.map((f) => f.ruleId).join(", ")})`;
        suggestion = undefined;
      }
    }

    // merge with deterministic findings
    const twin = ruleFindings.find((f) => f.quote && (f.quote === quote || (f.ruleId === rule!.id && spanOverlap(text, f.quote, quote))));
    if (twin) {
      if (twin.suggestion === undefined && suggestion !== undefined) {
        twin.suggestion = suggestion;
        twin.suggestionBy = "ai";
        dropped.push({ reason: "merged: AI supplied the fix for a rule-engine finding", quote });
      } else {
        dropped.push({ reason: "duplicate of a rule-engine finding", quote });
      }
      continue;
    }
    if (kept.some((k) => k.quote === quote && k.ruleId === rule!.id)) {
      dropped.push({ reason: "duplicate AI finding", quote });
      continue;
    }
    const sev: Severity = ["high", "medium", "low"].includes(r.severity) ? r.severity : rule.severity;
    kept.push({
      id: uid(),
      ruleId: rule.id,
      factId,
      category: rule.category,
      severity: sev,
      origin: "ai",
      quote,
      message: String(r.issue ?? rule.title).slice(0, 140),
      explanation: `${rule.id} · ${rule.title}: ${String(r.explanation ?? "")}${note}`,
      suggestion,
      suggestionBy: suggestion !== undefined ? "ai" : undefined,
      confidence: conf,
      routeTo: rule.category === "claims" || rule.category === "facts" ? "legal" : "brand",
      claimStatus: rule.category === "claims" ? "unsupported" : undefined,
      status: "open",
    });
  }
  return { kept, dropped };
}

// ---------------- vision: read text + draft alt text ----------------
const VISION_SCHEMA = {
  type: "OBJECT",
  properties: {
    text_in_image: { type: "STRING" },
    alt_text: { type: "STRING" },
  },
  required: ["text_in_image", "alt_text"],
};

export async function readCreative(dataUrl: string) {
  const m = dataUrl.match(/^data:(image\/[a-z+]+);base64,(.*)$/);
  if (!m) throw new Error("bad image");
  return gemini(
    [
      { inline_data: { mime_type: m[1], data: m[2] } },
      {
        text: "This is a marketing creative. 1) Transcribe ALL visible text exactly, in reading order, joining lines with spaces. 2) Write concise alt text (max 30 words) describing the creative for a screen-reader user. Return JSON.",
      },
    ],
    VISION_SCHEMA,
  );
}

// ---------------- main entry ----------------
const cache = new Map<string, { findings: Finding[]; meta: ReviewMeta }>();
const hash = (s: string) => {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
};

export async function aiReview(
  text: string,
  kit: BrandKit,
  intent: Intent,
  ruleFindings: Finding[],
): Promise<{ findings: Finding[]; meta: Partial<ReviewMeta> }> {
  const key = hash(text + "|" + kit.version + "|" + kit.updatedAt + "|" + JSON.stringify(intent));
  const hit = cache.get(key);
  if (hit) {
    // re-use AI result but keep fresh ids
    return { findings: hit.findings.map((f) => ({ ...f, id: uid() })), meta: { ...hit.meta, note: "AI result served from cache (same text + same Brand Kit version)" } };
  }
  const rules = retrieveRules(text, kit.rules.filter((r) => r.status !== "draft"));
  const red = redact(text, kit);
  const prompt = buildPrompt(red.text, kit, rules, intent, ruleFindings.filter((f) => f.quote));
  const out = await gemini([{ text: prompt }], FINDINGS_SCHEMA);
  const raw: any[] = Array.isArray(out?.findings) ? out.findings : [];
  const { kept, dropped } = verify(raw, text, kit, rules, ruleFindings, red.restore);
  const meta: ReviewMeta = {
    mode: "hybrid",
    model: MODEL,
    aiProposed: raw.length,
    aiKept: kept.length,
    aiDropped: dropped,
    redactions: red.count,
    ms: 0,
  };
  cache.set(key, { findings: kept, meta });
  if (cache.size > 200) cache.delete(cache.keys().next().value as string);
  return { findings: kept, meta };
}

// ---------------- rule extraction from a brand book ----------------
const RULES_SCHEMA = {
  type: "OBJECT",
  properties: {
    rules: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          category: { type: "STRING", enum: ["tone", "terminology", "claims", "facts", "messaging", "visual", "accessibility"] },
          title: { type: "STRING" },
          description: { type: "STRING" },
          severity: { type: "STRING", enum: ["high", "medium", "low"] },
          do_example: { type: "STRING" },
          dont_example: { type: "STRING" },
        },
        required: ["category", "title", "description", "severity"],
      },
    },
  },
  required: ["rules"],
};

export async function aiExtractRules(guideline: string) {
  const out = await gemini(
    [
      {
        text: `Convert this brand guideline text into atomic, checkable rules. One rule = one requirement. Keep the original meaning, do not invent requirements. Severity: high for legal/claims risks, medium for clear brand violations, low for style.\n\nGUIDELINE:\n"""\n${guideline.slice(0, 20000)}\n"""`,
      },
    ],
    RULES_SCHEMA,
    40000,
  );
  return (out?.rules ?? []) as any[];
}
