"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, CheckCircle2, Loader2, Lock, RefreshCw, Sparkles, Wand2 } from "lucide-react";
import { reviewItem, useStore } from "@/lib/store";
import { personFor } from "@/lib/seed";
import { heuristicRewrite, impactPreview, isUnclear, ruleStats, themesFrom, validatePatterns, type Proposal, type Theme } from "@/lib/ruleQuality";
import { Empty, SeverityTag } from "@/components/ui";
import type { Rule } from "@/lib/types";

const pct = (x: number) => `${Math.round(x * 100)}%`;

export default function ImproveRule() {
  const { ruleId } = useParams<{ ruleId: string }>();
  const kit = useStore((s) => s.kit);
  const items = useStore((s) => s.items);
  const role = useStore((s) => s.role);
  const saveKit = useStore((s) => s.saveKit);
  const isAdmin = role === "admin";
  const rule = kit.rules.find((r) => r.id === ruleId);
  const stat = useMemo(() => ruleStats(items, kit).find((s) => s.ruleId === ruleId), [items, kit, ruleId]);

  // sentences behind each human decision, sent to the AI so it can see context
  const evidence = useMemo(() => {
    const overridden: { reason: string; sentence: string; content: string }[] = [];
    const accepted: { sentence: string }[] = [];
    for (const it of items)
      for (const v of it.versions)
        for (const f of v.findings) {
          if (f.ruleId !== ruleId || !f.quote) continue;
          const i = v.text.indexOf(f.quote);
          const sentence = i < 0 ? f.quote : v.text.slice(Math.max(0, v.text.lastIndexOf(".", i) + 1), Math.min(v.text.length, (v.text.indexOf(".", i + f.quote.length) + 1 || v.text.length))).trim();
          if (f.status === "rejected") overridden.push({ reason: f.reason ?? "", sentence, content: v.text.slice(0, 600) });
          else if (f.status === "accepted" || f.status === "edited") accepted.push({ sentence });
        }
    return { overridden, accepted };
  }, [items, ruleId]);

  const [themes, setThemes] = useState<Theme[]>([]);
  const [prop, setProp] = useState<Proposal | null>(null);
  const [drafts, setDrafts] = useState<Proposal[]>([]);
  const [patternsText, setPatternsText] = useState("");
  const [loading, setLoading] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [done, setDone] = useState<{ version: number } | null>(null);
  const [rechecking, setRechecking] = useState<string | null>(null);

  // Start with the instant keyword draft so the page is useful immediately
  useEffect(() => {
    if (!rule || prop) return;
    const reasons = evidence.overridden.map((o) => o.reason);
    setThemes(themesFrom(reasons));
    const h = heuristicRewrite(rule, reasons);
    setProp(h);
    setDrafts([h]);
    setPatternsText(h.exceptionPatterns.join("\n"));
  }, [rule, evidence, prop]);

  if (!rule) return <Empty>Rule {ruleId} is not in the Brand Kit. <Link href="/insights" className="text-nova underline">Back to Insights</Link></Empty>;

  const patterns = patternsText.split("\n").map((p) => p.trim()).filter(Boolean);
  const patternError = validatePatterns(patterns);
  const proposed: Rule | null = prop
    ? {
        ...rule,
        title: prop.title || rule.title,
        description: prop.description || rule.description,
        exceptions: [...(rule.exceptions ?? []), ...(patterns.length ? [{ note: prop.exceptionNote, patterns, scope: prop.scope }] : [])],
      }
    : null;
  const impact = proposed && !patternError ? impactPreview(items, kit, rule.id, proposed) : null;

  const draftWithAI = async () => {
    setLoading(true);
    setNote(null);
    try {
      const r = await fetch("/api/rule-rewrite", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rule, ...evidence }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "Could not draft a rewrite");
      if (j.themes?.length) setThemes(j.themes);
      // Score every draft on the real history and start from the best one
      // (fewest real issues missed first, then the lowest remaining override rate).
      const heuristic = heuristicRewrite(rule, evidence.overridden.map((o) => o.reason));
      const all: Proposal[] = [j.proposal, ...(j.proposal.source === "ai" ? [heuristic] : [])];
      const score = (d: Proposal) => {
        if (validatePatterns(d.exceptionPatterns)) return 99;
        const r = { ...rule, description: d.description, exceptions: [...(rule.exceptions ?? []), ...(d.exceptionPatterns.length ? [{ note: d.exceptionNote, patterns: d.exceptionPatterns, scope: d.scope }] : [])] };
        const im = impactPreview(items, kit, rule.id, r);
        return im.missedAccepted * 10 + im.after.overrideRate;
      };
      const ranked = [...all].sort((a, b) => score(a) - score(b));
      setDrafts(ranked);
      setProp(ranked[0]);
      setPatternsText(ranked[0].exceptionPatterns.join("\n"));
      setNote(
        j.note ??
          (ranked.length > 1
            ? `Both drafts were tested on your history. The ${ranked[0].source === "ai" ? "AI" : "keyword"} draft performs better, so it is selected — you can switch above the description.`
            : "Drafted from the override reasons. Check the impact below before approving."),
      );
    } catch (e: any) {
      setNote(e.message);
    } finally {
      setLoading(false);
    }
  };

  const approve = () => {
    if (!proposed || !impact || !prop) return;
    const version = kit.version + 1;
    const updated = {
      ...kit,
      rules: kit.rules.map((r) =>
        r.id === rule.id
          ? { ...proposed, exceptions: proposed.exceptions?.map((e, i) => (i >= (rule.exceptions?.length ?? 0) ? { ...e, addedInVersion: version } : e)) }
          : r,
      ),
      ruleChanges: [
        {
          ruleId: rule.id,
          version,
          at: new Date().toISOString(),
          by: personFor(role).name,
          summary: prop.exceptionNote || "Rewrote the rule description",
          before: { description: rule.description, overrideRate: impact.before.overrideRate, decisions: impact.before.overridden + impact.before.accepted },
          projected: { overrideRate: impact.after.overrideRate, removedOverrides: impact.removedOverrides, missedAccepted: impact.missedAccepted },
        },
        ...(kit.ruleChanges ?? []),
      ],
    };
    saveKit(updated, `Improved ${rule.id} via the Guideline Gap Detector: ${prop.exceptionNote || "clearer wording"}`);
    setDone({ version });
  };

  const affectedOpen = items.filter((it) => it.status !== "approved" && impact?.rows.some((r) => r.itemId === it.id));
  const recheckAffected = async () => {
    for (const it of affectedOpen) {
      setRechecking(it.title);
      await reviewItem(it.id, it.draftText, `Re-check after ${rule.id} was improved`, personFor(role).name);
    }
    setRechecking(null);
  };

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div>
        <Link href="/insights" className="mb-1 inline-flex items-center gap-1 text-xs text-slate-500 hover:text-nova">
          <ArrowLeft size={12} /> Insights
        </Link>
        <h1 className="text-2xl font-bold">Improve rule {rule.id}</h1>
        <p className="text-sm text-slate-500">Turn repeated overrides into a clearer rule — with proof of what changes before anything is published.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-[1.2fr_1fr]">
        <div className="card space-y-2 p-5">
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm font-bold text-nova">{rule.id}</span>
            <SeverityTag s={rule.severity} />
            <span className="font-semibold">{rule.title}</span>
          </div>
          <p className="text-sm text-slate-600">{rule.description}</p>
          {(rule.exceptions ?? []).length > 0 && (
            <ul className="text-xs text-emerald-700">
              {rule.exceptions!.map((e, i) => (
                <li key={i}>✓ Existing exception{e.addedInVersion ? ` (v${e.addedInVersion})` : ""}: {e.note}</li>
              ))}
            </ul>
          )}
        </div>
        <div className="card grid grid-cols-3 gap-2 p-5 text-center">
          <div><div className="text-2xl font-bold">{stat?.fired ?? 0}</div><div className="text-[11px] text-slate-500">times fired</div></div>
          <div><div className="text-2xl font-bold">{stat?.decisions ?? 0}</div><div className="text-[11px] text-slate-500">human decisions</div></div>
          <div>
            <div className={`text-2xl font-bold ${stat && isUnclear(stat) ? "text-amber-600" : ""}`}>{stat ? pct(stat.overrideRate) : "0%"}</div>
            <div className="text-[11px] text-slate-500">overridden</div>
          </div>
        </div>
      </div>

      {evidence.overridden.length === 0 ? (
        <Empty>Nobody has overridden {rule.id} yet, so there is nothing to learn from. Overrides (with reasons) on the review screen feed this page.</Empty>
      ) : (
        <>
          <div className="card p-5">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <h2 className="font-bold">1 · Why people override it</h2>
              <button className="btn-ghost ml-auto" onClick={draftWithAI} disabled={loading}>
                {loading ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />} {loading ? "Drafting…" : "Group reasons & draft rewrite with AI"}
              </button>
            </div>
            <div className="grid gap-2 md:grid-cols-2">
              {themes.map((t) => (
                <div key={t.theme} className="rounded-lg bg-amber-50 p-3 text-sm">
                  <p className="font-semibold text-amber-900">{t.theme} <span className="font-normal text-amber-700">· {t.count}×</span></p>
                  <ul className="mt-1 list-disc pl-4 text-xs text-amber-800">
                    {(t.examples ?? []).slice(0, 3).map((e, i) => <li key={i}>“{e}”</li>)}
                  </ul>
                </div>
              ))}
            </div>
            {note && <p className="mt-3 rounded-lg bg-nova-soft p-2.5 text-xs text-nova">{note}</p>}
          </div>

          {prop && (
            <div className="card space-y-3 p-5">
              <h2 className="font-bold">2 · Proposed rule {prop.source === "ai" ? <span className="ml-1 rounded-full bg-nova-soft px-2 py-0.5 text-[10px] text-nova">AI draft</span> : <span className="ml-1 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-600">keyword draft</span>}</h2>
              {drafts.length > 1 && (
                <div className="flex flex-wrap gap-2 text-xs">
                  {drafts.map((d, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => { setProp(d); setPatternsText(d.exceptionPatterns.join("\n")); }}
                      className={`rounded-full px-3 py-1 ${prop === d ? "bg-nova text-white" : "bg-white ring-1 ring-slate-200"}`}
                    >
                      {d.source === "ai" ? "AI draft" : "Keyword draft"}{i === 0 ? " (best on your history)" : ""}
                    </button>
                  ))}
                </div>
              )}
              <label className="block">
                <span className="label">Description</span>
                <textarea disabled={!isAdmin} className="input min-h-[70px] text-sm" value={prop.description} onChange={(e) => setProp({ ...prop, description: e.target.value })} />
              </label>
              <div className="grid gap-3 md:grid-cols-[1fr_200px]">
                <label className="block">
                  <span className="label">Exception (plain language)</span>
                  <input disabled={!isAdmin} className="input text-sm" value={prop.exceptionNote} onChange={(e) => setProp({ ...prop, exceptionNote: e.target.value })} />
                </label>
                <label className="block">
                  <span className="label">Look for the exception in</span>
                  <select disabled={!isAdmin} className="input text-sm" value={prop.scope} onChange={(e) => setProp({ ...prop, scope: e.target.value as Proposal["scope"] })}>
                    <option value="sentence">the same sentence</option>
                    <option value="content">anywhere in the content</option>
                  </select>
                </label>
              </div>
              <label className="block">
                <span className="label">Exception patterns — one regular expression per line (the rule engine skips a finding when one matches)</span>
                <textarea disabled={!isAdmin} className="input min-h-[110px] font-mono text-xs" value={patternsText} onChange={(e) => setPatternsText(e.target.value)} />
              </label>
              {patternError && <p className="text-sm text-rose-600">{patternError}</p>}
            </div>
          )}

          {impact && (
            <div className="card space-y-3 p-5">
              <h2 className="font-bold">3 · Impact preview — the proposed rule re-run on all {items.length} items and their past versions</h2>
              <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                <div className="rounded-lg bg-slate-50 p-3 text-center">
                  <div className="text-xl font-bold">{pct(impact.before.overrideRate)} → <span className={impact.after.overrideRate < impact.before.overrideRate ? "text-emerald-600" : ""}>{pct(impact.after.overrideRate)}</span></div>
                  <div className="text-[11px] text-slate-500">override rate (before → after)</div>
                </div>
                <div className="rounded-lg bg-emerald-50 p-3 text-center">
                  <div className="text-xl font-bold text-emerald-700">{impact.removedOverrides}</div>
                  <div className="text-[11px] text-slate-500">pointless flags removed</div>
                </div>
                <div className={`rounded-lg p-3 text-center ${impact.missedAccepted ? "bg-rose-50" : "bg-slate-50"}`}>
                  <div className={`text-xl font-bold ${impact.missedAccepted ? "text-rose-700" : ""}`}>{impact.missedAccepted}</div>
                  <div className="text-[11px] text-slate-500">real issues it would now miss</div>
                </div>
                <div className="rounded-lg bg-slate-50 p-3 text-center">
                  <div className="text-xl font-bold">{impact.before.flags} → {impact.after.flags}</div>
                  <div className="text-[11px] text-slate-500">times the rule fires</div>
                </div>
              </div>
              {impact.missedAccepted > 0 && (
                <p className="rounded-lg bg-rose-50 p-2.5 text-sm text-rose-700">Careful: this version would stop flagging {impact.missedAccepted} issue(s) that reviewers agreed were real. Tighten the patterns before approving.</p>
              )}
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs uppercase text-slate-500">
                    <tr><th className="p-2">Content</th><th className="p-2">Sentence</th><th className="p-2">Human decision</th><th className="p-2">With the new rule</th></tr>
                  </thead>
                  <tbody>
                    {impact.rows.map((r, i) => (
                      <tr key={i} className="border-t align-top">
                        <td className="p-2"><Link className="text-nova hover:underline" href={`/content/${r.itemId}`}>{r.title}</Link> <span className="text-xs text-slate-400">v{r.version}</span></td>
                        <td className="p-2 text-slate-600">{r.sentence}</td>
                        <td className="p-2">{r.status === "rejected" ? <span className="text-amber-700">overridden</span> : r.status === "open" ? <span className="text-slate-500">undecided</span> : <span className="text-emerald-700">agreed</span>}</td>
                        <td className="p-2 font-semibold">
                          {r.effect === "removed" ? (r.status === "rejected" ? <span className="text-emerald-700">no longer flagged ✓</span> : r.status === "open" ? <span className="text-slate-600">no longer flagged</span> : <span className="text-rose-700">missed ✗</span>) : r.effect === "added" ? <span className="text-amber-700">newly flagged</span> : <span className="text-slate-600">still flagged</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {done ? (
                <div className="space-y-2 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
                  <p className="flex items-center gap-2 font-semibold"><CheckCircle2 size={16} /> Published as Brand Kit v{done.version}. New checks use the improved rule immediately.</p>
                  {affectedOpen.length > 0 && (
                    <button className="btn-green" onClick={recheckAffected} disabled={Boolean(rechecking)}>
                      {rechecking ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} {rechecking ? `Re-checking “${rechecking}”…` : `Re-check ${affectedOpen.length} open item(s) with the new rule`}
                    </button>
                  )}
                  <p><Link href="/insights" className="underline">See the before/after on Insights →</Link></p>
                </div>
              ) : isAdmin ? (
                <button className="btn-primary" onClick={approve} disabled={Boolean(patternError)}>
                  <Wand2 size={14} /> Approve &amp; publish as Brand Kit v{kit.version + 1}
                </button>
              ) : (
                <p className="flex items-center gap-2 text-sm text-slate-500"><Lock size={14} /> Only the Brand Admin can publish rule changes. Switch to Kabir (Brand Admin) in the top-right menu.</p>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
