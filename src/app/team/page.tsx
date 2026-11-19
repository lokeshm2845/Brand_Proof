"use client";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Check, Copy, Link2, Loader2, LogOut, Plus, Users } from "lucide-react";
import { useStore } from "@/lib/store";
import { DEMO_KIT } from "@/lib/seed";
import * as team from "@/lib/team";
import AuthForm from "@/components/AuthForm";
import { openWorkspace } from "@/components/TeamSync";
import type { RoleKey } from "@/lib/types";

const ROLE_LABEL: Record<RoleKey, string> = { creator: "Creator", brand: "Brand reviewer", legal: "Legal reviewer", admin: "Brand admin" };

export default function TeamPage() {
  const router = useRouter();
  const mode = useStore((s) => s.mode);
  const t = useStore((s) => s.team);
  const exitTeam = useStore((s) => s.exitTeam);
  const [user, setUser] = useState<{ id: string; email?: string } | null | undefined>(undefined);
  const [ws, setWs] = useState<team.Workspace[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [orgName, setOrgName] = useState("");
  const [myName, setMyName] = useState("");
  const [links, setLinks] = useState<Partial<Record<RoleKey, string>>>({});
  const [copied, setCopied] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!team.teamConfigured) return;
    try {
      const u = await team.currentUser();
      setUser(u ? { id: u.id, email: u.email } : null);
      if (u) setWs(await team.myWorkspaces());
    } catch (e: any) {
      setErr(e.message);
      setUser(null);
    }
  }, []);
  useEffect(() => {
    refresh();
  }, [refresh]);

  if (!team.teamConfigured) {
    return (
      <div className="card mx-auto max-w-2xl space-y-2 p-6">
        <h1 className="text-xl font-bold">Team workspaces</h1>
        <p className="text-sm text-slate-600">
          This deployment has no database configured, so only the private demo sandbox is available. Add <code>NEXT_PUBLIC_SUPABASE_URL</code> and{" "}
          <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> (see the README) to enable real accounts, shared review and notifications.
        </p>
      </div>
    );
  }

  const open = async (orgId: string) => {
    setBusy(orgId);
    setErr(null);
    try {
      await openWorkspace(orgId);
      router.push("/");
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(null);
    }
  };

  const create = async () => {
    if (orgName.trim().length < 2) return setErr("Workspace name needs at least 2 characters.");
    if (!myName.trim()) return setErr("Enter your name — teammates will see it on reviews.");
    setBusy("create");
    setErr(null);
    try {
      const { ruleChanges: _r, ...starter } = DEMO_KIT;
      const id = await team.createWorkspace(orgName.trim(), myName.trim(), { ...starter, ruleChanges: [] });
      await openWorkspace(id);
      router.push("/");
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(null);
    }
  };

  const invite = async (role: RoleKey) => {
    if (!t) return;
    setBusy(`inv-${role}`);
    setErr(null);
    try {
      const link = await team.createInvite(t.orgId, role);
      setLinks((l) => ({ ...l, [role]: link }));
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(null);
    }
  };

  const copy = (txt: string) => {
    navigator.clipboard?.writeText(txt).catch(() => {});
    setCopied(txt);
    setTimeout(() => setCopied(null), 2000);
  };

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <h1 className="text-2xl font-bold">Team workspace</h1>
        <p className="text-sm text-slate-500">
          Real accounts and a shared database: creators, Brand and Legal reviewers work on the same items from their own devices, with live updates and notifications.
          Access is enforced by row-level security in the database — members of another workspace cannot read your content.
        </p>
      </div>

      {err && <p className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700" role="alert">{err}</p>}

      {user === undefined && <p className="text-sm text-slate-500"><Loader2 size={14} className="mr-1 inline animate-spin" /> Checking your session…</p>}

      {user === null && <AuthForm onDone={refresh} hint="Create an account to start a team workspace or to accept an invite. You can keep using the demo sandbox without one." />}

      {user && mode === "team" && t && (
        <>
          <div className="card space-y-3 p-5">
            <div className="flex flex-wrap items-center gap-2">
              <Users size={18} className="text-nova" />
              <h2 className="font-bold">{t.orgName}</h2>
              <span className="text-xs text-slate-500">you are {t.me.name} · {ROLE_LABEL[t.me.role]}</span>
            </div>
            <table className="w-full text-sm">
              <tbody>
                {t.members.map((m) => (
                  <tr key={m.userId} className="border-t">
                    <td className="py-2 font-medium">{m.name}{m.userId === t.me.userId ? " (you)" : ""}</td>
                    <td className="py-2 text-slate-500">{m.email}</td>
                    <td className="py-2 text-right">
                      {t.me.role === "admin" && m.userId !== t.me.userId ? (
                        <select
                          aria-label={`Role of ${m.name}`}
                          className="input w-auto py-1 text-xs"
                          value={m.role}
                          onChange={(e) => team.setMemberRole(t.orgId, m.userId, e.target.value as RoleKey).catch((x) => setErr(x.message))}
                        >
                          {(Object.keys(ROLE_LABEL) as RoleKey[]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                        </select>
                      ) : (
                        <span className="text-xs">{ROLE_LABEL[m.role]}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {t.me.role === "admin" && (
            <div className="card space-y-3 p-5">
              <h2 className="flex items-center gap-2 font-bold"><Link2 size={16} /> Invite people</h2>
              <p className="text-sm text-slate-500">Create a link for the role you want, then send it. Links work for 7 days and can be used by several people.</p>
              {(Object.keys(ROLE_LABEL) as RoleKey[]).map((r) => (
                <div key={r} className="flex flex-wrap items-center gap-2">
                  <button className="btn-ghost w-44" onClick={() => invite(r)} disabled={busy === `inv-${r}`}>
                    {busy === `inv-${r}` ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} {ROLE_LABEL[r]} link
                  </button>
                  {links[r] && (
                    <>
                      <code className="flex-1 truncate rounded bg-slate-50 px-2 py-1 text-xs">{links[r]}</code>
                      <button className="btn-ghost px-2 py-1 text-xs" onClick={() => copy(links[r]!)}>
                        {copied === links[r] ? <Check size={13} /> : <Copy size={13} />} {copied === links[r] ? "Copied" : "Copy"}
                      </button>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <button className="btn-ghost" onClick={() => { exitTeam(); router.push("/"); }}>Back to demo sandbox</button>
            <button className="btn-ghost" onClick={async () => { await team.signOut(); exitTeam(); refresh(); }}>
              <LogOut size={14} /> Sign out
            </button>
          </div>
        </>
      )}

      {user && mode !== "team" && (
        <>
          <div className="card space-y-3 p-5">
            <h2 className="font-bold">Your workspaces</h2>
            {ws.length === 0 ? (
              <p className="text-sm text-slate-500">You are not in a workspace yet. Create one below, or open an invite link from a teammate.</p>
            ) : (
              ws.map((w) => (
                <div key={w.orgId} className="flex items-center gap-3 rounded-lg border p-3">
                  <div className="flex-1">
                    <p className="font-semibold">{w.orgName}</p>
                    <p className="text-xs text-slate-500">{w.name} · {ROLE_LABEL[w.role]}</p>
                  </div>
                  <button className="btn-primary" onClick={() => open(w.orgId)} disabled={busy === w.orgId}>
                    {busy === w.orgId ? <Loader2 size={14} className="animate-spin" /> : null} Open
                  </button>
                </div>
              ))
            )}
          </div>
          <div className="card space-y-3 p-5">
            <h2 className="font-bold">Create a workspace</h2>
            <p className="text-sm text-slate-500">You become its Brand admin. It starts with the PayNova demo Brand Kit, which you can edit or replace.</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="label">Workspace name</span>
                <input className="input" value={orgName} onChange={(e) => setOrgName(e.target.value)} placeholder="e.g. PayNova Marketing" maxLength={80} />
              </label>
              <label className="block">
                <span className="label">Your name</span>
                <input className="input" value={myName} onChange={(e) => setMyName(e.target.value)} placeholder="e.g. Parth" maxLength={60} />
              </label>
            </div>
            <button className="btn-primary" onClick={create} disabled={busy === "create"}>
              {busy === "create" ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Create workspace
            </button>
          </div>
          <p className="text-xs text-slate-500">
            Signed in as {user.email}.{" "}
            <button className="underline" onClick={async () => { await team.signOut(); refresh(); }}>Sign out</button>
          </p>
        </>
      )}
    </div>
  );
}
