import { runRuleEngine, score, applyFix } from "../src/lib/engine";
import { DEMO_KIT, SAMPLES } from "../src/lib/seed";
for (const s of SAMPLES) {
  const f = runRuleEngine(s.text, DEMO_KIT, { today: "2026-11-13" });
  console.log("\n==", s.title, "score", score(f).total);
  for (const x of f) console.log(` [${x.severity}] ${x.ruleId} ${x.claimStatus??""} | "${x.quote}" -> ${JSON.stringify(x.suggestion)} | ${x.message}`);
  let t = s.text; for (const x of f) if (x.suggestion !== undefined) t = applyFix(t, x.quote, x.suggestion);
  console.log(" FIXED:", t);
}
