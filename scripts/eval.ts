// Measures the deterministic rule engine on a hand-labelled test set. Run: npx tsx scripts/eval.ts
import { readFileSync } from "fs";
import { runRuleEngine } from "../src/lib/engine";
import { DEMO_KIT } from "../src/lib/seed";
const cases: { text: string; expect: string[] }[] = JSON.parse(readFileSync("eval/testset.json", "utf8"));
let tp = 0, fp = 0, fn = 0; const misses: string[] = [];
const per: Record<string, { tp: number; fp: number; fn: number }> = {};
const bump = (r: string, k: "tp" | "fp" | "fn") => ((per[r] ??= { tp: 0, fp: 0, fn: 0 })[k]++);
for (const c of cases) {
  const got = new Set(runRuleEngine(c.text, DEMO_KIT, { today: "2026-11-13" }).map((f) => f.ruleId!));
  const exp = new Set(c.expect);
  got.forEach((r) => (exp.has(r) ? (tp++, bump(r, "tp")) : (fp++, bump(r, "fp"), misses.push(`FP ${r}: ${c.text}`))));
  exp.forEach((r) => { if (!got.has(r)) { fn++; bump(r, "fn"); misses.push(`FN ${r}: ${c.text}`); } });
}
const P = tp / (tp + fp), R = tp / (tp + fn);
console.log(`cases=${cases.length} tp=${tp} fp=${fp} fn=${fn} precision=${(P*100).toFixed(1)}% recall=${(R*100).toFixed(1)}% f1=${((2*P*R/(P+R))*100).toFixed(1)}%`);
console.log(Object.entries(per).map(([r, v]) => `${r}: tp ${v.tp} fp ${v.fp} fn ${v.fn}`).join("\n"));
console.log(misses.join("\n"));
