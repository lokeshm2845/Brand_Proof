"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowRight, FileText, Image as ImageIcon, Loader2, Plus, RotateCcw, Scale, ShieldCheck } from "lucide-react";
import { useStore } from "@/lib/store";
import { personFor, SAMPLES } from "@/lib/seed";
import { useCreateCheck } from "@/lib/useCheck";
import { ScoreRing, StatusBadge, timeAgo, Empty } from "@/components/ui";
import type { ContentItem, RoleKey } from "@/lib/types";

function waitingFor(it: ContentItem, role: RoleKey) {
  if (role === "brand") return it.status === "in_review" && !it.approvals.brand;
  if (role === "legal") return it.status === "in_review" && it.needsLegal && !it.approvals.legal;
  if (role === "creator") return it.status === "changes_requested" || it.status === "checked" || it.status === "draft";
  return false;
}

export default function Home() {
  const items = useStore((s) => s.items);
  const role = useStore((s) => s.role);
  const resetDemo = useStore((s) => s.resetDemo);
  const { run, busy, error } = useCreateCheck();
  const [filter, setFilter] = useState<"all" | "mine">("all");
  const me = personFor(role);

  const list = useMemo(() => {
    const l = filter === "mine" ? items.filter((i) => waitingFor(i, role)) : items;
    return [...l].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }, [items, filter, role]);
  const myCount = items.filter((i) => waitingFor(i, role)).length;

  const quickStart = () => {
    const s = SAMPLES[0];
    run({ title: s.title, channel: s.channel, audience: s.audience, goal: s.goal, text: s.text, format: "text" });
  };

  return (
    <div className="space-y-6">
      <section className="card overflow-hidden">
        <div className="grid gap-6 bg-gradient-to-br from-[#1d1760] via-nova to-[#6c5ce7] p-6 text-white md:grid-cols-[1.4fr_1fr] md:p-8">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-white/70">Brand governance, before you hit publish</p>
            <h1 className="mt-2 text-3xl font-bold leading-tight md:text-4xl">Catch it before the world does.</h1>
            <p className="mt-3 max-w-xl text-white/85">
              Paste a post, email, document or ad creative. BrandProof checks it against PayNova&apos;s approved rules, facts,
              terminology and colours, explains every issue with the rule it breaks, suggests a fix that keeps your message
              — and a human still makes the final call.
            </p>
            <div className="mt-5 flex flex-wrap gap-3">
              <button onClick={quickStart} disabled={busy} className="btn bg-white text-nova hover:bg-white/90">
                {busy ? <Loader2 className="animate-spin" size={16} /> : <ShieldCheck size={16} />}
                {busy ? "Checking sample post…" : "Try it now with a sample post"}
              </button>
              <Link href="/new" className="btn border border-white/40 text-white hover:bg-white/10">
                <Plus size={16} /> Check your own content
              </Link>
            </div>
            {error && <p className="mt-3 text-sm text-rose-200">{error}</p>}
          </div>
          <ol className="space-y-3 text-sm">
            {[
              ["1", "Check", "Submit content as Aisha (Creator). Findings appear with the exact rule or fact they come from."],
              ["2", "Fix", "Accept, edit or override each suggestion. Re-check to create a new version."],
              ["3", "Approve", "Switch role (top right) to Rohan (Brand) or Meera (Legal) to approve or request changes."],
              ["4", "Learn", "Insights shows repeated mistakes and which rules reviewers keep overriding."],
            ].map(([n, t, d]) => (
              <li key={n} className="flex gap-3 rounded-xl bg-white/10 p-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white text-xs font-bold text-nova">{n}</span>
                <span>
                  <b>{t}.</b> {d}
                </span>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="card p-5">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <h2 className="text-lg font-bold">Content workspace</h2>
          <div className="flex rounded-lg border border-slate-200 p-0.5 text-sm">
            <button onClick={() => setFilter("all")} className={`rounded-md px-3 py-1 ${filter === "all" ? "bg-nova-soft font-semibold text-nova" : "text-slate-600"}`}>
              All ({items.length})
            </button>
            <button onClick={() => setFilter("mine")} className={`rounded-md px-3 py-1 ${filter === "mine" ? "bg-nova-soft font-semibold text-nova" : "text-slate-600"}`}>
              Needs {me.name} ({myCount})
            </button>
          </div>
          <div className="ml-auto flex gap-2">
            <button
              className="btn-ghost"
              onClick={() => {
                if (confirm("Reset the demo workspace? This clears everything you created in this browser and restores the PayNova sample data.")) resetDemo();
              }}
            >
              <RotateCcw size={14} /> Reset demo
            </button>
            <Link href="/new" className="btn-primary">
              <Plus size={14} /> New check
            </Link>
          </div>
        </div>

        {list.length === 0 ? (
          <Empty>Nothing here for {me.name} right now. Try &quot;All&quot; or start a new check.</Empty>
        ) : (
          <div className="divide-y divide-slate-100">
            {list.map((it) => {
              const v = it.versions[it.versions.length - 1];
              const open = v?.findings.filter((f) => f.status === "open").length ?? 0;
              return (
                <Link key={it.id} href={`/content/${it.id}`} className="flex flex-wrap items-center gap-4 py-3 hover:bg-slate-50 sm:flex-nowrap">
                  <ScoreRing value={v?.score.total ?? 0} size={46} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      {it.format === "image" ? <ImageIcon size={14} className="text-slate-400" /> : <FileText size={14} className="text-slate-400" />}
                      <span className="truncate font-semibold">{it.title}</span>
                      {it.sample && <span className="rounded bg-slate-100 px-1.5 text-[10px] text-slate-500">sample history</span>}
                    </div>
                    <p className="truncate text-xs text-slate-500">
                      {it.channel || "—"} · v{it.versions.length} · {open} open issue{open === 1 ? "" : "s"} · by {it.createdBy} · updated {timeAgo(it.updatedAt)}
                    </p>
                  </div>
                  {it.needsLegal && (
                    <span className="hidden items-center gap-1 rounded-full bg-fuchsia-50 px-2 py-1 text-[11px] font-medium text-fuchsia-700 md:inline-flex" title="Contains claims or figures — Legal sign-off required">
                      <Scale size={12} /> Legal sign-off
                    </span>
                  )}
                  <StatusBadge s={it.status} />
                  <ArrowRight size={16} className="text-slate-300" />
                </Link>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
