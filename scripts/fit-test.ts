// Unit checks for the "does the AI fix fit in place?" guard. Run: npx tsx --conditions=react-server scripts/fit-test.ts
process.env.GEMINI_API_KEY = "x";
(async () => {
  const { fitsInPlace } = await import("../src/lib/ai");
  const cases: [string, string, string, boolean][] = [
    ["Get cashback. Click here to download.", "Click here", "Download the PayNova app", false],
    ["This Diwali, LAST CHANCE to grab cashback", "LAST CHANCE", "This Diwali, enjoy cashback", false],
    ["Our offer is guaranteed to double your money.", "guaranteed", "earn cashback on your transactions", false],
    ["Paynova is the best app.", "Paynova", "PayNova", true],
    ["Hurry, don't miss out — our offer ends soon.", "Hurry, don't miss out", "Explore our festive offer", false],
    ["Hurry, don't miss out — our offer ends Sunday.", "Hurry, don't miss out", "Take a look", true],
    ["Get cashback. Click here to download.", "Click here", "Tap the link below", true],
  ];
  let ok = 0;
  for (const [t, q, s, expectFit] of cases) {
    const r = fitsInPlace(t, t.indexOf(q), q, s);
    const pass = (r === null) === expectFit;
    ok += pass ? 1 : 0;
    console.log(pass ? "PASS" : "FAIL", `"${q}" -> "${s}"`, r ?? "fits");
  }
  console.log(`${ok}/${cases.length} passed`);
})();
