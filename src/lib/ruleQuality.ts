/**
 * Self-improving Brand Kit (Round 3, Improvement 3) — pure functions, no network.
 *  - ruleStats: how each rule performs (fired / accepted / edited / overridden)
 *  - themesFrom: groups reviewers' override reasons into themes (keyword fallback when AI is off)
 *  - heuristicRewrite: a starting exception when reasons point at real deadlines/dates
 *  - impactPreview: re-runs a proposed rule on every past version and shows exactly what changes
 */
import { runRuleEngine } from "./engine";
import type { BrandKit, ContentItem, Finding, FindingStatus, Rule } from "./types";

export interface RuleStat {
  ruleId: string;
  title: string;
  fired: number;
  accepted: number;
  edited: number;
  overridden: number;
  open: number;
  decisions: number;
  overrideRate: number;
  reasons: string[];
}

/** Every finding the rule produced in every version (decided or still open). */
export function ruleStats(items: ContentItem[], kit: BrandKit): RuleStat[] {
  const map = new Map<string, RuleStat>();
  const get = (id: string) => {
    if (!map.has(id)) {
      const r = kit.rules.find((x) => x.id === id);
      map.set(id, { ruleId: id, title: r?.title ?? id, fired: 0, accepted: 0, edited: 0, overridden: 0, open: 0, decisions: 0, overrideRate: 0, reasons: [] });
    }
    return map.get(id)!;
  };
  for (const it of items)
    for (const v of it.versions)
      for (const f of v.findings) {
        if (!f.ruleId) continue;
        const s = get(f.ruleId);
        s.fired++;
        if (f.status === "accepted") s.accepted++;
        else if (f.status === "edited") s.edited++;
        else if (f.status === "rejected") {
          s.overridden++;
          if (f.reason) s.reasons.push(f.reason);
        } else s.open++;
      }
  for (const s of map.values()) {
    s.decisions = s.accepted + s.edited + s.overridden;
    s.overrideRate = s.decisions ? s.overridden / s.decisions : 0;
  }
  return [...map.values()].sort((a, b) => b.fired - a.fired);
}

/** Rules people keep overriding: 3+ decisions and 40%+ overridden. */
export const isUnclear = (s: RuleStat) => s.decisions >= 3 && s.overrideRate >= 0.4;

const STOP = new Set(
  "the a an and or of to in on for with is are was be it this that as at by from our we us they their its not no so but if then than there here have has had do does did really actually just very".split(" "),
);
const STEMS: [RegExp, string][] = [
  [/\b(deadline|ends?|ending|until|till|date|sunday|monday|tuesday|wednesday|thursday|friday|saturday|quarter|month|week|season|exams?|diwali|expires?)\b/i, "There is a real, stated deadline or date"],
  [/\b(design|headline|banner|style|visual|layout|caps|capital)\b/i, "It is an intentional design or style choice"],
  [/\b(legal|approved|compliance|regulator|rbi|sebi)\b/i, "Legal or compliance already approved it"],
  [/\b(factual|true|accurate|correct|verified)\b/i, "The statement is factually true"],
  [/\b(internal|staff|employees|team)\b/i, "The content is internal, not public"],
];

export interface Theme {
  theme: string;
  count: number;
  examples: string[];
}

