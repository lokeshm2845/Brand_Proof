"use client";
import type { Category, ClaimStatus, ItemStatus, Severity } from "@/lib/types";

export const CATEGORY_LABEL: Record<Category, string> = {
  tone: "Tone",
  terminology: "Terminology",
  claims: "Claims",
  facts: "Facts",
  messaging: "Messaging",
  visual: "Visual",
  accessibility: "Accessibility",
};

export function SeverityTag({ s }: { s: Severity }) {
  const cls =
    s === "high"
      ? "bg-rose-100 text-rose-700"
      : s === "medium"
        ? "bg-amber-100 text-amber-800"
        : "bg-sky-100 text-sky-700";
  return <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${cls}`}>{s}</span>;
}

export function OriginTag({ o, model }: { o: "rule" | "ai"; model?: string }) {
  return o === "rule" ? (
    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600" title="Found by the deterministic rule engine — always reproducible">
      Rule engine
    </span>
  ) : (
    <span className="rounded-full bg-nova-soft px-2 py-0.5 text-[10px] font-semibold text-nova" title="Found by the AI reviewer and passed the verifier">
      AI{model ? ` · ${model}` : ""}
    </span>
  );
}

export function ClaimTag({ c }: { c?: ClaimStatus }) {
  if (!c) return null;
  const map: Record<ClaimStatus, string> = {
    supported: "bg-emerald-100 text-emerald-700",
    contradicted: "bg-rose-100 text-rose-700",
    outdated: "bg-orange-100 text-orange-700",
    unsupported: "bg-fuchsia-100 text-fuchsia-700",
  };
  return <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize ${map[c]}`}>Claim: {c}</span>;
}

export const STATUS_META: Record<ItemStatus, { label: string; cls: string }> = {
  draft: { label: "Draft", cls: "bg-slate-100 text-slate-600" },
  checked: { label: "Checked — not submitted", cls: "bg-sky-100 text-sky-700" },
  in_review: { label: "In review", cls: "bg-amber-100 text-amber-800" },
  changes_requested: { label: "Changes requested", cls: "bg-rose-100 text-rose-700" },
  approved: { label: "Approved · ready to publish", cls: "bg-emerald-100 text-emerald-700" },
};

export function StatusBadge({ s }: { s: ItemStatus }) {
  const m = STATUS_META[s];
  return <span className={`whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold ${m.cls}`}>{m.label}</span>;
}

export function ScoreRing({ value, size = 64 }: { value: number; size?: number }) {
  const r = (size - 8) / 2;
  const c = 2 * Math.PI * r;
  const color = value >= 85 ? "#059669" : value >= 60 ? "#D97706" : "#E11D48";
  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }} title="Brand Health Score (0–100)">
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} stroke="#E2E8F0" strokeWidth="6" fill="none" />
        <circle cx={size / 2} cy={size / 2} r={r} stroke={color} strokeWidth="6" fill="none" strokeDasharray={c} strokeDashoffset={c * (1 - value / 100)} strokeLinecap="round" />
      </svg>
      <span className="absolute text-sm font-bold" style={{ color }}>{value}</span>
    </div>
  );
}

export function timeAgo(iso: string) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">{children}</div>;
}
