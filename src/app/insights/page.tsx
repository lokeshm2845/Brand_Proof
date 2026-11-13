"use client";
import Link from "next/link";
import { useMemo } from "react";
import { AlertTriangle, Lightbulb } from "lucide-react";
import { useStore } from "@/lib/store";
import { CATEGORY_LABEL, Empty } from "@/components/ui";
import type { Category } from "@/lib/types";

export default function Insights() {
  const items = useStore((s) => s.items);
  const kit = useStore((s) => s.kit);

  const d = useMemo(() => {
    const first = items.filter((i) => i.versions.length).map((i) => i.versions[0]);
    const all = first.flatMap((v) => v.findings);
    const byCat: Record<string, number> = {};
    const byRule: Record<string, number> = {};
    all.forEach((f) => {
      byCat[f.category] = (byCat[f.category] ?? 0) + 1;
      if (f.ruleId) byRule[f.ruleId] = (byRule[f.ruleId] ?? 0) + 1;
    });
    const byChannel: Record<string, { n: number; issues: number }> = {};
    items.forEach((i) => {
      if (!i.versions.length) return;
      const c = i.channel || "Other";
      byChannel[c] = byChannel[c] ?? { n: 0, issues: 0 };
      byChannel[c].n++;
      byChannel[c].issues += i.versions[0].findings.length;
    });
    // decisions → acceptance / override per rule (Guideline Gap Detector)
    const perRule: Record<string, { total: number; overridden: number; reasons: string[] }> = {};
    let aiDec = 0, aiAcc = 0, ruleDec = 0, ruleAcc = 0;
    items.forEach((i) =>
      i.decisions.forEach((dc) => {
        if (dc.origin === "ai") { aiDec++; if (dc.action !== "rejected") aiAcc++; }
        else { ruleDec++; if (dc.action !== "rejected") ruleAcc++; }
        if (!dc.ruleId) return;
        perRule[dc.ruleId] = perRule[dc.ruleId] ?? { total: 0, overridden: 0, reasons: [] };
        perRule[dc.ruleId].total++;
        if (dc.action === "rejected") {
          perRule[dc.ruleId].overridden++;
          if (dc.reason) perRule[dc.ruleId].reasons.push(dc.reason);
        }
      }),
    );
    const gaps = Object.entries(perRule)
      .map(([id, v]) => ({ id, ...v, rate: v.overridden / v.total }))
      .filter((g) => g.total >= 3 && g.rate >= 0.4)
      .sort((a, b) => b.rate - a.rate);
    const improved = items.filter((i) => i.versions.length > 1);
    const avgFirst = first.length ? Math.round(first.reduce((a, v) => a + v.score.total, 0) / first.length) : 0;
    const avgLatest = items.filter((i) => i.versions.length).length
      ? Math.round(items.filter((i) => i.versions.length).reduce((a, i) => a + i.versions[i.versions.length - 1].score.total, 0) / items.filter((i) => i.versions.length).length)
      : 0;
    const approved = items.filter((i) => i.status === "approved");
    const hours = approved
      .map((i) => {
        const sub = i.audit.find((a) => a.action.startsWith("Submitted"));
        const ok = [...i.audit].reverse().find((a) => a.action.startsWith("All required approvals") || a.action.startsWith("Approved"));
        return sub && ok ? (new Date(ok.at).getTime() - new Date(sub.at).getTime()) / 3.6e6 : null;
      })
      .filter((x): x is number => x !== null && x >= 0);
    const legalShare = items.length ? Math.round((items.filter((i) => i.needsLegal).length / items.length) * 100) : 0;
    return {
      total: items.length, findings: all.length, byCat, byRule, byChannel, perRule, gaps, avgFirst, avgLatest, improved: improved.length,
      approved: approved.length, avgHours: hours.length ? hours.reduce((a, b) => a + b, 0) / hours.length : null, legalShare,
      aiAcc: aiDec ? Math.round((aiAcc / aiDec) * 100) : null, ruleAcc: ruleDec ? Math.round((ruleAcc / ruleDec) * 100) : null, aiDec, ruleDec,
    };
  }, [items]);

  const maxCat = Math.max(1, ...Object.values(d.byCat));
  const topRules = Object.entries(d.byRule).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const ruleTitle = (id: string) => kit.rules.find((r) => r.id === id)?.title ?? id;

  if (!items.length) return <Empty>No checks yet. <Link className="text-nova underline" href="/new">Run your first check</Link>.</Empty>;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold">Governance insights</h1>
        <p className="text-sm text-slate-500">Patterns across every check in this workspace (includes 4 sample-history items so the charts are not empty on first visit).</p>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label="Content items checked" value={d.total} />
        <Kpi label="Issues caught before publishing" value={d.findings} />
        <Kpi label="Avg score: first check → latest" value={`${d.avgFirst} → ${d.avgLatest}`} />
        <Kpi label="Avg time submit → approval" value={d.avgHours === null ? "—" : `${d.avgHours.toFixed(1)} h`} />
        <Kpi label="Approved & ready" value={d.approved} />
        <Kpi label="Items revised after a check" value={d.improved} />
        <Kpi label="Needed Legal sign-off" value={`${d.legalShare}%`} />
        <Kpi label="Fix acceptance (rule / AI)" value={`${d.ruleAcc ?? "—"}% / ${d.aiAcc ?? "—"}%`} hint={`${d.ruleDec} rule and ${d.aiDec} AI decisions`} />
      </div>

      <div className="card p-5">
        <div className="mb-3 flex items-center gap-2">
          <Lightbulb className="text-amber-500" size={18} />
          <h2 className="font-bold">Guideline Gap Detector</h2>
          <span className="text-xs text-slate-500">rules that people keep overriding are probably unclear</span>
        </div>
        {d.gaps.length === 0 ? (
          <Empty>No unclear rules detected yet. A rule is flagged when it has 3+ decisions and 40%+ are overrides.</Empty>
        ) : (
          d.gaps.map((g) => (
            <div key={g.id} className="mb-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
              <p className="flex flex-wrap items-center gap-2 font-semibold">
                <AlertTriangle size={16} className="text-amber-600" />
                {g.id} · {ruleTitle(g.id)}
                <span className="rounded-full bg-amber-200 px-2 py-0.5 text-xs">overridden {g.overridden} of {g.total} times ({Math.round(g.rate * 100)}%)</span>
              </p>
              <p className="mt-2 text-sm text-slate-700">Why reviewers and creators overrode it:</p>
              <ul className="ml-5 list-disc text-sm text-slate-600">
                {g.reasons.slice(0, 4).map((r, i) => <li key={i}>“{r}”</li>)}
              </ul>
              <p className="mt-2 text-sm">
                <b>Suggested action:</b> the overrides share a pattern, so the rule likely needs an explicit exception. Example rewrite:{" "}
                <i>
                  &quot;{ruleTitle(g.id)} — unless {g.reasons.join(" ").match(/real|genuine|factual|ends|deadline/i) ? "the deadline is real and the end date is stated in the content" : "the brand team has documented an exception"}.&quot;
                </i>{" "}
                <Link href="/brand-kit" className="text-nova underline">Update the rule in the Brand Kit</Link>
              </p>
            </div>
          ))
        )}
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        <div className="card p-5">
          <h2 className="mb-3 font-bold">Issues by type (first check)</h2>
          <div className="space-y-2">
            {Object.entries(d.byCat).sort((a, b) => b[1] - a[1]).map(([c, n]) => (
              <div key={c} className="flex items-center gap-2 text-sm">
                <span className="w-28 shrink-0 text-slate-600">{CATEGORY_LABEL[c as Category]}</span>
                <div className="h-5 flex-1 rounded bg-slate-100">
                  <div className="h-5 rounded bg-nova" style={{ width: `${(n / maxCat) * 100}%` }} />
                </div>
                <span className="w-6 text-right font-semibold">{n}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="card p-5">
          <h2 className="mb-3 font-bold">Most-broken rules</h2>
          <table className="w-full text-sm">
            <tbody>
              {topRules.map(([id, n]) => {
                const pr = d.perRule[id];
                return (
                  <tr key={id} className="border-t">
                    <td className="py-1.5 font-mono text-xs text-nova">{id}</td>
                    <td className="py-1.5">{ruleTitle(id)}</td>
                    <td className="py-1.5 text-right font-semibold">{n}×</td>
                    <td className="py-1.5 pl-2 text-right text-xs text-slate-500">{pr ? `${pr.overridden}/${pr.total} overridden` : ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="card p-5 md:col-span-2">
          <h2 className="mb-3 font-bold">By channel</h2>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {Object.entries(d.byChannel).map(([c, v]) => (
              <div key={c} className="rounded-lg bg-slate-50 p-3">
                <div className="text-xs text-slate-500">{c}</div>
                <div className="font-semibold">{v.n} item{v.n > 1 ? "s" : ""} · {(v.issues / v.n).toFixed(1)} issues avg</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function Kpi({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="card p-4" title={hint}>
      <div className="text-2xl font-bold text-ink">{value}</div>
      <div className="text-xs text-slate-500">{label}</div>
    </div>
  );
}
