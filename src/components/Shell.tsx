"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { ShieldCheck, Sparkles, Cpu } from "lucide-react";
import { useStore } from "@/lib/store";
import { PEOPLE } from "@/lib/seed";
import { TeamBadge, TeamLive, useTeamResume } from "./TeamSync";
import type { RoleKey } from "@/lib/types";

const NAV = [
  { href: "/", label: "Workspace" },
  { href: "/new", label: "New check" },
  { href: "/brand-kit", label: "Brand Kit" },
  { href: "/insights", label: "Insights" },
  { href: "/team", label: "Team" },
  { href: "/ai", label: "How AI is used" },
];

export function useAIStatus() {
  const [s, setS] = useState<{ ai: boolean; model: string | null } | null>(null);
  useEffect(() => {
    fetch("/api/status")
      .then((r) => r.json())
      .then(setS)
      .catch(() => setS({ ai: false, model: null }));
  }, []);
  return s;
}

export default function Shell({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const path = usePathname();
  const role = useStore((s) => s.role);
  const setRole = useStore((s) => s.setRole);
  const ensureSeed = useStore((s) => s.ensureSeed);
  const mode = useStore((s) => s.mode);
  const ai = useAIStatus();
  const teamReady = useTeamResume();
  const [storageMsg, setStorageMsg] = useState<string | null>(null);

  useEffect(() => {
    ensureSeed();
    setReady(true);
    const onStorage = () => setStorageMsg("Your browser storage is full, so recent changes may not survive a refresh. Delete a few large image items or use Reset demo.");
    window.addEventListener("brandproof-storage", onStorage);
    return () => window.removeEventListener("brandproof-storage", onStorage);
  }, [ensureSeed]);

  return (
    <div className="min-h-screen">
      <header className="no-print sticky top-0 z-30 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <Link href="/" className="flex items-center gap-2 font-bold text-ink">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-nova text-white">
              <ShieldCheck size={18} />
            </span>
            BrandProof
          </Link>
          <nav className="flex flex-wrap gap-1 text-sm">
            {NAV.map((n) => {
              const active = n.href === "/" ? path === "/" : path.startsWith(n.href);
              return (
                <Link
                  key={n.href}
                  href={n.href}
                  className={`rounded-lg px-3 py-1.5 font-medium ${active ? "bg-nova-soft text-nova" : "text-slate-600 hover:bg-slate-100"}`}
                >
                  {n.label}
                </Link>
              );
            })}
          </nav>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {ai && (
              <span
                className={`hidden items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium sm:inline-flex ${ai.ai ? "bg-nova-soft text-nova" : "bg-slate-100 text-slate-600"}`}
                title={ai.ai ? "Rule engine + AI reviewer + verifier" : "Deterministic rule engine only"}
              >
                {ai.ai ? <Sparkles size={12} /> : <Cpu size={12} />}
                {ai.ai ? `Hybrid · ${ai.model}` : "Rule engine mode"}
              </span>
            )}
            {mode === "team" ? (
              <>
                <TeamBadge />
                <TeamLive />
              </>
            ) : (
              <label className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs">
              <span className="text-slate-500">Acting as</span>
              <select
                aria-label="Switch role"
                className="bg-transparent font-semibold text-ink outline-none"
                value={role}
                onChange={(e) => setRole(e.target.value as RoleKey)}
              >
                {PEOPLE.map((p) => (
                  <option key={p.key} value={p.key}>
                    {p.name} — {p.title}
                  </option>
                ))}
              </select>
            </label>
            )}
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6">
        {storageMsg && (
          <div className="mb-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-900 ring-1 ring-amber-200" role="alert">
            {storageMsg}
          </div>
        )}
        {ready && teamReady ? children : <div className="py-20 text-center text-sm text-slate-500">Loading workspace…</div>}
      </main>
      <footer className="no-print mx-auto max-w-7xl px-4 pb-8 pt-4 text-xs text-slate-400">
        BrandProof · built by Team VictoryVerse for CodeNova India 2026 · Demo brand &quot;PayNova&quot; is fictional · {mode === "team" ? "Team workspace data is stored in Supabase (Postgres, row-level security)." : "Demo sandbox — stored only in this browser."}
      </footer>
    </div>
  );
}
