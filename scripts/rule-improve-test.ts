// Checks the self-improving Brand Kit loop on the seeded demo history. Run: npx tsx scripts/rule-improve-test.ts
import { DEMO_KIT } from "../src/lib/seed";
import { runRuleEngine } from "../src/lib/engine";
import { heuristicRewrite, impactPreview, ruleStats, isUnclear, themesFrom, validatePatterns } from "../src/lib/ruleQuality";
import type { ContentItem } from "../src/lib/types";

// rebuild the 4 seeded history items (same texts/decisions as store.ts seedItems)
const defs = [
  { t: "Hurry! Weekend cashback on NovaPay UPI ends this Sunday. T&C apply.", d: ["rejected", "The offer genuinely ends on Sunday, so the urgency is factual."] },
  { t: "Join 3.1 lakh merchants who accept PayNova. Last chance to get zero onboarding fees this quarter (T&C apply).", d: ["rejected", "Quarter-end deadline is real and stated in the email."] },
  { t: "LAST CHANCE: Diwali rewards on PayNova. T&C apply.", d: ["accepted", ""] },
  { t: "PayNova makes UPI simple for students. Hurry, sign up before exams start!", d: ["rejected", "Exam season is a real deadline for this student campaign."] },
];
const items: ContentItem[] = defs.map((x, i) => {
  const findings = runRuleEngine(x.t, DEMO_KIT, { today: "2026-11-13" });
  const f = findings.find((y) => y.ruleId === "T-04")!;
  f.status = x.d[0] as any; f.reason = x.d[1] || undefined;
  return { id: "i" + i, title: "item " + i, versions: [{ n: 1, text: x.t, findings }], format: "text" } as any;
});
// plus a genuinely pushy one that must STILL be flagged
items.push({ id: "i9", title: "pushy", format: "text", versions: [{ n: 1, text: "Hurry, don't miss out on cashback! T&C apply.", findings: runRuleEngine("Hurry, don't miss out on cashback! T&C apply.", DEMO_KIT).map((f) => (f.ruleId === "T-04" ? { ...f, status: "accepted" as const } : f)) }] } as any);

const st = ruleStats(items, DEMO_KIT).find((s) => s.ruleId === "T-04")!;
console.log("T-04 stats:", st.decisions, "decisions, override rate", Math.round(st.overrideRate * 100) + "%", "unclear:", isUnclear(st));
console.log("themes:", themesFrom(st.reasons).map((t) => `${t.theme} (${t.count})`));
const prop = heuristicRewrite(DEMO_KIT.rules.find((r) => r.id === "T-04")!, st.reasons);
console.log("proposal:", prop.exceptionNote, "| patterns valid:", validatePatterns(prop.exceptionPatterns) ?? "yes");
const rule = { ...DEMO_KIT.rules.find((r) => r.id === "T-04")!, description: prop.description, exceptions: [{ note: prop.exceptionNote, patterns: prop.exceptionPatterns, scope: prop.scope }] };
const imp = impactPreview(items, DEMO_KIT, "T-04", rule);
console.log("before:", imp.before, "\nafter:", imp.after);
console.log("removed overrides:", imp.removedOverrides, "| accepted issues that would be missed:", imp.missedAccepted, "| new flags:", imp.added);
for (const r of imp.rows) console.log(`  ${r.effect.padEnd(7)} ${r.status.padEnd(8)} "${r.quote}" in "${r.sentence}"`);
