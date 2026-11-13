/**
 * BrandProof deterministic rule engine.
 * Pure TypeScript, no network calls — runs identically in the browser and on the server,
 * so every "Rule engine" finding is 100% reproducible.
 */
import type {
  BrandKit,
  Category,
  Finding,
  ImageAnalysis,
  Rule,
  ScoreBreakdown,
  Severity,
} from "./types";

let counter = 0;
export const uid = (p = "f") =>
  `${p}_${Date.now().toString(36)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const routeFor = (c: Category): "brand" | "legal" =>
  c === "claims" || c === "facts" ? "legal" : "brand";

function mk(
  rule: Rule | undefined,
  partial: Partial<Finding> & { quote: string; message: string; category: Category },
): Finding {
  return {
    id: uid(),
    ruleId: rule?.id,
    severity: rule?.severity ?? "low",
    origin: "rule",
    explanation: rule ? `${rule.id} · ${rule.title}: ${rule.description}` : "",
    confidence: 1,
    routeTo: routeFor(partial.category),
    status: "open",
    ...partial,
  };
}

/** Extend a match to the end of its clause (max `maxWords` words). */
function clauseFrom(text: string, start: number, end: number, maxWords = 6) {
  let e = end;
  let words = text.slice(start, end).trim().split(/\s+/).length;
  while (e < text.length) {
    const ch = text[e];
    if (/[.,!?;:\n—(]/.test(ch)) break;
    if (ch === " ") {
      if (words >= maxWords) break;
      // look at next word: stop on conjunctions
      const rest = text.slice(e + 1);
      const next = rest.split(/\s+/)[0]?.toLowerCase() ?? "";
      if (["and", "but", "so", "because", "with", "to", "or"].includes(next)) break;
      words++;
    }
    e++;
  }
  // trim trailing space
  while (e > start && /\s/.test(text[e - 1])) e--;
  // include a leading article ("the #1 app") so replacements read naturally
  const before = text.slice(Math.max(0, start - 4), start);
  const art = before.match(/(?:^|\s)(the|a|an) $/i);
  const s2 = art ? start - art[1].length - 1 : start;
  return text.slice(s2, e);
}

function sentenceAround(text: string, idx: number) {
  let s = idx;
  while (s > 0 && !/[.!?\n]/.test(text[s - 1])) s--;
  while (s < idx && /\s/.test(text[s])) s++;
  let e = idx;
  while (e < text.length && !/[.!?\n]/.test(text[e])) e++;
  if (e < text.length && /[.!?]/.test(text[e])) e++;
  return { start: s, end: e, text: text.slice(s, e) };
}

const SUPERLATIVE_STEMS = ["fast", "best", "trust", "larg", "lead", "cheap", "number one", "#1"];

// ---------- number normalisation for fact checks ----------
export function toNumber(raw: string): number | null {
  const m = raw
    .toLowerCase()
    .replace(/,/g, "")
    .match(/(\d+(?:\.\d+)?)\s*(million|mn|m|lakh|lac|crore|cr|k)?/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  const mult: Record<string, number> = {
    million: 1e6, mn: 1e6, m: 1e6, lakh: 1e5, lac: 1e5, crore: 1e7, cr: 1e7, k: 1e3,
  };
  return n * (m[2] ? mult[m[2]] : 1);
}

const ALLOWED_CAPS = new Set([
  "UPI", "RBI", "EMI", "KYC", "ATM", "OTP", "PIN", "SMS", "NPCI", "FAQ", "GST", "PAN", "INR",
  "USD", "API", "PDF", "IMPS", "NEFT", "RTGS", "CEO", "CTO", "CFO", "APP", "QR", "USA", "UK", "EU",
  "DPDP", "SEBI", "IRDAI", "NBFC", "AI",
]);

export interface EngineOptions {
  isImage?: boolean;
  altText?: string;
  image?: ImageAnalysis;
  today?: string;
}

export function runRuleEngine(text: string, kit: BrandKit, opts: EngineOptions = {}): Finding[] {
  const out: Finding[] = [];
  const rules = kit.rules.filter((r) => r.status !== "draft");
  const R = (id: string) => rules.find((r) => r.id === id);
  const today = opts.today ?? new Date().toISOString().slice(0, 10);
  const taken: [number, number, string][] = []; // [start,end,ruleId]
  const overlaps = (s: number, e: number, ruleId?: string) =>
    taken.some(([a, b, r]) => s < b && e > a && (ruleId ? r === ruleId : true));

  // 1) Glossary (case-sensitive variants)
  const term = R("TERM-01");
  if (term) {
    for (const g of kit.glossary) {
      for (const v of g.variants) {
        const re = new RegExp(`(?<![A-Za-z])${esc(v)}(?![A-Za-z])`, "g");
        let m: RegExpExecArray | null;
        while ((m = re.exec(text))) {
          if (m[0] === g.preferred) continue;
          if (overlaps(m.index, m.index + m[0].length)) continue;
          taken.push([m.index, m.index + m[0].length, term.id]);
          out.push(
            mk(term, {
              category: "terminology",
              quote: m[0],
              message: `Use "${g.preferred}" instead of "${m[0]}"`,
              explanation: `${term.id} · Glossary ${g.id}: ${g.note ?? ""} The approved form is "${g.preferred}".`,
              suggestion: g.preferred,
            }),
          );
        }
      }
    }
  }

  // 2) Pattern-based rules
  for (const rule of rules) {
    if (!rule.patterns?.length) continue;
    for (const p of rule.patterns) {
      let re: RegExp;
      try {
        re = new RegExp(p, "gi");
      } catch {
        continue;
      }
      let m: RegExpExecArray | null;
      while ((m = re.exec(text))) {
        if (m[0].length === 0) {
          re.lastIndex++;
          continue;
        }
        const s = m.index;
        let e = s + m[0].length;
        if (overlaps(s, e, rule.id)) continue;

        let quote = m[0];
        let suggestion: string | undefined;
        let factId: string | undefined;
        let claimStatus: Finding["claimStatus"];
        let message = `${rule.title}`;

        if (rule.id === "C-03") {
          quote = clauseFrom(text, s, e, 6);
          const qs = text.indexOf(quote, Math.max(0, s - 5));
          e = qs + quote.length;
          if (overlaps(qs, e, rule.id)) continue;
          const lower = quote.toLowerCase();
          // Supported if an approved fact contains this claim
          const supporting = kit.facts.find(
            (f) =>
              f.value.toLowerCase().includes(lower) ||
              f.keywords.some((k) => lower.includes(k.toLowerCase()) && /fastest-growing|fastest growing/.test(lower)),
          );
          if (supporting) {
            continue;
          }
          claimStatus = "unsupported";
          message = `Unsupported claim: "${quote}"`;
          const stem = SUPERLATIVE_STEMS.find((st) => lower.includes(st));
          const fact = stem
            ? kit.facts.find((f) => f.value.toLowerCase().includes(stem.slice(0, 4)))
            : undefined;
          if (fact) {
            suggestion = fact.value;
            factId = fact.id;
          }
        } else if (rule.id === "C-05") {
          quote = m[0];
          claimStatus = "unsupported";
          message = `Absolute guarantee: "${quote}"`;
          const lower = quote.toLowerCase();
          const fact = kit.facts.find((f) => f.keywords.some((k) => lower.includes(k)));
          if (fact) {
            suggestion = `protected by ${fact.value}`;
            factId = fact.id;
          }
        } else if (rule.id === "T-01") {
          // remove slang together with the space before it
          let qs = s;
          while (qs > 0 && text[qs - 1] === " ") qs--;
          quote = text.slice(qs, e);
          suggestion = "";
          message = `Slang: "${m[0]}"`;
        } else if (rule.fix !== undefined) {
          suggestion = rule.fix;
          message = `${rule.title}`;
        }

        taken.push([s, e, rule.id]);
        out.push(
          mk(rule, {
            category: rule.category,
            quote,
            message,
            suggestion,
            factId,
            claimStatus,
          }),
        );
      }
    }
  }

  // 3) Shouting in capitals
  const caps = R("T-03");
  if (caps) {
    const re = /\b[A-Z][A-Z']{2,}(?:\s+[A-Z][A-Z']{2,})*\b/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      const words = m[0].split(/\s+/).filter((w) => !ALLOWED_CAPS.has(w.replace(/'/g, "")));
      if (!words.length) continue;
      if (kit.glossary.some((g) => g.preferred === m![0])) continue;
      if (overlaps(m.index, m.index + m[0].length, "TERM-01")) continue;
      const atStart = m.index === 0 || /[.!?\n]\s*$/.test(text.slice(0, m.index));
      const lower = m[0].toLowerCase();
      const suggestion = atStart ? lower[0].toUpperCase() + lower.slice(1) : lower;
      taken.push([m.index, m.index + m[0].length, caps.id]);
      out.push(
        mk(caps, {
          category: "tone",
          quote: m[0],
          message: `Shouting in capitals: "${m[0]}"`,
          suggestion,
        }),
      );
    }
  }

  // 4) Offers need T&C
  const tc = R("C-07");
  if (tc && /\b(cashback|rewards?|offer|free credit|discount)\b/i.test(text) && !/T&C apply|T&Cs apply|terms and conditions apply/i.test(text)) {
    const idx = text.search(/\b(cashback|rewards?|offer|free credit|discount)\b/i);
    const sen = sentenceAround(text, idx);
    const body = sen.text.replace(/[.!]+$/, "");
    const end = sen.text.slice(body.length) || ".";
    out.push(
      mk(tc, {
        category: "claims",
        quote: sen.text,
        message: "Offer mentioned without \"T&C apply\"",
        suggestion: `${body} (T&C apply)${end}`,
        claimStatus: "unsupported",
      }),
    );
  }

  // 5) Competitors
  const comp = R("M-03");
  if (comp) {
    for (const name of kit.competitorNames) {
      const re = new RegExp(
        `(?:\\b(?:unlike|better than|compared to|compared with|vs\\.?|than)\\s+)?(?<![A-Za-z])${esc(name)}(?![A-Za-z])(?:,\\s*)?`,
        "gi",
      );
      let m: RegExpExecArray | null;
      while ((m = re.exec(text))) {
        if (overlaps(m.index, m.index + m[0].length, comp.id)) continue;
        taken.push([m.index, m.index + m[0].length, comp.id]);
        const isComparison = /^(unlike|better than|compared|vs|than)/i.test(m[0]);
        out.push(
          mk(comp, {
            category: "messaging",
            quote: m[0],
            message: `Competitor named: ${name}`,
            suggestion: isComparison ? "" : undefined,
          }),
        );
      }
    }
  }

  // 6) Facts: counts & ratings vs the Fact Vault
  const fr = R("F-RULE");
  if (fr) {
    const countRe =
      /(\d[\d,]*(?:\.\d+)?\s?(?:million|mn|m|lakh|lac|crore|cr|k)?\+?)(\s+(?:registered\s+|happy\s+|active\s+|satisfied\s+)?)(users|customers|people|indians|merchants|stores|shops)\b/gi;
    const ratingRe = /(rated|rating of|rating)\s+(\d(?:\.\d)?)(\s*(?:stars?|★))?/gi;
    const checks: { quote: string; index: number; numStr: string; noun: string }[] = [];
    let m: RegExpExecArray | null;
    while ((m = countRe.exec(text))) checks.push({ quote: m[0], index: m.index, numStr: m[1], noun: m[3].toLowerCase() });
    while ((m = ratingRe.exec(text))) checks.push({ quote: m[0], index: m.index, numStr: m[2], noun: "rating" });

    for (const c of checks) {
      const fact = kit.facts.find((f) => f.keywords.some((k) => k.toLowerCase() === c.noun || (c.noun === "rating" && k === "rating")));
      if (!fact) {
        out.push(
          mk(fr, {
            category: "facts",
            quote: c.quote,
            message: `Figure with no approved source: "${c.quote}"`,
            claimStatus: "unsupported",
            severity: "medium",
          }),
        );
        continue;
      }
      const have = toNumber(c.numStr);
      const want = toNumber(fact.value);
      const approx = have !== null && want !== null && Math.abs(have - want) / Math.max(want, 1) < 0.001;
      if (approx) {
        if (fact.expiresOn < today) {
          out.push(
            mk(fr, {
              category: "facts",
              quote: c.quote,
              factId: fact.id,
              severity: "low",
              message: `Fact ${fact.id} is past its review date`,
              explanation: `${fact.id} · ${fact.label}: "${fact.statement}" was due for re-verification on ${fact.expiresOn} (owner: ${fact.owner}). The number matches, but confirm it is still true before publishing.`,
              claimStatus: "outdated",
            }),
          );
        }
        continue;
      }
      const isOld = (fact.previousValues ?? []).some((pv) => {
        const n = toNumber(pv);
        return n !== null && have !== null && Math.abs(n - have) / Math.max(n, 1) < 0.001;
      });
      const replaced = c.quote.replace(c.numStr.trim(), fact.value);
      out.push(
        mk(fr, {
          category: "facts",
          quote: c.quote,
          factId: fact.id,
          severity: isOld ? "medium" : "high",
          message: isOld ? `Outdated figure: "${c.numStr.trim()}"` : `Figure contradicts the Fact Vault: "${c.numStr.trim()}"`,
          explanation: `${fact.id} · ${fact.label}: the approved figure is "${fact.statement}" (source: ${fact.source}, verified ${fact.verifiedOn}).${isOld ? ` "${c.numStr.trim()}" was an older value.` : ""}`,
          suggestion: replaced,
          claimStatus: isOld ? "outdated" : "contradicted",
        }),
      );
    }
  }

  // 7) Long sentences
  const a1 = R("A-01");
  if (a1) {
    const sentences = text.match(/[^.!?\n]+[.!?]?/g) ?? [];
    for (const s of sentences) {
      const wc = s.trim().split(/\s+/).filter(Boolean).length;
      if (wc > 30) {
        out.push(
          mk(a1, {
            category: "accessibility",
            quote: s.trim(),
            message: `Long sentence (${wc} words)`,
          }),
        );
      }
    }
  }

  // 8) Images: alt text + palette + contrast
  if (opts.isImage) {
    const a3 = R("A-03");
    if (a3 && !opts.altText?.trim()) {
      out.push(
        mk(a3, {
          category: "accessibility",
          quote: "",
          message: "Creative has no alt text",
        }),
      );
    }
    const img = opts.image;
    if (img) {
      const v1 = R("V-01");
      const off = img.dominant.filter((d) => d.share >= 0.1 && d.deltaE > 25);
      if (v1 && off.length) {
        out.push(
          mk(v1, {
            category: "visual",
            quote: "",
            message: `${off.length} large colour area${off.length > 1 ? "s" : ""} outside the brand palette`,
            explanation: `${v1.id} · ${v1.title}: ${off
              .map((o) => `${o.hex} covers ${Math.round(o.share * 100)}% of the creative (closest brand colour: ${o.nearest}, ΔE ${o.deltaE.toFixed(0)})`)
              .join("; ")}. Colour difference above ΔE 25 is clearly visible.`,
            swatches: off.map((o) => o.hex),
          }),
        );
      }
      const v3 = R("V-03");
      if (v3 && img.contrastEstimate < 3) {
        out.push(
          mk(v3, {
            category: "visual",
            quote: "",
            confidence: 0.7,
            message: `Low contrast between main colours (${img.contrastEstimate.toFixed(1)}:1)`,
            explanation: `${v3.id} · ${v3.title}: the two dominant colours have an estimated contrast of ${img.contrastEstimate.toFixed(
              1,
            )}:1, below the WCAG AA target of 4.5:1. This is an estimate from the colour distribution, so a reviewer should confirm.`,
            swatches: img.dominant.slice(0, 2).map((d) => d.hex),
          }),
        );
      }
    }
  }

  return out;
}

// ---------- applying fixes ----------
export function applyFix(text: string, quote: string, replacement: string): string {
  const idx = text.indexOf(quote);
  if (idx < 0) return text;
  let next = text.slice(0, idx) + replacement + text.slice(idx + quote.length);
  if (replacement === "") {
    // re-capitalise if we removed the beginning of a sentence
    const before = next.slice(0, idx);
    if (idx === 0 || /[.!?\n]\s*$/.test(before)) {
      const ch = next[idx];
      if (ch && /[a-z]/.test(ch)) next = next.slice(0, idx) + ch.toUpperCase() + next.slice(idx + 1);
    }
    next = next.replace(/ {2,}/g, " ").replace(/ ([,.!?])/g, "$1");
  }
  return next;
}

// ---------- scoring ----------
export const BUCKETS: { key: string; label: string; weight: number; cats: Category[] }[] = [
  { key: "facts", label: "Facts & claims", weight: 30, cats: ["claims", "facts"] },
  { key: "tone", label: "Tone & messaging", weight: 20, cats: ["tone", "messaging"] },
  { key: "terminology", label: "Terminology", weight: 15, cats: ["terminology"] },
  { key: "visual", label: "Visual", weight: 20, cats: ["visual"] },
  { key: "accessibility", label: "Accessibility", weight: 15, cats: ["accessibility"] },
];
const SEV_POINTS: Record<Severity, number> = { high: 15, medium: 7, low: 3 };

export function score(findings: Finding[]): ScoreBreakdown {
  const byCategory: Record<string, number> = {};
  let total = 0;
  for (const b of BUCKETS) {
    const ded = findings
      .filter((f) => b.cats.includes(f.category) && f.status === "open")
      .reduce((a, f) => a + SEV_POINTS[f.severity], 0);
    const v = Math.max(0, b.weight - ded);
    byCategory[b.key] = v;
    total += v;
  }
  return { total: Math.round(total), byCategory };
}

// ---------- retrieval (TF-IDF) used to ground the AI reviewer ----------
const STOP = new Set("a an the and or of to in on for with is are be we our you your it this that as at by from not never no".split(" "));
const tok = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9#%\s]/g, " ").split(/\s+/).filter((w) => w.length > 1 && !STOP.has(w));

export function retrieveRules(text: string, rules: Rule[], k = 8): Rule[] {
  const docs = rules.map((r) => tok(`${r.title} ${r.description} ${r.doExample ?? ""} ${r.dontExample ?? ""}`));
  const df = new Map<string, number>();
  docs.forEach((d) => new Set(d).forEach((w) => df.set(w, (df.get(w) ?? 0) + 1)));
  const N = docs.length;
  const vec = (words: string[]) => {
    const tf = new Map<string, number>();
    words.forEach((w) => tf.set(w, (tf.get(w) ?? 0) + 1));
    const v = new Map<string, number>();
    tf.forEach((c, w) => v.set(w, c * Math.log(1 + N / (1 + (df.get(w) ?? 0)))));
    return v;
  };
  const q = vec(tok(text));
  const cos = (a: Map<string, number>, b: Map<string, number>) => {
    let dot = 0, na = 0, nb = 0;
    a.forEach((x, w) => { na += x * x; const y = b.get(w); if (y) dot += x * y; });
    b.forEach((y) => (nb += y * y));
    return na && nb ? dot / Math.sqrt(na * nb) : 0;
  };
  const scored = rules.map((r, i) => ({ r, s: cos(q, vec(docs[i])) }));
  const always = rules.filter((r) => r.category === "tone" || r.category === "messaging" || r.category === "claims");
  const top = scored.sort((a, b) => b.s - a.s).slice(0, k).map((x) => x.r);
  const set = new Map<string, Rule>();
  [...always, ...top].forEach((r) => set.set(r.id, r));
  return [...set.values()];
}

// ---------- readability ----------
export function readability(text: string) {
  const sentences = Math.max(1, (text.match(/[.!?]+/g) ?? []).length);
  const words = text.split(/\s+/).filter(Boolean);
  const syll = words.reduce((a, w) => a + Math.max(1, (w.toLowerCase().match(/[aeiouy]+/g) ?? []).length), 0);
  const wc = Math.max(1, words.length);
  const fre = 206.835 - 1.015 * (wc / sentences) - 84.6 * (syll / wc);
  return { words: words.length, sentences, fleschReadingEase: Math.round(fre) };
}

/** Overlap check used by the verifier to merge AI + rule findings. */
export function spanOverlap(text: string, a: string, b: string) {
  if (!a || !b) return false;
  const ia = text.indexOf(a);
  const ib = text.indexOf(b);
  if (ia < 0 || ib < 0) return false;
  return ia < ib + b.length && ib < ia + a.length;
}
