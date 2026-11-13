"use client";
import { useAIStatus } from "@/components/Shell";

export default function AIDisclosure() {
  const s = useAIStatus();
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <h1 className="text-2xl font-bold">How BrandProof uses AI</h1>
        <p className="text-sm text-slate-500">Transparency is part of the product. This page states what is automated, what is not, and where your data goes.</p>
      </div>

      <div className="card p-5">
        <p className="label">On this deployment right now</p>
        <p className="text-lg font-semibold">
          {s === null ? "Checking…" : s.ai ? `Hybrid mode — rule engine + ${s.model} + verifier` : "Rule-engine mode — no AI model is called"}
        </p>
      </div>

      <Section title="Two kinds of checks, always labelled">
        <p><b>Rule engine</b> findings come from deterministic code: glossary matching, banned and absolute claims, figures compared against the Fact Vault, capitals, offers without “T&amp;C apply”, competitor names, sentence length, alt text, colour palette (ΔE) and contrast. They are 100% reproducible.</p>
        <p><b>AI</b> findings come from Google Gemini and cover what code cannot judge well: tone against the brand voice, weak or pushy messaging, implied claims. The AI also drafts fixes for rule-engine findings that have none, reads text from image creatives and drafts alt text.</p>
      </Section>

      <Section title="How we stop the AI from making things up">
        <ol className="ml-5 list-decimal space-y-1">
          <li>The AI is given only the rules most relevant to the content (TF-IDF retrieval) plus the approved facts. It is told not to use outside knowledge.</li>
          <li>It must answer in a fixed JSON schema at temperature 0: rule ID, exact quote, issue, explanation, suggestion, confidence.</li>
          <li>The <b>verifier</b> drops any finding that cites a rule not in the Brand Kit, quotes text that is not in the content, or has confidence below 0.6.</li>
          <li>Every AI suggestion is re-run through the rule engine. A suggestion that would introduce a new violation is withheld.</li>
          <li>Each check shows exactly what the verifier removed and why, under “How this was checked”.</li>
        </ol>
      </Section>

      <Section title="Humans stay in control">
        <ul className="ml-5 list-disc space-y-1">
          <li>Nothing is changed automatically. Every fix is accepted, edited or overridden by a person.</li>
          <li>Overrides need a written reason and go into the audit log.</li>
          <li>The AI can never approve content. Only Brand and Legal reviewers can, and content with claims or figures always needs Legal sign-off.</li>
        </ul>
      </Section>

      <Section title="Privacy and confidentiality">
        <ul className="ml-5 list-disc space-y-1">
          <li>Before any AI call, emails, phone numbers, card / Aadhaar-like numbers, PAN numbers and the Brand Kit&apos;s confidential terms are replaced with placeholders. They are restored only in your browser&apos;s results.</li>
          <li>Colour analysis of images runs entirely in your browser.</li>
          <li>Uploaded DOCX/PDF files are read in memory and never stored on the server.</li>
          <li>In this Round 2 build, your workspace (content, brand kit, comments, audit log) is stored only in your own browser (localStorage). Nothing is saved on our server.</li>
          <li>External services used: Google Gemini API (when enabled) and Vercel hosting. The PayNova brand is fictional demo data.</li>
        </ul>
      </Section>

      <Section title="Known limits">
        <ul className="ml-5 list-disc space-y-1">
          <li>The AI can still miss issues or misjudge tone. That is why its findings show a confidence score and a human always decides.</li>
          <li>Image contrast is estimated from the two dominant colours, not from the exact text region.</li>
          <li>The rule engine is tuned for English.</li>
        </ul>
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card space-y-2 p-5 text-sm leading-relaxed text-slate-700">
      <h2 className="text-base font-bold text-ink">{title}</h2>
      {children}
    </div>
  );
}
