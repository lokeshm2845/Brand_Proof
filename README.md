# BrandProof — catch it before the world does

**Team VictoryVerse · CodeNova India 2026 · Problem statement by Inkloom AI**

BrandProof is a brand-governance platform. Before a post, email, document or ad creative goes live, it is checked
against the organisation's own **Brand Kit**: rules, approved terms, verified facts, colours and logos. Every issue
comes back with the rule or fact it breaks, a suggested fix that keeps the creator's purpose, and — for images —
a box on the exact spot. A role-based workflow (Creator → Brand reviewer → Legal) makes the final call. The AI never
approves anything.

- **Live:** https://novabrandproof.vercel.app/
- **Demo brand:** "PayNova" is fictional. No real company data is used.

---

## Try it in two minutes (no account needed)

1. Open the app → **Try it now with a sample post**. Nine issues appear instantly; AI findings join a few seconds later.
2. **Accept / Edit / Override** findings (overrides need a reason) → **Re-check & save new version** → **Submit for review**.
3. Top-right **Acting as** → *Rohan — Brand Manager* → **Approve as Brand**, then *Meera — Legal* → **Approve as Legal**.
   A printable **Brand Proof record** appears.
4. Home → **New · Visual compliance → Try the off-brand ad**: the retired logo, off-palette colours and a low-contrast
   line are boxed on the image. Also try the sample **PDF flyer** (New check → Upload document).
5. Home → **New · Self-improving Brand Kit → Improve rule T-04**: see why people override it, draft a clearer rule,
   preview its impact on all past content, switch to *Kabir — Brand Admin* and publish it.
6. **Team** → create an account and a workspace, copy an invite link, open it in another browser, and review together.

The demo sandbox lives in your browser (each visitor gets their own). **Reset demo** restores the sample data.

---

## What it does

| Area | Features |
|---|---|
| Brand Kit | Rules with IDs and severities, glossary, **Fact Vault** (value, outdated values, source, owner, re-verify date), colour palette, **logo library** (current and retired logos), confidential terms, competitor names; versioned on every save; AI import of a brand book into draft rules |
| Text checks | Deterministic rule engine (glossary, superlatives without a source, absolute guarantees, offers without T&C, competitor names, investment-advice language, slang, stacked !!, capitals, pressure tactics, numbers vs the Fact Vault incl. lakh/crore, long sentences, vague links) + Gemini reviewer for tone and messaging, grounded on retrieved rules and approved facts, behind a **verifier** that drops any AI finding without a real rule ID and an exact quote |
| **Visual compliance** | Logo detection (current / **retired** / **stretched** / **recoloured** / missing), OCR of every text block with WCAG **contrast** and **phone-size** checks, palette ΔE, alt text, **multi-page PDF** checks; findings are drawn as boxes on the creative |
| Workflow | Accept / edit / override with reason / undo, versions with word diff, submit gating, automatic **Legal** routing for claims, approve / request changes, comments, audit log, Brand Proof record |
| **Self-improving Brand Kit** | Rule quality table (fired / fixed / overridden), Guideline Gap Detector, override reasons grouped into themes, AI and keyword rewrite drafts **ranked by an impact preview** that re-runs the rule on every past version, rule exceptions, admin approval, before/after tracking |
| **Team workspaces** | Email + password accounts, workspaces, invite links per role, role management, shared items with **live updates**, optimistic concurrency (no lost updates), in-app notification bell, optional email notifications, **row-level security** in Postgres |
| Trust | PII and confidential-term redaction before any AI call, AI-use disclosure page, "How this was checked" tab on every check, graceful fallback when AI is busy or offline |

---

## Run it locally

Requirements: **Node.js 20+** and npm. (Python is only needed to regenerate the sample images.)

```bash
git clone https://github.com/lokeshm2845/Brand_Proof.git
cd Brand_Proof
npm install
cp .env.example .env.local     # all keys are optional — see below
npm run dev                    # http://localhost:3000
```

With **no keys** the app runs fully in rule-engine mode with the demo sandbox. Each key unlocks more:

| Variable | Unlocks | Where to get it |
|---|---|---|
| `GEMINI_API_KEY` | AI tone/messaging review, AI fixes, reading text from images, alt-text drafts, AI rule import and rule rewrites | https://aistudio.google.com → Get API key |
| `GEMINI_MODEL`, `GEMINI_FALLBACK_MODELS` | Model choice (default `gemini-3.1-flash-lite`, falls back to `gemini-3.8-flash`, `gemini-3.5-flash`) | — |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Team workspaces (accounts, shared review, live updates, notifications) | see "Team workspaces setup" |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | Email notifications (in-app notifications work without them) | e.g. Gmail App Password: host `smtp.gmail.com`, port `465` |

