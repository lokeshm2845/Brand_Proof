"use client";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Loader2, UserCheck } from "lucide-react";
import * as team from "@/lib/team";
import AuthForm from "@/components/AuthForm";
import { openWorkspace } from "@/components/TeamSync";
import { Empty } from "@/components/ui";

const ROLE_LABEL: Record<string, string> = { creator: "Creator", brand: "Brand reviewer", legal: "Legal reviewer", admin: "Brand admin" };

export default function JoinPage() {
  const { token } = useParams<{ token: string }>();
  const router = useRouter();
  const [info, setInfo] = useState<{ org_name: string; role: string; expired: boolean } | null | undefined>(undefined);
  const [signedIn, setSignedIn] = useState<boolean | undefined>(undefined);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const check = useCallback(async () => {
    if (!team.teamConfigured) return;
    try {
      setInfo(await team.inviteInfo(token));
    } catch {
      setInfo(null);
    }
    setSignedIn(Boolean(await team.currentUser().catch(() => null)));
  }, [token]);
  useEffect(() => {
    check();
  }, [check]);

  if (!team.teamConfigured) return <Empty>Team workspaces are not enabled on this deployment.</Empty>;
  if (info === undefined || signedIn === undefined) return <p className="py-10 text-center text-sm text-slate-500"><Loader2 size={14} className="mr-1 inline animate-spin" /> Checking invite…</p>;
  if (!info) return <Empty>This invite link is not valid. Ask your workspace admin for a new one.</Empty>;
  if (info.expired) return <Empty>This invite link has expired. Ask your workspace admin for a new one.</Empty>;

  const join = async () => {
    if (!name.trim()) return setErr("Enter your name — teammates will see it on reviews.");
    setBusy(true);
    setErr(null);
    try {
      const orgId = await team.acceptInvite(token, name.trim());
      await openWorkspace(orgId);
      router.push("/");
    } catch (e: any) {
      setErr(e.message);
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-md space-y-4">
      <div className="card p-5 text-center">
        <UserCheck className="mx-auto mb-2 text-nova" />
        <p className="text-sm text-slate-500">You are invited to</p>
        <h1 className="text-xl font-bold">{info.org_name}</h1>
        <p className="text-sm">as <b>{ROLE_LABEL[info.role] ?? info.role}</b></p>
      </div>
      {!signedIn ? (
        <AuthForm onDone={check} hint="Create an account (or sign in) to accept the invite." />
      ) : (
        <div className="card space-y-3 p-5">
          <label className="block">
            <span className="label">Your name</span>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="How teammates will see you" maxLength={60} onKeyDown={(e) => e.key === "Enter" && join()} />
          </label>
          {err && <p className="rounded-lg bg-rose-50 p-2.5 text-sm text-rose-700" role="alert">{err}</p>}
          <button className="btn-primary w-full" onClick={join} disabled={busy}>
            {busy ? <Loader2 size={14} className="animate-spin" /> : null} Join workspace
          </button>
        </div>
      )}
    </div>
  );
}
