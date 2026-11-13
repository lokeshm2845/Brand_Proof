# BrandProof — catch it before the world does

**Team VictoryVerse · CodeNova India 2026 · Problem statement by Inkloom AI**

BrandProof is a brand-governance platform. Before a post, email, document or ad creative is published, it is checked against the organisation's own **Brand Kit** (rules, glossary, verified facts and colour palette). Every issue comes back with the rule or fact it breaks and a suggested fix that keeps the creator's purpose. Then a role-based workflow (Creator → Brand reviewer → Legal) decides. **A human always makes the final call.**

> Demo brand **PayNova** is fictional. The workspace is stored in your browser, so every visitor gets their own sandbox.

## Try it in 60 seconds (no login)
1. Open the app and click **"Try it now with a sample post"**.
2. Accept, edit or override the findings, then click **Re-check & save new version**.
3. Click **Submit for review**.
4. Switch **Acting as** (top right) to *Rohan — Brand Manager* and approve, then to *Meera — Legal* and approve.
5. A **Brand Proof record** appears. Open **Insights** to see recurring issues and the Guideline Gap Detector.

Other things to try: **New check → Off-brand ad creative (image)**, the downloadable sample `.docx` and `.pdf`, and **Brand Kit** (switch to *Kabir — Brand Admin* to edit rules or facts, or import guidelines).

## What is finished in this build
- **Brand Kit:** 17 rules, glossary, Fact Vault with source / owner / re-verify dates, palette, confidential terms. Versioned on every save.
- **AI rule import:** brand-book text is turned into draft rules that an admin must approve. A heuristic fallback runs when no AI key is set.
- **Content intake:** pasted text, DOCX, PDF (text extracted in memory, never stored) and PNG/JPG creatives.
- **Hybrid review engine:** deterministic rule engine (runs in the browser, results in under a second) → TF-IDF rule retrieval → Gemini reviewer with a JSON schema at temperature 0, running in the background → **verifier** (also withholds AI fixes that wouldn't read correctly in place). Results are merged into the same version when ready.
- **Model resilience:** `gemini-3.1-flash-lite` with an automatic fallback chain (`gemini-3.8-flash`, `gemini-3.5-flash`) on 404/429/503/timeout, capped at a 35 s budget.
- **Explainable findings:** severity, Rule-engine/AI badge, rule ID with explanation, claim status (supported / contradicted / outdated / unsupported), confidence, and a before→after fix.
- **Human decisions:** accept fix, edit fix, or override with a required reason. Undo is supported. Re-check creates a new version.
- **Image checks:** dominant colours vs the brand palette (CIE ΔE), contrast estimate, missing alt text. With AI enabled: reads the text on the creative and drafts alt text.
- **Workflow:** statuses, submit gating (no open HIGH issues), automatic Legal routing for claims and figures, approve / request changes, comments, version diff, audit log, and a printable Brand Proof record.
- **Brand Health Score:** 0–100 with a per-category breakdown.
- **Insights:** recurring issues by type, rule and channel; time to approval; fix acceptance rate; **Guideline Gap Detector** (rules overridden in 40%+ of 3 or more decisions).
- **Privacy:** emails, phone numbers, card / Aadhaar-like numbers, PAN and confidential terms are masked before any AI call. An "How AI is used" disclosure page is included.

## Architecture
```
Next.js 14 (App Router, TypeScript, Tailwind)  ── one deployable on Vercel
 ├─ UI (client): workspace, review screen, Brand Kit, insights   state: Zustand + localStorage
 │    └─ image colour analysis runs in the browser (canvas + CIE Lab ΔE)
 └─ API routes (server)
      /api/review         rule engine → redact → retrieve → Gemini → verifier → merge
      /api/extract        DOCX (mammoth) / PDF (unpdf) → text, in memory
      /api/extract-rules  brand book → draft rules (Gemini, or heuristic fallback)
      /api/status         reports whether AI mode is on
```
Key files: `src/lib/engine.ts` (rule engine, scoring, retrieval), `src/lib/ai.ts` (redaction, Gemini, verifier), `src/app/content/[id]/page.tsx` (review workflow).

## Run locally
```bash
npm install
cp .env.example .env.local     # optional: add GEMINI_API_KEY for hybrid mode
npm run dev                    # http://localhost:3000
npm run eval                   # rule-engine precision/recall on eval/testset.json
npm run test:verifier          # proves the verifier drops hallucinated AI output (mocked Gemini)
npm run test:fit               # unit tests for the "AI fix fits in place" guard
npm run test:ai-live           # live AI check against a running server (needs GEMINI_API_KEY)
```

## Measured quality
On our hand-labelled set of 36 cases (`eval/testset.json`), the rule engine scores **96.4% precision** and **100% recall**. We wrote these cases ourselves, so they are optimistic; a larger, independently written set is planned for Round 3.

## Disclosures
- Built during the official Round 2 window (13–16 Nov 2026).
- Scaffolded with `create-next-app`.
- AI coding assistance (Claude) was used during development; the team reviewed, tested and is responsible for all code.
- External services: Google Gemini API (optional), Vercel. Open-source libraries: Next.js, React, Tailwind CSS, Zustand, lucide-react, diff, mammoth, unpdf.