export function themesFrom(reasons: string[]): Theme[] {
  const groups = new Map<string, string[]>();
  for (const r of reasons) {
    const hit = STEMS.find(([re]) => re.test(r));
    let key = hit?.[1];
    if (!key) {
      const words = r.toLowerCase().match(/[a-z]{4,}/g)?.filter((w) => !STOP.has(w)) ?? [];
      key = words.length ? `Mentions “${words[0]}”` : "Other";
    }
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  return [...groups.entries()].map(([theme, ex]) => ({ theme, count: ex.length, examples: ex.slice(0, 4) })).sort((a, b) => b.count - a.count);
}

/** Date/deadline expressions used when overrides say "the deadline is real". */
export const DEADLINE_PATTERNS = [
  "\\b(ends?|ending|until|till|before|by|valid (till|until))\\s+(this\\s+|next\\s+|on\\s+)?(mon|tues|wednes|thurs|fri|satur|sun)day\\b",
  "\\b(ends?|ending|until|till|before|by)\\s+(on\\s+)?\\d{1,2}(st|nd|rd|th)?\\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\\b",
  "\\b(ends?|ending|until|till|by)\\s+(the\\s+)?(end of\\s+)?(this|the)\\s+(week|month|quarter)\\b",
  "\\bthis\\s+quarter\\b",
  "\\bbefore\\s+[a-z]+\\s+(start|starts|begin|begins)\\b",
];

export interface Proposal {
  title: string;
  description: string;
  exceptionNote: string;
  exceptionPatterns: string[];
  scope: "sentence" | "content";
  source: "ai" | "heuristic";
}

export function heuristicRewrite(rule: Rule, reasons: string[]): Proposal {
  const themes = themesFrom(reasons);
  const top = themes[0]?.theme ?? "";
  if (/deadline or date/.test(top)) {
    return {
      title: rule.title,
      description: `${rule.description.replace(/\s*unless.*$/i, "").replace(/\.$/, "")} — unless the content states a real end date or deadline (for example "ends this Sunday" or "before exams start").`,
      exceptionNote: "Allowed when the content states a genuine end date or deadline.",
      exceptionPatterns: DEADLINE_PATTERNS,
      scope: "content",
      source: "heuristic",
    };
  }
  return {
    title: rule.title,
    description: rule.description,
    exceptionNote: top ? `Allowed when: ${top.toLowerCase()} (write a pattern that recognises it).` : "",
    exceptionPatterns: [],
    scope: "sentence",
    source: "heuristic",
  };
}

export function validatePatterns(patterns: string[]): string | null {
  for (const p of patterns) {
    if (!p.trim()) continue;
    try {
      const re = new RegExp(p, "i");
      if (re.test("")) return `Pattern "${p}" matches empty text, so it would switch the rule off everywhere.`;
    } catch (e: any) {
      return `Pattern "${p}" is not a valid regular expression: ${e.message}`;
    }
  }
  return null;
}

export interface ImpactRow {
  itemId: string;
  title: string;
  version: number;
  quote: string;
  sentence: string;
  status: FindingStatus;
  effect: "removed" | "kept" | "added";
}
export interface Impact {
  rows: ImpactRow[];
  before: { flags: number; overridden: number; accepted: number; overrideRate: number };
  after: { flags: number; overridden: number; accepted: number; overrideRate: number };
  removedOverrides: number;
  missedAccepted: number;
  added: number;
}

const decidedOk = (s: FindingStatus) => s === "accepted" || s === "edited";

/** Re-runs the rule engine with a proposed version of one rule on every past version of every item. */
export function impactPreview(items: ContentItem[], kit: BrandKit, ruleId: string, proposed: Rule): Impact {
  const newKit: BrandKit = { ...kit, rules: kit.rules.map((r) => (r.id === ruleId ? proposed : r)) };
  const oldKit: BrandKit = kit;
  const rows: ImpactRow[] = [];
  for (const it of items) {
    for (const v of it.versions) {
      const opts = { isImage: it.format === "image", altText: it.altText, image: it.imageAnalysis, pages: it.pages };
      const nowOld = runRuleEngine(v.text, oldKit, opts).filter((f) => f.ruleId === ruleId);
      const nowNew = runRuleEngine(v.text, newKit, opts).filter((f) => f.ruleId === ruleId);
      const recorded = v.findings.filter((f) => f.ruleId === ruleId && f.origin === "rule");
      // The recorded findings carry the human decision; match them to the re-run by quote.
      const base: Finding[] = recorded.length ? recorded : nowOld;
      for (const f of base) {
        const still = nowNew.some((n) => n.quote === f.quote);
        rows.push({ itemId: it.id, title: it.title, version: v.n, quote: f.quote, sentence: sentenceOfText(v.text, f.quote), status: f.status, effect: still ? "kept" : "removed" });
      }
      for (const n of nowNew)
        if (!base.some((f) => f.quote === n.quote))
          rows.push({ itemId: it.id, title: it.title, version: v.n, quote: n.quote, sentence: sentenceOfText(v.text, n.quote), status: "open", effect: "added" });
    }
  }
  const tally = (rs: ImpactRow[]) => {
    const overridden = rs.filter((r) => r.status === "rejected").length;
    const accepted = rs.filter((r) => decidedOk(r.status)).length;
    return { flags: rs.length, overridden, accepted, overrideRate: overridden + accepted ? overridden / (overridden + accepted) : 0 };
  };
  const before = tally(rows.filter((r) => r.effect !== "added"));
  const after = tally(rows.filter((r) => r.effect !== "removed"));
  return {
    rows,
    before,
    after,
    removedOverrides: rows.filter((r) => r.effect === "removed" && r.status === "rejected").length,
    missedAccepted: rows.filter((r) => r.effect === "removed" && decidedOk(r.status)).length,
    added: rows.filter((r) => r.effect === "added").length,
  };
}

function sentenceOfText(text: string, quote: string) {
  if (!quote) return "";
  const i = text.indexOf(quote);
  if (i < 0) return quote;
  let s = i;
  while (s > 0 && !/[.!?\n]/.test(text[s - 1])) s--;
  let e = i + quote.length;
  while (e < text.length && !/[.!?\n]/.test(text[e])) e++;
  return text.slice(s, Math.min(text.length, e + 1)).trim();
}
