// Mocks the Gemini API to prove the verifier filters bad AI output. Run: npx tsx --conditions=react-server scripts/verifier-test.ts
process.env.GEMINI_API_KEY = "test-key";
import { DEMO_KIT, SAMPLES } from "../src/lib/seed";
import { runRuleEngine } from "../src/lib/engine";
const text = SAMPLES[1].text + " Contact me at aisha@paynova.in about Project Falcon.";
let sentPrompt = "";
const fake = { findings: [
  { rule_id: "M-01", quote: "Hi there,", issue: "Weak opening", explanation: "Does not lead with benefit", suggestion: "Hi there, here is a festive way to save,", severity: "low", confidence: 0.82 },
  { rule_id: "T-04", quote: "Hurry", issue: "False urgency", explanation: "x", suggestion: "Enjoy it", severity: "medium", confidence: 0.9 },
  { rule_id: "C-03", quote: "We are India's best wallet", issue: "invented quote", explanation: "x", severity: "high", confidence: 0.95 },
  { rule_id: "Z-99", quote: "Team PayNova", issue: "fake rule", explanation: "x", severity: "low", confidence: 0.9 },
  { rule_id: "T-01", quote: "Read more on our website.", issue: "unsure", explanation: "x", severity: "low", confidence: 0.3 },
  { rule_id: "M-04", quote: "double your money", issue: "advice", explanation: "x", suggestion: "guaranteed growth", severity: "high", confidence: 0.9 },
]};
(globalThis as any).fetch = async (_u: string, init: any) => { sentPrompt = JSON.parse(init.body).contents[0].parts[0].text;
  return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(fake) }] } }] }) } as any; };
(async () => {
  const { aiReview } = await import("../src/lib/ai");
  const rf = runRuleEngine(text, DEMO_KIT);
  const r = await aiReview(text, DEMO_KIT, { goal: "promote offer" }, rf);
  console.log("KEPT:", r.findings.map(f => `${f.ruleId} "${f.quote}" -> ${f.suggestion}`));
  console.log("DROPPED:", r.meta.aiDropped);
  console.log("REDACTIONS:", r.meta.redactions, "| prompt leaks email?", sentPrompt.includes("aisha@"), "| leaks Project Falcon?", sentPrompt.includes("Falcon"));
  console.log("T-04 rule finding now has AI fix:", rf.find(f => f.quote === "Hurry")?.suggestion, rf.find(f => f.quote === "Hurry")?.suggestionBy);
})();
