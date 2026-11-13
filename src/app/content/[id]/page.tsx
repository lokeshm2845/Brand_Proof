"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { diffWords } from "diff";
import {
  AlertTriangle, ArrowLeft, Check, CheckCircle2, ClipboardCopy, Edit3, History, Info, Loader2,
  MessageSquare, Printer, RefreshCw, Scale, Send, ShieldCheck, Undo2, X,
} from "lucide-react";
import { useStore, requestReview, withVersion } from "@/lib/store";
import { applyFix, BUCKETS, readability } from "@/lib/engine";
import { personFor } from "@/lib/seed";
import { CATEGORY_LABEL, ClaimTag, Empty, OriginTag, ScoreRing, SeverityTag, StatusBadge, timeAgo } from "@/components/ui";
import type { ContentItem, Finding, FindingStatus } from "@/lib/types";

const SEV_ORDER = { high: 0, medium: 1, low: 2 } as const;
const HL: Record<string, string> = {
  high: "bg-rose-100 underline decoration-rose-500 decoration-2 underline-offset-2 hover:bg-rose-200",
  medium: "bg-amber-100 underline decoration-amber-500 decoration-2 underline-offset-2 hover:bg-amber-200",
  low: "bg-sky-100 underline decoration-sky-500 decoration-2 underline-offset-2 hover:bg-sky-200",
};

function Highlighted({ text, findings, active, onPick }: { text: string; findings: Finding[]; active?: string; onPick: (id: string) => void }) {
  const ranges = useMemo(() => {
    const r: { s: number; e: number; f: Finding }[] = [];
    const sorted = [...findings].filter((f) => f.status === "open" && f.quote).sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity]);
    for (const f of sorted) {
      const s = text.indexOf(f.quote);
      if (s < 0) continue;
      const e = s + f.quote.length;
      if (r.some((x) => s < x.e && e > x.s)) continue;
      r.push({ s, e, f });
    }
    return r.sort((a, b) => a.s - b.s);
  }, [text, findings]);
  const parts: React.ReactNode[] = [];
  let pos = 0;
  ranges.forEach(({ s, e, f }) => {
    if (s > pos) parts.push(text.slice(pos, s));
    parts.push(
      <mark
        key={f.id}
        onClick={() => onPick(f.id)}
        title={f.message}
        className={`hl text-inherit ${HL[f.severity]} ${active === f.id ? "ring-2 ring-nova" : ""}`}
      >
        {text.slice(s, e)}
      </mark>,
    );
    pos = e;
  });
  if (pos < text.length) parts.push(text.slice(pos));
  return <div className="whitespace-pre-wrap text-[15px] leading-8">{parts.length ? parts : <span className="text-slate-400">No text.</span>}</div>;
}

