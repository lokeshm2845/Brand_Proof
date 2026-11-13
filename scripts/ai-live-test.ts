// Live AI-mode smoke test against a running server. Run: npx tsx scripts/ai-live-test.ts [baseUrl]
import { DEMO_KIT, SAMPLES } from "../src/lib/seed";
import { applyFix } from "../src/lib/engine";
const base = process.argv[2] ?? "http://localhost:3005";
(async () => {
  for (const s of SAMPLES) {
    const t = Date.now();
    const r = await fetch(`${base}/api/review`, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: s.text, kit: DEMO_KIT, intent: { channel: s.channel, audience: s.audience, goal: s.goal } }) });
    const j: any = await r.json();
    console.log(`\n== ${s.title} | HTTP ${r.status} | ${Date.now() - t} ms | mode ${j.meta?.mode} | AI proposed ${j.meta?.aiProposed} kept ${j.meta?.aiKept}${j.meta?.note ? " | note: " + j.meta.note : ""}`);
    for (const f of j.findings) console.log(`  ${f.origin.padEnd(4)} ${String(f.ruleId).padEnd(7)} ${JSON.stringify(f.quote).slice(0, 55)} -> ${JSON.stringify(f.suggestion)?.slice(0, 70)}${f.suggestionBy === "ai" ? " (AI fix)" : ""}${f.origin === "ai" ? ` [${Math.round(f.confidence * 100)}%] ${f.message}` : ""}`);
    for (const f of j.findings.filter((x: any) => x.suggestionBy === "ai" && x.quote)) {
      const out = applyFix(s.text, f.quote, f.suggestion);
      const i = out.indexOf(f.suggestion);
      console.log(`    APPLIED ${f.ruleId}: …${out.slice(Math.max(0, i - 40), i + f.suggestion.length + 40).split("\n").join(" ")}…`);
    }
    for (const d of j.meta?.aiDropped ?? []) console.log(`  dropped: ${d.reason} | ${d.quote.slice(0, 50)}`);
  }
})();
