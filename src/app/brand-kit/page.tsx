"use client";
import { useEffect, useState } from "react";
import { AlertTriangle, Loader2, Lock, Plus, Save, Trash2, Wand2 } from "lucide-react";
import { useStore } from "@/lib/store";
import { personFor } from "@/lib/seed";
import { CATEGORY_LABEL, SeverityTag, timeAgo } from "@/components/ui";
import type { BrandKit, Category, Rule, Severity } from "@/lib/types";

type Tab = "rules" | "glossary" | "facts" | "visual" | "import" | "settings";
const CATS = Object.keys(CATEGORY_LABEL) as Category[];
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

export default function BrandKitPage() {
  const kit = useStore((s) => s.kit);
  const history = useStore((s) => s.kitHistory);
  const role = useStore((s) => s.role);
  const saveKit = useStore((s) => s.saveKit);
  const isAdmin = role === "admin";
  const [tab, setTab] = useState<Tab>("rules");
  const [k, setK] = useState<BrandKit>(clone(kit));
  const [note, setNote] = useState("");
  const [saved, setSaved] = useState<string | null>(null);
  useEffect(() => setK(clone(kit)), [kit]);
  const dirty = JSON.stringify(k) !== JSON.stringify(kit);
  const today = new Date().toISOString().slice(0, 10);
  const expired = kit.facts.filter((f) => f.expiresOn < today);

  const save = () => {
    saveKit(k, note.trim() || "Edited Brand Kit");
    setNote("");
    setSaved(`Saved as Brand Kit v${kit.version + 1}. New checks use it immediately; existing items show a re-check notice.`);
    setTimeout(() => setSaved(null), 5000);
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <h1 className="text-2xl font-bold">{kit.brandName} Brand Kit <span className="text-base font-medium text-slate-400">v{kit.version}</span></h1>
          <p className="text-sm text-slate-500">The single source of truth every check uses: rules, approved terms, verified facts and visual identity.</p>
        </div>
        {!isAdmin && (
          <span className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-slate-100 px-3 py-2 text-xs text-slate-600">
            <Lock size={13} /> Read-only — switch to Kabir (Brand Admin) to edit
          </span>
        )}
      </div>

      {expired.length > 0 && (
        <div className="flex gap-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-800">
          <AlertTriangle size={16} className="shrink-0" />
          {expired.length} approved fact{expired.length > 1 ? "s are" : " is"} past the review date: {expired.map((f) => `${f.id} ${f.label} (owner: ${f.owner})`).join(", ")}. Content quoting {expired.length > 1 ? "them" : "it"} is flagged for re-verification.
        </div>
      )}

      <div className="flex flex-wrap gap-1 border-b text-sm">
        {([
          ["rules", `Rules (${k.rules.length})`],
          ["glossary", `Glossary (${k.glossary.length})`],
          ["facts", `Fact Vault (${k.facts.length})`],
          ["visual", "Visual identity"],
          ["import", "Import guidelines (AI)"],
          ["settings", "Voice, privacy & history"],
        ] as [Tab, string][]).map(([t, l]) => (
          <button key={t} onClick={() => setTab(t)} className={`-mb-px border-b-2 px-3 py-2 ${tab === t ? "border-nova font-semibold text-nova" : "border-transparent text-slate-500"}`}>
            {l}
          </button>
        ))}
      </div>

      {tab === "rules" && <RulesTab k={k} setK={setK} edit={isAdmin} />}
      {tab === "glossary" && (
        <div className="card overflow-x-auto p-4">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-slate-500">
              <tr><th className="p-2">ID</th><th className="p-2">Approved term</th><th className="p-2">Flag these variants (comma-separated)</th><th className="p-2">Note</th><th /></tr>
            </thead>
            <tbody>
              {k.glossary.map((g, i) => (
                <tr key={g.id} className="border-t align-top">
                  <td className="p-2 font-mono text-xs">{g.id}</td>
                  <td className="p-2"><input disabled={!isAdmin} className="input" value={g.preferred} onChange={(e) => { const n = clone(k); n.glossary[i].preferred = e.target.value; setK(n); }} /></td>
                  <td className="p-2"><input disabled={!isAdmin} className="input" value={g.variants.join(", ")} onChange={(e) => { const n = clone(k); n.glossary[i].variants = e.target.value.split(",").map((s) => s.trim()).filter(Boolean); setK(n); }} /></td>
                  <td className="p-2"><input disabled={!isAdmin} className="input" value={g.note ?? ""} onChange={(e) => { const n = clone(k); n.glossary[i].note = e.target.value; setK(n); }} /></td>
                  <td className="p-2">{isAdmin && <button aria-label="Delete term" className="text-slate-400 hover:text-rose-600" onClick={() => { const n = clone(k); n.glossary.splice(i, 1); setK(n); }}><Trash2 size={15} /></button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {isAdmin && (
            <button className="btn-ghost mt-3" onClick={() => { const n = clone(k); n.glossary.push({ id: `G-${String(n.glossary.length + 1).padStart(2, "0")}${Date.now() % 100}`, preferred: "", variants: [] }); setK(n); }}>
              <Plus size={14} /> Add term
            </button>
          )}
        </div>
      )}

      {tab === "facts" && (
        <div className="grid gap-3 md:grid-cols-2">
          {k.facts.map((f, i) => {
            const exp = f.expiresOn < today;
            const set = (key: string, v: string) => { const n = clone(k); (n.facts[i] as any)[key] = key === "keywords" || key === "previousValues" ? v.split(",").map((s) => s.trim()).filter(Boolean) : v; setK(n); };
            return (
              <div key={f.id} className={`card space-y-2 p-4 ${exp ? "border-amber-300" : ""}`}>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs text-slate-500">{f.id}</span>
                  <input disabled={!isAdmin} className="input py-1 font-semibold" value={f.label} onChange={(e) => set("label", e.target.value)} />
                  {exp && <span className="whitespace-nowrap rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800">REVIEW DUE</span>}
                  {isAdmin && <button aria-label="Delete fact" className="text-slate-400 hover:text-rose-600" onClick={() => { const n = clone(k); n.facts.splice(i, 1); setK(n); }}><Trash2 size={15} /></button>}
                </div>
                <textarea disabled={!isAdmin} className="input min-h-[52px]" value={f.statement} onChange={(e) => set("statement", e.target.value)} />
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <Field label="Approved value" v={f.value} edit={isAdmin} on={(v) => set("value", v)} />
                  <Field label="Outdated values" v={(f.previousValues ?? []).join(", ")} edit={isAdmin} on={(v) => set("previousValues", v)} />
                  <Field label="Detect via keywords" v={f.keywords.join(", ")} edit={isAdmin} on={(v) => set("keywords", v)} />
                  <Field label="Source" v={f.source} edit={isAdmin} on={(v) => set("source", v)} />
                  <Field label="Owner" v={f.owner} edit={isAdmin} on={(v) => set("owner", v)} />
                  <Field label="Re-verify by" v={f.expiresOn} edit={isAdmin} on={(v) => set("expiresOn", v)} type="date" />
                </div>
              </div>
            );
          })}
          {isAdmin && (
            <button className="card flex min-h-[120px] items-center justify-center gap-2 border-dashed text-sm text-slate-500 hover:text-nova" onClick={() => { const n = clone(k); n.facts.push({ id: `F-${30 + n.facts.length}`, label: "New fact", statement: "", value: "", keywords: [], source: "", owner: "", verifiedOn: today, expiresOn: today }); setK(n); }}>
              <Plus size={16} /> Add approved fact
            </button>
          )}
        </div>
      )}

      {tab === "visual" && (
        <div className="card p-5">
          <p className="label">Approved colour palette</p>
          <div className="flex flex-wrap gap-3">
            {k.palette.map((c, i) => (
              <div key={i} className="w-40 rounded-xl border p-2">
                <div className="mb-2 h-16 rounded-lg border" style={{ background: c.hex }} />
                <input disabled={!isAdmin} className="input mb-1 py-1 text-xs" value={c.name} onChange={(e) => { const n = clone(k); n.palette[i].name = e.target.value; setK(n); }} />
                <div className="flex items-center gap-1">
                  <input disabled={!isAdmin} className="input py-1 font-mono text-xs" value={c.hex} onChange={(e) => { const n = clone(k); n.palette[i].hex = e.target.value; setK(n); }} />
                  {isAdmin && <button aria-label="Remove colour" className="text-slate-400 hover:text-rose-600" onClick={() => { const n = clone(k); n.palette.splice(i, 1); setK(n); }}><Trash2 size={14} /></button>}
                </div>
              </div>
            ))}
            {isAdmin && (
              <button className="flex w-40 items-center justify-center rounded-xl border border-dashed text-sm text-slate-500" onClick={() => { const n = clone(k); n.palette.push({ name: "New colour", hex: "#000000" }); setK(n); }}>
                <Plus size={14} /> Add colour
              </button>
            )}
          </div>
          <p className="mt-4 text-sm text-slate-500">
            Creatives are compared to this palette using the CIE ΔE colour-difference formula. Any colour covering 10%+ of an image and more than ΔE 25 away
            from every brand colour is flagged under rule V-01. Logo detection is planned for Round 3.
          </p>
        </div>
      )}

      {tab === "import" && <ImportTab k={k} setK={setK} edit={isAdmin} />}

      {tab === "settings" && (
        <div className="grid gap-4 md:grid-cols-2">
          <div className="card space-y-3 p-5">
            <div>
              <label className="label">Brand voice (used by the AI reviewer)</label>
              <textarea disabled={!isAdmin} className="input min-h-[120px]" value={k.voice} onChange={(e) => setK({ ...k, voice: e.target.value })} />
            </div>
            <div>
              <label className="label">Confidential terms — masked before any AI call</label>
              <input disabled={!isAdmin} className="input" value={k.confidentialTerms.join(", ")} onChange={(e) => setK({ ...k, confidentialTerms: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })} />
            </div>
            <div>
              <label className="label">Competitor names (rule M-03)</label>
              <input disabled={!isAdmin} className="input" value={k.competitorNames.join(", ")} onChange={(e) => setK({ ...k, competitorNames: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })} />
            </div>
          </div>
          <div className="card p-5">
            <p className="label">Version history</p>
            <ul className="space-y-2 text-sm">
              {history.map((h) => (
                <li key={h.version + h.at} className="flex gap-3">
                  <span className="w-10 font-mono text-xs text-nova">v{h.version}</span>
                  <span className="flex-1">{h.change}</span>
                  <span className="text-xs text-slate-400">{h.by} · {timeAgo(h.at)}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {isAdmin && (
        <div className="sticky bottom-4 z-20 flex flex-wrap items-center gap-2 rounded-xl border bg-white p-3 shadow-lg">
          {saved ? (
            <span className="text-sm text-emerald-700">{saved}</span>
          ) : (
            <span className="text-sm text-slate-500">{dirty ? "You have unsaved changes." : `Editing as ${personFor(role).name}. Every save creates a new Brand Kit version.`}</span>
          )}
          <input className="input ml-auto max-w-xs py-1.5" placeholder="What changed? (for the history)" value={note} onChange={(e) => setNote(e.target.value)} />
          <button className="btn-ghost" disabled={!dirty} onClick={() => setK(clone(kit))}>Discard</button>
          <button className="btn-primary" disabled={!dirty} onClick={save}><Save size={14} /> Save v{kit.version + 1}</button>
        </div>
      )}
    </div>
  );
}

function Field({ label, v, edit, on, type = "text" }: { label: string; v: string; edit: boolean; on: (v: string) => void; type?: string }) {
  return (
    <label className="block">
      <span className="text-[10px] font-semibold uppercase text-slate-400">{label}</span>
      <input type={type} disabled={!edit} className="input py-1 text-xs" value={v} onChange={(e) => on(e.target.value)} />
    </label>
  );
}

function RulesTab({ k, setK, edit }: { k: BrandKit; setK: (k: BrandKit) => void; edit: boolean }) {
  const [cat, setCat] = useState<Category | "all">("all");
  const list = k.rules.map((r, i) => ({ r, i })).filter(({ r }) => cat === "all" || r.category === cat);
  const upd = (i: number, patch: Partial<Rule>) => {
    const n = clone(k);
    n.rules[i] = { ...n.rules[i], ...patch };
    setK(n);
  };
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {(["all", ...CATS] as const).map((c) => (
          <button key={c} onClick={() => setCat(c)} className={`rounded-full px-3 py-1 text-xs ${cat === c ? "bg-nova text-white" : "bg-white text-slate-600 ring-1 ring-slate-200"}`}>
            {c === "all" ? "All" : CATEGORY_LABEL[c]}
          </button>
        ))}
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {list.map(({ r, i }) => (
          <div key={r.id} className={`card space-y-2 p-4 ${r.status === "draft" ? "border-dashed border-amber-400" : ""}`}>
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs font-bold text-nova">{r.id}</span>
              <SeverityTag s={r.severity} />
              <span className="text-xs text-slate-500">{CATEGORY_LABEL[r.category]}</span>
              {r.patterns?.length ? <span className="rounded bg-slate-100 px-1.5 text-[10px] text-slate-500">auto-check</span> : <span className="rounded bg-nova-soft px-1.5 text-[10px] text-nova">AI-checked</span>}
              {r.status === "draft" && <span className="rounded bg-amber-100 px-1.5 text-[10px] font-bold text-amber-800">DRAFT — not used until approved</span>}
            </div>
            {edit ? (
              <>
                <input className="input py-1 font-semibold" value={r.title} onChange={(e) => upd(i, { title: e.target.value })} />
                <textarea className="input min-h-[60px] text-sm" value={r.description} onChange={(e) => upd(i, { description: e.target.value })} />
                <div className="flex flex-wrap gap-2">
                  <select className="input w-auto py-1 text-xs" value={r.severity} onChange={(e) => upd(i, { severity: e.target.value as Severity })}>
                    {["high", "medium", "low"].map((s) => <option key={s}>{s}</option>)}
                  </select>
                  <select className="input w-auto py-1 text-xs" value={r.category} onChange={(e) => upd(i, { category: e.target.value as Category })}>
                    {CATS.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
                  </select>
                  <input className="input flex-1 py-1 font-mono text-xs" placeholder="auto-check patterns (regex, comma-separated)" value={(r.patterns ?? []).join(", ")} onChange={(e) => upd(i, { patterns: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })} />
                  {r.status === "draft" && <button className="btn-green px-2 py-1 text-xs" onClick={() => upd(i, { status: "approved" })}>Approve rule</button>}
                  <button aria-label="Delete rule" className="text-slate-400 hover:text-rose-600" onClick={() => { const n = clone(k); n.rules.splice(i, 1); setK(n); }}><Trash2 size={15} /></button>
                </div>
              </>
            ) : (
              <>
                <p className="font-semibold">{r.title}</p>
                <p className="text-sm text-slate-600">{r.description}</p>
                {(r.doExample || r.dontExample) && (
                  <p className="text-xs">
                    {r.doExample && <span className="mr-2 text-emerald-700">✓ {r.doExample}</span>}
                    {r.dontExample && <span className="text-rose-700">✗ {r.dontExample}</span>}
                  </p>
                )}
              </>
            )}
          </div>
        ))}
      </div>
      {edit && (
        <button className="btn-ghost" onClick={() => { const n = clone(k); n.rules.push({ id: `R-${String(n.rules.length + 1).padStart(2, "0")}`, category: "tone", title: "New rule", description: "", severity: "low" }); setK(n); }}>
          <Plus size={14} /> Add rule
        </button>
      )}
    </div>
  );
}

const SAMPLE_GUIDE = `PayNova social media guidelines (excerpt)
- Always write in second person ("you") and keep posts under 60 words on X.
- Never use more than three hashtags in a LinkedIn post.
- Do not mention interest rates unless the Finance team has approved the figure.
- Use the indigo logo on light backgrounds only.
- Every video must have captions.
- Avoid jargon such as "synergy", "leverage" or "disrupt".`;

function ImportTab({ k, setK, edit }: { k: BrandKit; setK: (k: BrandKit) => void; edit: boolean }) {
  const [text, setText] = useState(SAMPLE_GUIDE);
  const [busy, setBusy] = useState(false);
  const [rules, setRules] = useState<any[]>([]);
  const [mode, setMode] = useState<string>("");
  const [err, setErr] = useState<string | null>(null);
  const [pickd, setPickd] = useState<boolean[]>([]);

  const extract = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch("/api/extract-rules", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      setRules(j.rules);
      setPickd(j.rules.map(() => true));
      setMode(j.mode);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  const add = () => {
    const n = clone(k);
    let c = n.rules.filter((r) => r.id.startsWith("X-")).length;
    rules.forEach((r, i) => {
      if (!pickd[i]) return;
      c++;
      n.rules.push({
        id: `X-${String(c).padStart(2, "0")}`,
        category: CATS.includes(r.category) ? r.category : "tone",
        title: r.title,
        description: r.description,
        severity: ["high", "medium", "low"].includes(r.severity) ? r.severity : "low",
        doExample: r.do_example || undefined,
        dontExample: r.dont_example || undefined,
        status: "draft",
      });
    });
    setK(n);
    setRules([]);
  };

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="card space-y-3 p-5">
        <p className="text-sm text-slate-600">
          Paste a section of your brand book. BrandProof turns it into atomic, ID-tagged rules. They arrive as <b>drafts</b> — an admin reviews each one before it is used in any check.
        </p>
        <textarea className="input min-h-[220px] font-mono text-xs" value={text} onChange={(e) => setText(e.target.value)} />
        <button className="btn-primary" disabled={busy} onClick={extract}>
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />} Extract rules
        </button>
        {err && <p className="text-sm text-rose-600">{err}</p>}
      </div>
      <div className="card space-y-2 p-5">
        <p className="label">Candidate rules {mode && `(${mode === "ai" ? "extracted by AI" : "extracted by keyword heuristics — AI is off"})`}</p>
        {rules.length === 0 && <p className="text-sm text-slate-400">Nothing extracted yet.</p>}
        {rules.map((r, i) => (
          <label key={i} className="flex gap-2 rounded-lg border p-2.5 text-sm">
            <input type="checkbox" checked={pickd[i] ?? false} onChange={(e) => setPickd(pickd.map((p, j) => (j === i ? e.target.checked : p)))} />
            <span>
              <span className="mr-1 text-xs text-slate-500">[{CATEGORY_LABEL[r.category as Category] ?? r.category} · {r.severity}]</span>
              <b>{r.title}</b>
              <span className="block text-xs text-slate-500">{r.description}</span>
            </span>
          </label>
        ))}
        {rules.length > 0 &&
          (edit ? (
            <button className="btn-green" onClick={add}><Plus size={14} /> Add selected as draft rules</button>
          ) : (
            <p className="text-xs text-amber-700">Switch to Kabir (Brand Admin) to add these to the Brand Kit.</p>
          ))}
      </div>
    </div>
  );
}
