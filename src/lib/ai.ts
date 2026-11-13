/**
 * Server-only AI layer: redaction guard → retrieval-grounded Gemini review → verifier.
 * The AI never sees confidential terms or personal data, and none of its findings reach the
 * user unless they cite a real rule and quote text that actually exists in the content.
 */
import "server-only";
import { retrieveRules, runRuleEngine, spanOverlap, uid } from "./engine";
import type { BrandKit, Finding, ReviewMeta, Rule, Severity } from "./types";

export const MODEL = process.env.GEMINI_MODEL || "gemini-3.1-flash-lite";
/** Tried in order when the primary model is retired (404), rate-limited (429), overloaded (503) or times out. */
const FALLBACKS = (process.env.GEMINI_FALLBACK_MODELS || "gemini-3.8-flash,gemini-3.5-flash")
  .split(",")
  .map((s) => s.trim())
  .filter((m) => m && m !== MODEL);
export const MODELS = [MODEL, ...FALLBACKS];
export const hasAI = () => Boolean(process.env.GEMINI_API_KEY);
/** Model that answered the most recent call (shown to users for transparency). */
export let lastModel = MODEL;

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
class GeminiError extends Error {
  constructor(public status: number, msg: string) {
    super(msg);
  }
}

async function callModel(model: string, key: string, parts: unknown[], schema: unknown, timeoutMs: number): Promise<any> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      signal: ctrl.signal,
      body: JSON.stringify({
        contents: [{ role: "user", parts }],
        generationConfig: {
          temperature: 0,
          responseMimeType: "application/json",
          responseSchema: schema,
          ...(model.includes("2.5") ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
        },
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      let msg = body.slice(0, 160);
      try {
        msg = JSON.parse(body)?.error?.message?.slice(0, 160) ?? msg;
      } catch {}
      throw new GeminiError(res.status, `${model} ${res.status}: ${msg}`);
    }
    const data = await res.json();
    const txt = (data?.candidates?.[0]?.content?.parts ?? []).map((p: any) => p.text ?? "").join("");
    return JSON.parse(txt);
  } catch (e: any) {
    if (e?.name === "AbortError") throw new GeminiError(408, `${model} timed out after ${Math.round(timeoutMs / 1000)}s`);
    throw e;
  } finally {
    clearTimeout(t);
  }
}

/**
 * Calls Gemini with an automatic fallback chain. Total time is capped (default 45 s) so the
 * request always finishes inside Vercel's 60 s function limit.
 */
async function gemini(parts: unknown[], schema: unknown, budgetMs = 45000): Promise<any> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("no key");
  const start = Date.now();
  const errors: string[] = [];
  for (let i = 0; i < MODELS.length; i++) {
    const left = budgetMs - (Date.now() - start);
    if (left < 4000) break;
    const per = i < MODELS.length - 1 ? Math.min(left, 15000) : left;
    try {
      const out = await callModel(MODELS[i], key, parts, schema, per);
      lastModel = MODELS[i];
      return out;
    } catch (e: any) {
      errors.push(String(e?.message ?? e));
      // Only fall through to the next model for availability problems; bad requests are bugs.
      if (e instanceof GeminiError && [404, 408, 429, 500, 503].includes(e.status)) continue;
      if (e instanceof SyntaxError) continue; // malformed JSON from the model: try another
      break;
    }
  }
  throw new Error(errors.join(" | ").slice(0, 300));
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
- "suggestion" will LITERALLY replace the quote in the text, character for character. The surrounding text stays as it is, so the result must read as correct, natural English. If your fix changes the sentence structure, quote the WHOLE sentence and return the whole rewritten sentence. Never repeat words that come just before or after the quote.
  Example: CONTENT "Our offer is guaranteed to double your money." → quote "Our offer is guaranteed to double your money." suggestion "Our offer gives you festive cashback (T&C apply)."
- The suggestion keeps the creator's goal and channel and matches the brand voice. Never invent numbers that are not in APPROVED FACTS.
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
const words = (s: string) => s.toLowerCase().match(/[a-z0-9']+/g) ?? [];

/**
 * Checks that a suggestion reads correctly when it literally replaces the quote.
 * Returns a reason string when it doesn't, or null when it fits.
 */
export function fitsInPlace(text: string, idx: number, quote: string, suggestion: string): string | null {
  const before = words(text.slice(Math.max(0, idx - 60), idx)).slice(-4);
  const after = words(text.slice(idx + quote.length, idx + quote.length + 60)).slice(0, 4);
  const sug = words(suggestion);
  if (!sug.length) return null;
  // repeated words at the seams, e.g. "This Diwali, " + "This Diwali, enjoy…"
  for (let n = Math.min(3, before.length, sug.length); n >= 1; n--) {
    const tail = before.slice(-n).join(" ");
    if (tail === sug.slice(0, n).join(" ") && tail.length >= 4) return `it would repeat "${tail}" from the text before it`;
  }
  for (let n = Math.min(3, after.length, sug.length); n >= 1; n--) {
    const head = after.slice(0, n).join(" ");
    if (head === sug.slice(-n).join(" ") && head.length >= 4) return `it would repeat "${head}" from the text after it`;
  }
  // the same meaningful word right next to the fix ("Download the app to download.")
  const near = new Set([...before.slice(-2), ...after.slice(0, 3)].filter((w) => w.length >= 5));
  const qset = new Set(words(quote));
  const echo = sug.find((w) => w.length >= 5 && near.has(w) && !qset.has(w));
  if (echo) return `"${echo}" would appear twice in a row`;
  // a very short quote replaced by a whole new sentence usually breaks the grammar around it
  const q = words(quote);
  if (q.length <= 2 && sug.length >= q.length + 4 && after.length > 0 && !/[.!?]\s*$/.test(quote)) {
    return "it rewrites more than the quoted words, so it would not fit the sentence";
  }
  return null;
}

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
    if (suggestion) {
      const misfit = fitsInPlace(text, idx, quote, suggestion);
      if (misfit) {
        dropped.push({ reason: `AI fix withheld: ${misfit}`, quote });
        suggestion = undefined;
      }
    }

    // merge with deterministic findings
    const twin = ruleFindings.find((f) => f.quote && (f.quote === quote || (f.ruleId === rule!.id && spanOverlap(text, f.quote, quote))));
    if (twin) {
      // Only attach the AI fix when it replaces the same text (or a span that contains the rule's quote),
      // otherwise the replacement would land on the wrong words.
      const compatible = twin.quote === quote || quote.includes(twin.quote);
      if (twin.suggestion === undefined && suggestion !== undefined && compatible) {
        twin.quote = quote;
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
    20000,
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
  const out = await gemini([{ text: prompt }], FINDINGS_SCHEMA, 35000);
  const raw: any[] = Array.isArray(out?.findings) ? out.findings : [];
  const { kept, dropped } = verify(raw, text, kit, rules, ruleFindings, red.restore);
  const meta: ReviewMeta = {
    mode: "hybrid",
    model: lastModel,
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