function FindingCard({
  f, text, active, canDecide, model, onAccept, onEdit, onReject, onUndo, cardRef,
}: {
  f: Finding; text: string; active: boolean; canDecide: boolean; model?: string;
  onAccept: () => void; onEdit: (v: string) => void; onReject: (reason: string) => void; onUndo: () => void;
  cardRef: (el: HTMLDivElement | null) => void;
}) {
  const [mode, setMode] = useState<"none" | "edit" | "reject">("none");
  const [val, setVal] = useState(f.suggestion ?? f.quote);
  const [reason, setReason] = useState("");
  const stale = f.status === "open" && f.quote && !text.includes(f.quote);
  const decided = f.status !== "open";

  return (
    <div
      ref={cardRef}
      className={`rounded-xl border p-3.5 transition ${active ? "border-nova ring-2 ring-nova/20" : "border-slate-200"} ${decided ? "bg-slate-50 opacity-80" : "bg-white"}`}
    >
      <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
        <SeverityTag s={f.severity} />
        <OriginTag o={f.origin} model={f.origin === "ai" ? model : undefined} />
        <span className="text-[11px] font-medium text-slate-500">{CATEGORY_LABEL[f.category]}</span>
        <ClaimTag c={f.claimStatus} />
        {f.routeTo === "legal" && <span className="rounded-full bg-fuchsia-50 px-2 py-0.5 text-[10px] font-semibold text-fuchsia-700">→ Legal</span>}
        {f.origin === "ai" && <span className="ml-auto text-[10px] text-slate-400">confidence {Math.round(f.confidence * 100)}%</span>}
      </div>
      <p className="font-semibold leading-snug">{f.message}</p>
      <p className="mt-1 text-[13px] leading-relaxed text-slate-600">
        <span className="font-semibold text-slate-700">Why: </span>
        {f.explanation}
      </p>
      {f.swatches && (
        <div className="mt-2 flex gap-1.5">
          {f.swatches.map((s) => (
            <span key={s} className="flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px]">
              <span className="h-3 w-3 rounded-sm border" style={{ background: s }} />
              {s}
            </span>
          ))}
        </div>
      )}
      {f.suggestion !== undefined && f.status === "open" && (
        <div className="mt-2 rounded-lg bg-slate-50 p-2 text-[13px]">
          <span className="mr-1 text-[10px] font-bold uppercase tracking-wide text-slate-400">
            Suggested fix{f.suggestionBy === "ai" ? " (AI-drafted)" : ""}
          </span>
          <div>
            {f.quote && <span className="mr-1 rounded bg-rose-100 px-1 text-rose-700 line-through">{f.quote.trim()}</span>}
            <span className="rounded bg-emerald-100 px-1 text-emerald-800">{f.suggestion === "" ? "(remove)" : f.suggestion}</span>
          </div>
        </div>
      )}
      {stale && <p className="mt-2 text-xs text-slate-500">This text has changed since the check — re-check to confirm it is resolved.</p>}

      {decided ? (
        <div className="mt-2 flex items-center gap-2 text-xs">
          {f.status === "rejected" ? (
            <span className="text-amber-700">
              <b>Overridden</b> by {f.decidedBy}
              {f.reason ? ` — “${f.reason}”` : ""}
            </span>
          ) : (
            <span className="text-emerald-700">
              <b>{f.status === "edited" ? "Fixed with an edit" : "Fix accepted"}</b> by {f.decidedBy}
            </span>
          )}
          {canDecide && (
            <button onClick={onUndo} className="ml-auto inline-flex items-center gap-1 text-slate-500 hover:text-slate-800">
              <Undo2 size={12} /> undo
            </button>
          )}
        </div>
      ) : canDecide ? (
        <div className="mt-2.5">
          {mode === "none" && (
            <div className="flex flex-wrap gap-1.5">
              {f.suggestion !== undefined && (
                <button className="btn-green px-2.5 py-1 text-xs" onClick={onAccept}>
                  <Check size={13} /> Accept fix
                </button>
              )}
              {(f.quote || f.ruleId === "A-03") && (
                <button className="btn-ghost px-2.5 py-1 text-xs" onClick={() => setMode("edit")}>
                  <Edit3 size={13} /> {f.suggestion !== undefined ? "Edit fix" : "Write fix"}
                </button>
              )}
              <button className="btn-ghost px-2.5 py-1 text-xs" onClick={() => setMode("reject")}>
                <X size={13} /> Override
              </button>
            </div>
          )}
          {mode === "edit" && (
            <div className="space-y-1.5">
              <textarea className="input min-h-[60px] text-sm" value={val} onChange={(e) => setVal(e.target.value)} />
              <div className="flex gap-1.5">
                <button className="btn-green px-2.5 py-1 text-xs" onClick={() => { onEdit(val); setMode("none"); }}>Apply my edit</button>
                <button className="btn-ghost px-2.5 py-1 text-xs" onClick={() => setMode("none")}>Cancel</button>
              </div>
            </div>
          )}
          {mode === "reject" && (
            <div className="space-y-1.5">
              <input
                className="input text-sm"
                autoFocus
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Why is this fine? (required — helps improve the guidelines)"
              />
              <div className="flex gap-1.5">
                <button className="btn-red px-2.5 py-1 text-xs" disabled={reason.trim().length < 4} onClick={() => { onReject(reason.trim()); setMode("none"); }}>
                  Override with reason
                </button>
                <button className="btn-ghost px-2.5 py-1 text-xs" onClick={() => setMode("none")}>Cancel</button>
              </div>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

export default function ContentPage() {
  const { id } = useParams<{ id: string }>();
  const item = useStore((s) => s.items.find((i) => i.id === id));
  const role = useStore((s) => s.role);
  const kit = useStore((s) => s.kit);
  const mutate = useStore((s) => s.mutate);
  const me = personFor(role);
  const [active, setActive] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [tab, setTab] = useState<"comments" | "versions" | "details" | "audit">("comments");
  const [comment, setComment] = useState("");
  const [filter, setFilter] = useState<"open" | "all">("open");
  const [vA, setVA] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const refs = useRef<Record<string, HTMLDivElement | null>>({});

  useEffect(() => {
    if (item) setVA(Math.max(0, item.versions.length - 2));
  }, [item?.versions.length]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  if (!item) {
    return (
      <div className="mx-auto max-w-lg py-16 text-center">
        <p className="mb-4 text-slate-600">This content item isn&apos;t in this browser&apos;s workspace (workspaces are stored locally per browser).</p>
        <Link href="/" className="btn-primary">Back to workspace</Link>
      </div>
    );
  }

  const latest = item.versions[item.versions.length - 1];
  const findings = latest?.findings ?? [];
  const openF = findings.filter((f) => f.status === "open");
  const openHigh = openF.filter((f) => f.severity === "high");
  const locked = item.status === "in_review" || item.status === "approved";
  const isCreatorSide = role === "creator" || role === "admin";
  const canEditContent = isCreatorSide && !locked;
  const canDecide = (!locked && isCreatorSide) || (item.status === "in_review" && (role === "brand" || role === "legal" || role === "admin"));
  const dirty = latest && item.draftText !== latest.text;
  const model = latest?.meta?.model;
  const shown = [...(filter === "open" ? openF : findings)].sort((a, b) => (a.status === "open" ? 0 : 1) - (b.status === "open" ? 0 : 1) || SEV_ORDER[a.severity] - SEV_ORDER[b.severity]);

  const pick = (fid: string) => {
    setActive(fid);
    refs.current[fid]?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  const decide = (f: Finding, action: FindingStatus, opts: { value?: string; reason?: string } = {}) =>
    mutate(item.id, (it) => {
      const v = it.versions[it.versions.length - 1];
      const ff = v.findings.find((x) => x.id === f.id)!;
      if (action === "accepted" || action === "edited") {
        const replacement = action === "edited" ? opts.value ?? "" : ff.suggestion ?? "";
        if (ff.ruleId === "A-03") it.altText = replacement;
        else if (ff.quote) it.draftText = applyFix(it.draftText, ff.quote, replacement);
        ff.applied = replacement;
      }
      ff.status = action;
      ff.reason = opts.reason;
      ff.decidedBy = me.name;
      v.score = { ...v.score };
      it.decisions.push({ ruleId: ff.ruleId, category: ff.category, action, reason: opts.reason, by: me.name, at: new Date().toISOString(), origin: ff.origin });
      it.audit.push({
        at: new Date().toISOString(),
        by: me.name,
        action:
          action === "rejected"
            ? `Overrode ${ff.ruleId ?? "finding"} — “${opts.reason}”`
            : `${action === "edited" ? "Edited fix for" : "Accepted fix for"} ${ff.ruleId ?? "finding"}`,
      });
    });

  const undo = (f: Finding) =>
    mutate(item.id, (it) => {
      const v = it.versions[it.versions.length - 1];
      const ff = v.findings.find((x) => x.id === f.id)!;
      if ((ff.status === "accepted" || ff.status === "edited") && ff.ruleId === "A-03") it.altText = "";
      else if ((ff.status === "accepted" || ff.status === "edited") && ff.quote && ff.applied) {
        const idx = it.draftText.indexOf(ff.applied);
        if (idx >= 0) it.draftText = it.draftText.slice(0, idx) + ff.quote + it.draftText.slice(idx + ff.applied.length);
      }
      ff.applied = undefined;
      ff.status = "open";
      ff.reason = undefined;
      ff.decidedBy = undefined;
      it.audit.push({ at: new Date().toISOString(), by: me.name, action: `Reopened ${ff.ruleId ?? "finding"}` });
    });

  async function recheck(text: string, note: string) {
    setBusy(true);
    const r = await requestReview({
      text,
      kit,
      intent: { channel: item!.channel, audience: item!.audience, goal: item!.goal },
      isImage: item!.format === "image",
      imageDataUrl: item!.imageDataUrl,
      altText: item!.altText,
      imageAnalysis: item!.imageAnalysis,
    });
    mutate(item!.id, (it) => withVersion(it, r.text ?? text, r.findings, r.meta, me.name, note, kit.version));
    setBusy(false);
    setEditing(false);
    setToast(`Version ${item!.versions.length + 1} checked — ${r.findings.length} finding${r.findings.length === 1 ? "" : "s"}.`);
  }

  const submitForReview = () =>
    mutate(item.id, (it) => {
      it.status = "in_review";
      it.approvals = {};
      it.audit.push({ at: new Date().toISOString(), by: me.name, action: `Submitted v${it.versions.length} for review${it.needsLegal ? " (Brand + Legal)" : " (Brand)"}` });
    });

  const approve = (as: "brand" | "legal") => {
    let note: string | undefined;
    if (openHigh.length) {
      const r = prompt(`${openHigh.length} high-severity issue(s) are still open. Approve anyway? Enter a reason for the audit log:`);
      if (!r || r.trim().length < 4) return;
      note = r.trim();
    }
    mutate(item.id, (it) => {
      it.approvals[as] = { by: me.name, at: new Date().toISOString(), note };
      it.audit.push({ at: new Date().toISOString(), by: me.name, action: `Approved (${as === "brand" ? "Brand" : "Legal"})${note ? ` with open issues — “${note}”` : ""}` });
      if (it.approvals.brand && (!it.needsLegal || it.approvals.legal)) {
        it.status = "approved";
        it.audit.push({ at: new Date().toISOString(), by: "BrandProof", action: "All required approvals received — ready to publish" });
      }
    });
    setToast("Approval recorded.");
  };

  const requestChanges = () => {
    if (comment.trim().length < 4) {
      setTab("comments");
      setToast("Write a comment explaining what to change, then click Request changes.");
      return;
    }
    mutate(item.id, (it) => {
      it.comments.push({ id: crypto.randomUUID(), by: me.name, role, at: new Date().toISOString(), text: comment.trim() });
      it.status = "changes_requested";
      it.approvals = {};
      it.audit.push({ at: new Date().toISOString(), by: me.name, action: "Requested changes" });
    });
    setComment("");
  };

  const addComment = () => {
    if (!comment.trim()) return;
    mutate(item.id, (it) => {
      it.comments.push({ id: crypto.randomUUID(), by: me.name, role, at: new Date().toISOString(), text: comment.trim() });
      it.audit.push({ at: new Date().toISOString(), by: me.name, action: "Commented" });
    });
    setComment("");
  };

  const rd = readability(item.draftText);
  const myReviewTurn =
    item.status === "in_review" &&
    ((role === "brand" && !item.approvals.brand) || (role === "legal" && item.needsLegal && !item.approvals.legal) || (role === "admin" && (!item.approvals.brand || (item.needsLegal && !item.approvals.legal))));

  return (
    <div className="space-y-5">
      {toast && (
        <div className="no-print fixed bottom-5 right-5 z-50 rounded-xl bg-ink px-4 py-3 text-sm text-white shadow-lg">{toast}</div>
      )}
      <div className="no-print flex flex-wrap items-start gap-4">
        <div className="w-full min-w-0 sm:w-auto sm:flex-1">
          <Link href="/" className="mb-1 inline-flex items-center gap-1 text-xs text-slate-500 hover:text-nova">
            <ArrowLeft size={12} /> Workspace
          </Link>
          <h1 className="text-2xl font-bold">{item.title}</h1>
          <p className="text-sm text-slate-500">
            {item.channel || "No channel"} · {item.audience || "No audience set"} · Goal: {item.goal || "—"} · {item.fileName ? `from ${item.fileName} · ` : ""}Brand Kit v{item.kitVersion}
            {item.kitVersion < kit.version && <span className="ml-1 text-amber-700">(Kit is now v{kit.version} — re-check to apply new rules)</span>}
          </p>
        </div>
        <StatusBadge s={item.status} />
        {latest && <ScoreRing value={latest.score.total} />}
      </div>

      {/* Workflow bar */}
      <div className="no-print card flex flex-wrap items-center gap-3 p-3.5">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-semibold">Approvals:</span>
          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs ${item.approvals.brand ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
            {item.approvals.brand ? <CheckCircle2 size={12} /> : <ShieldCheck size={12} />} Brand{item.approvals.brand ? ` · ${item.approvals.brand.by}` : " · Rohan"}
          </span>
          {item.needsLegal && (
            <span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs ${item.approvals.legal ? "bg-emerald-100 text-emerald-700" : "bg-fuchsia-50 text-fuchsia-700"}`} title="Required because the content contains claims or figures">
              <Scale size={12} /> Legal{item.approvals.legal ? ` · ${item.approvals.legal.by}` : " · Meera (claims found)"}
            </span>
          )}
        </div>
        <div className="ml-auto flex flex-wrap gap-2">
          {canEditContent && (
            <>
              <button className="btn-ghost" disabled={busy} onClick={() => { setDraft(item.draftText); setEditing(true); }}>
                <Edit3 size={14} /> Edit text
              </button>
              <button className={dirty ? "btn-primary" : "btn-ghost"} disabled={busy} onClick={() => recheck(item.draftText, dirty ? "Re-check after fixes" : "Re-check")}>
                {busy ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} {dirty ? "Re-check & save new version" : "Re-check"}
              </button>
              <button
                className="btn-primary"
                disabled={busy || openHigh.length > 0 || Boolean(dirty)}
                title={openHigh.length ? "Resolve or override all HIGH issues first" : dirty ? "Re-check your latest edits first" : ""}
                onClick={submitForReview}
              >
                <Send size={14} /> Submit for review
              </button>
            </>
          )}
          {myReviewTurn && (
            <>
              {(role === "brand" || (role === "admin" && !item.approvals.brand)) && (
                <button className="btn-green" onClick={() => approve("brand")}>
                  <Check size={14} /> Approve as Brand
                </button>
              )}
              {item.needsLegal && (role === "legal" || (role === "admin" && !item.approvals.legal)) && (
                <button className="btn-green" onClick={() => approve("legal")}>
                  <Scale size={14} /> Approve as Legal
                </button>
              )}
              <button className="btn-red" onClick={requestChanges}>
                Request changes
              </button>
            </>
          )}
        </div>
        <div className="w-full text-xs text-slate-500">
          {item.status === "in_review" && !myReviewTurn && role === "creator" && "Waiting for reviewers. Switch role (top right) to Rohan or Meera to review."}
          {item.status === "in_review" && !myReviewTurn && role !== "creator" && "Your approval is already recorded or not required for this item."}
          {canEditContent && openHigh.length > 0 && `Resolve or override ${openHigh.length} high-severity issue${openHigh.length > 1 ? "s" : ""} to submit for review.`}
          {canEditContent && !openHigh.length && dirty && "You changed the text — re-check it to create a new version before submitting."}
          {canEditContent && !openHigh.length && !dirty && item.status !== "draft" && "Ready to submit. Claims or figures route to Legal automatically."}
          {(role === "brand" || role === "legal") && item.status !== "in_review" && item.status !== "approved" && "This item hasn't been submitted for review yet."}
        </div>
      </div>

      {item.status === "approved" && latest && <ProofRecord item={item} />}

      <div className="grid gap-5 lg:grid-cols-[1.25fr_1fr]">
        {/* Content */}
        <div className="space-y-4">
          <div className="card p-5">
            <div className="mb-3 flex items-center gap-2">
              <h2 className="font-bold">Content</h2>
              <span className="text-xs text-slate-500">
                {dirty ? "Working draft (unsaved changes — re-check to save as a new version)" : `Version ${latest?.n ?? 1}`}
              </span>
            </div>
            {item.format === "image" && item.imageDataUrl && (
              <div className="mb-4 grid gap-3 sm:grid-cols-[200px_1fr]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={item.imageDataUrl} alt={item.altText || "Creative under review"} className="w-full rounded-lg border" />
                <div className="space-y-2 text-sm">
                  <p><span className="label inline">Alt text: </span>{item.altText || <span className="text-rose-600">missing</span>}</p>
                  {item.imageAnalysis && (
                    <div className="flex flex-wrap gap-1.5">
                      {item.imageAnalysis.dominant.map((d) => (
                        <span key={d.hex} className="flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px]">
                          <span className="h-3 w-3 rounded-sm border" style={{ background: d.hex }} />
                          {Math.round(d.share * 100)}% {d.deltaE > 25 ? <b className="text-rose-600">off-palette</b> : <span className="text-emerald-700">{d.nearest}</span>}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
            {editing ? (
              <div className="space-y-2">
                <textarea className="input min-h-[220px] leading-relaxed" value={draft} onChange={(e) => setDraft(e.target.value)} />
                <div className="flex gap-2">
                  <button className="btn-primary" disabled={busy} onClick={() => recheck(draft, "Manual edit")}>
                    {busy ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Save &amp; re-check
                  </button>
                  <button className="btn-ghost" onClick={() => setEditing(false)}>Cancel</button>
                </div>
              </div>
            ) : (
              <Highlighted text={item.draftText} findings={findings} active={active} onPick={pick} />
            )}
            <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 border-t pt-3 text-xs text-slate-500">
              <span>{rd.words} words</span>
              <span>Reading ease {rd.fleschReadingEase} {rd.fleschReadingEase >= 60 ? "(easy)" : rd.fleschReadingEase >= 40 ? "(moderate)" : "(hard)"}</span>
              <span className="flex items-center gap-1"><span className="h-2 w-3 rounded bg-rose-200" /> high</span>
              <span className="flex items-center gap-1"><span className="h-2 w-3 rounded bg-amber-200" /> medium</span>
              <span className="flex items-center gap-1"><span className="h-2 w-3 rounded bg-sky-200" /> low</span>
            </div>
          </div>

          {latest && (
            <div className="card p-5">
              <h2 className="mb-3 font-bold">Brand Health Score breakdown</h2>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                {BUCKETS.map((b) => (
                  <div key={b.key} className="rounded-lg bg-slate-50 p-2 text-center">
                    <div className="text-lg font-bold text-nova">
                      {latest.score.byCategory[b.key]}<span className="text-xs font-normal text-slate-400">/{b.weight}</span>
                    </div>
                    <div className="text-[11px] text-slate-500">{b.label}</div>
                  </div>
                ))}
              </div>
              <p className="mt-2 text-xs text-slate-500">Each open issue deducts points in its category (high 15, medium 7, low 3). Accepted or overridden issues stop counting.</p>
            </div>
          )}

          {/* Tabs */}
          <div className="no-print card p-5">
            <div className="mb-4 flex flex-wrap gap-1 border-b text-sm">
              {([
                ["comments", `Comments (${item.comments.length})`, MessageSquare],
                ["versions", `Versions (${item.versions.length})`, History],
                ["details", "How this was checked", Info],
                ["audit", "Audit log", ShieldCheck],
              ] as const).map(([k, l, Icon]) => (
                <button key={k} onClick={() => setTab(k)} className={`-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 ${tab === k ? "border-nova font-semibold text-nova" : "border-transparent text-slate-500"}`}>
                  <Icon size={14} /> {l}
                </button>
              ))}
            </div>

            {tab === "comments" && (
              <div className="space-y-3">
                {item.comments.length === 0 && <Empty>No comments yet.</Empty>}
                {item.comments.map((c) => (
                  <div key={c.id} className="rounded-lg bg-slate-50 p-3 text-sm">
                    <p className="mb-0.5 text-xs text-slate-500"><b className="text-slate-700">{c.by}</b> · {personFor(c.role).title} · {timeAgo(c.at)}</p>
                    {c.text}
                  </div>
                ))}
                <div className="flex gap-2">
                  <input className="input" value={comment} onChange={(e) => setComment(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addComment()} placeholder={`Comment as ${me.name}…`} />
                  <button className="btn-ghost" onClick={addComment}>Post</button>
                </div>
              </div>
            )}

            {tab === "versions" && (
              <div className="space-y-3 text-sm">
                {item.versions.length < 2 ? (
                  <Empty>Only one version so far. Accept some fixes and re-check to create version 2.</Empty>
                ) : (
                  <>
                    <div className="flex flex-wrap items-center gap-2">
                      Compare
                      <select className="input w-auto py-1" value={vA} onChange={(e) => setVA(Number(e.target.value))}>
                        {item.versions.slice(0, -1).map((v, i) => (
                          <option key={v.n} value={i}>v{v.n} · score {v.score.total}</option>
                        ))}
                      </select>
                      with latest <b>v{latest.n}</b> · score {latest.score.total}
                    </div>
                    <div className="whitespace-pre-wrap rounded-lg border p-3 leading-7">
                      {diffWords(item.versions[vA].text, latest.text).map((p, i) => (
                        <span key={i} className={p.added ? "rounded bg-emerald-100 text-emerald-800" : p.removed ? "rounded bg-rose-100 text-rose-700 line-through" : ""}>
                          {p.value}
                        </span>
                      ))}
                    </div>
                  </>
                )}
                <ul className="divide-y">
                  {[...item.versions].reverse().map((v) => (
                    <li key={v.n} className="flex justify-between py-2">
                      <span>v{v.n} · {v.note} · by {v.by}</span>
                      <span className="text-slate-500">{v.findings.length} findings · score {v.score.total} · {timeAgo(v.createdAt)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {tab === "details" && latest?.meta && (
              <div className="space-y-3 text-sm">
                <div className="grid gap-2 sm:grid-cols-3">
                  <Stat label="Mode" value={latest.meta.mode === "hybrid" ? "Rule engine + AI + verifier" : "Rule engine only"} />
                  <Stat label="Model" value={latest.meta.model ?? "none"} />
                  <Stat label="Time" value={`${latest.meta.ms} ms`} />
                  <Stat label="Rule-engine findings" value={String(latest.findings.filter((f) => f.origin === "rule").length)} />
                  <Stat label="AI findings proposed → kept" value={`${latest.meta.aiProposed} → ${latest.meta.aiKept}`} />
                  <Stat label="Private items masked before AI" value={String(latest.meta.redactions)} />
                </div>
                {latest.meta.note && <p className="rounded-lg bg-amber-50 p-2.5 text-amber-800">{latest.meta.note}</p>}
                {latest.meta.aiDropped.length > 0 && (
                  <div>
                    <p className="label">What the verifier filtered out</p>
                    <ul className="space-y-1">
                      {latest.meta.aiDropped.map((d, i) => (
                        <li key={i} className="rounded bg-slate-50 px-2 py-1 text-xs">
                          <b>{d.reason}</b>{d.quote ? ` — “${d.quote.slice(0, 80)}”` : ""}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                <p className="text-xs text-slate-500">
                  Every AI finding must cite a rule that exists in the Brand Kit and quote text that actually appears in the content; otherwise it is dropped. AI
                  suggestions are re-checked by the rule engine so a fix cannot introduce a new violation.
                </p>
              </div>
            )}

            {tab === "audit" && (
              <ul className="space-y-1.5 text-sm">
                {[...item.audit].reverse().map((a, i) => (
                  <li key={i} className="flex gap-3">
                    <span className="w-28 shrink-0 text-xs text-slate-400">{new Date(a.at).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
                    <span><b>{a.by}</b> — {a.action}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* Findings */}
        <div className="no-print space-y-3 lg:sticky lg:top-20 lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto lg:pr-1">
          <div className="flex items-center gap-2">
            <h2 className="font-bold">Findings</h2>
            <span className="text-xs text-slate-500">{openF.length} open of {findings.length}</span>
            <div className="ml-auto flex rounded-lg border border-slate-200 p-0.5 text-xs">
              <button onClick={() => setFilter("open")} className={`rounded-md px-2 py-1 ${filter === "open" ? "bg-nova-soft font-semibold text-nova" : ""}`}>Open</button>
              <button onClick={() => setFilter("all")} className={`rounded-md px-2 py-1 ${filter === "all" ? "bg-nova-soft font-semibold text-nova" : ""}`}>All</button>
            </div>
          </div>
          {latest?.meta?.mode === "rules-only" && latest.meta.note && (
            <p className="flex gap-2 rounded-lg bg-slate-100 p-2.5 text-xs text-slate-600"><Info size={14} className="shrink-0" /> {latest.meta.note}</p>
          )}
          {!canDecide && item.status !== "approved" && (
            <p className="flex gap-2 rounded-lg bg-amber-50 p-2.5 text-xs text-amber-800">
              <AlertTriangle size={14} className="shrink-0" />
              {locked ? "Content is locked while in review. Reviewers can still override findings." : `As ${me.title} you can read findings; the creator decides on fixes before review.`}
            </p>
          )}
          {shown.length === 0 ? (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-5 text-center text-sm text-emerald-800">
              <CheckCircle2 className="mx-auto mb-2" />
              {findings.length ? "All issues are resolved." : "No issues found against Brand Kit v" + item.kitVersion + "."}
              {canEditContent && dirty && " Re-check to confirm and save the new version."}
            </div>
          ) : (
            shown.map((f) => (
              <FindingCard
                key={f.id}
                f={f}
                text={item.draftText}
                active={active === f.id}
                canDecide={canDecide}
                model={model}
                cardRef={(el) => { refs.current[f.id] = el; }}
                onAccept={() => decide(f, "accepted")}
                onEdit={(v) => decide(f, "edited", { value: v })}
                onReject={(r) => decide(f, "rejected", { reason: r })}
                onUndo={() => undo(f)}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-slate-50 p-2.5">
      <div className="text-[11px] text-slate-500">{label}</div>
      <div className="font-semibold">{value}</div>
    </div>
  );
}

function ProofRecord({ item }: { item: ContentItem }) {
  const v = item.versions[item.versions.length - 1];
  const overrides = v.findings.filter((f) => f.status === "rejected");
  return (
    <div className="card border-emerald-300 p-5">
      <div className="flex flex-wrap items-center gap-3">
        <CheckCircle2 className="text-emerald-600" />
        <div>
          <h2 className="font-bold">Brand Proof record — approved for publishing</h2>
          <p className="text-xs text-slate-500">
            Version {v.n} · score {v.score.total} · Brand Kit v{item.kitVersion} · Brand: {item.approvals.brand?.by} ({item.approvals.brand && new Date(item.approvals.brand.at).toLocaleString("en-IN")})
            {item.needsLegal && item.approvals.legal ? ` · Legal: ${item.approvals.legal.by} (${new Date(item.approvals.legal.at).toLocaleString("en-IN")})` : ""}
          </p>
        </div>
        <div className="no-print ml-auto flex gap-2">
          <button className="btn-ghost" onClick={() => navigator.clipboard.writeText(v.text)}>
            <ClipboardCopy size={14} /> Copy final text
          </button>
          <button className="btn-ghost" onClick={() => window.print()}>
            <Printer size={14} /> Print / save record
          </button>
        </div>
      </div>
      <p className="mt-3 whitespace-pre-wrap rounded-lg bg-emerald-50 p-3 text-sm">{v.text}</p>
      {overrides.length > 0 && (
        <p className="mt-2 text-xs text-slate-600">
          Human overrides on record: {overrides.map((o) => `${o.ruleId} by ${o.decidedBy} (“${o.reason}”)`).join("; ")}
        </p>
      )}
    </div>
  );
}