### Team workspaces setup (Supabase, ~10 minutes)
1. Create a project at https://supabase.com.
2. **SQL Editor → New query →** paste `supabase/schema.sql` → **Run**. It creates the tables, row-level-security
   policies, helper functions (`create_org`, `accept_invite`, `invite_info`) and enables realtime.
3. **Authentication → Sign In / Providers → Email:** turn off **Confirm email** (so new users can start immediately), save.
4. **Project Settings → API:** copy the Project URL and the `anon` public key into `.env.local`.
5. Restart `npm run dev`, open **Team**, create an account and a workspace.

### Deploy (Vercel)
Import the GitHub repo in Vercel (framework: Next.js, no build changes) and add the same environment variables.

---

## Tests and evaluation

```bash
npm test                 # text eval + AI verifier + fix-fit guard + rule-improvement checks
npm run eval             # text rule engine on 177 labelled cases (add -- --holdout for the 30-case holdout)
npm run eval:visual      # Visual Compliance Engine on 30 labelled creatives (downloads the OCR model once)
npm run test:verifier    # proves the verifier drops hallucinated AI output (mocked Gemini)
npm run test:fit         # AI fixes that would not read correctly in place are withheld
npm run test:rules       # self-improving Brand Kit: impact preview on the demo history
npm run test:team        # team workspaces against your Supabase project: 2-account review flow + RLS isolation
npm run test:ai-live     # live AI smoke test against a running server (needs GEMINI_API_KEY)
```

Results and their honest history (including first-run numbers before fixes) are in [`eval/RESULTS.md`](eval/RESULTS.md).

---

## Architecture

```
Browser (Next.js client)
 ├─ UI: workspace · review screen · Brand Kit · improve rule · insights · team
 ├─ Rule engine (src/lib/engine.ts)          ← same code runs on the server
 ├─ Visual engine (src/lib/vision.ts)        logo NCC matching, text-block contrast/size, colour bands
 │    └─ OCR: tesseract.js (in the browser) · PDF pages: unpdf → canvas
 ├─ Self-improving kit (src/lib/ruleQuality.ts)  stats, themes, impact preview
 ├─ State: Zustand → localStorage (demo) | Supabase (team: src/lib/team.ts, realtime + RLS)
 └─ calls ↓
Next.js API routes (Vercel serverless)
 ├─ /api/review        AI layer: redact → retrieve rules (TF-IDF) → Gemini (JSON schema) → verifier → merge
 ├─ /api/rule-rewrite  AI themes + rule rewrite (validated patterns; keyword fallback)
 ├─ /api/extract       DOCX (mammoth) / PDF (unpdf) text, in memory
 ├─ /api/extract-rules brand book → draft rules
 ├─ /api/notify        email notifications (queries as the user, so RLS applies)
 └─ /api/status        AI on/off
Supabase: Postgres (organizations, memberships, brand_kits, content_items, invites, notifications) + Auth + Realtime
```

Key files: `src/lib/engine.ts`, `src/lib/vision.ts`, `src/lib/visualRules.ts`, `src/lib/creative.ts`, `src/lib/ai.ts`,
`src/lib/ruleQuality.ts`, `src/lib/team.ts`, `src/lib/store.ts`, `supabase/schema.sql`, `src/app/content/[id]/page.tsx`.

## Known limitations
- The demo sandbox is per browser; use a team workspace to share work across devices.
- Text below about 1.5:1 contrast is too faint for OCR to read, so it cannot be measured.
- Logo detection expects the logo at 10–46% of the creative's width and roughly upright (no rotation).
- The rule engine is tuned for English and for the demo brand's patterns; new rules without patterns are checked by the AI layer only.
- Evaluation sets were written by the team with AI assistance, not by independent people.
- When Google's Gemini models are busy, AI findings may be missing for a check (a note says so; rule results always appear).

## Disclosures
Built during the CodeNova India 2026 build windows (Round 2: 13–16 Nov; Round 3: 18–21 Nov). Scaffolded with
`create-next-app`. AI coding assistance (Claude) was used during development; the team reviewed, tested and owns the code.
External services: Google Gemini API (optional), Supabase (optional), Vercel. Open-source libraries: Next.js, React,
Tailwind CSS, Zustand, lucide-react, jsdiff, mammoth, unpdf, tesseract.js, supabase-js, nodemailer (MIT/Apache-2.0).
