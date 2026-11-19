"use client";
import { useState } from "react";
import { Loader2, LogIn, UserPlus } from "lucide-react";
import * as team from "@/lib/team";

/** Email + password sign-in / sign-up for team workspaces (Supabase Auth). */
export default function AuthForm({ onDone, hint }: { onDone: () => void; hint?: string }) {
  const [tab, setTab] = useState<"signin" | "signup">("signup");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setErr(null);
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return setErr("Enter a valid email address.");
    if (password.length < 6) return setErr("Password must be at least 6 characters.");
    setBusy(true);
    try {
      if (tab === "signup") await team.signUp(email, password);
      else await team.signIn(email, password);
      onDone();
    } catch (x: any) {
      setErr(x.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="card mx-auto max-w-md space-y-3 p-5" noValidate>
      <div className="flex rounded-lg border border-slate-200 p-0.5 text-sm">
        {(["signup", "signin"] as const).map((k) => (
          <button key={k} type="button" onClick={() => { setTab(k); setErr(null); }} className={`flex-1 rounded-md px-3 py-1.5 ${tab === k ? "bg-nova-soft font-semibold text-nova" : "text-slate-600"}`}>
            {k === "signup" ? "I’m new here" : "I have an account"}
          </button>
        ))}
      </div>
      {hint && <p className="text-xs text-slate-500">{hint}</p>}
      <label className="block">
        <span className="label">Email</span>
        <input className="input" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" />
      </label>
      <label className="block">
        <span className="label">Password</span>
        <input className="input" type="password" autoComplete={tab === "signup" ? "new-password" : "current-password"} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 6 characters" />
      </label>
      {err && <p className="rounded-lg bg-rose-50 p-2.5 text-sm text-rose-700" role="alert">{err}</p>}
      <button className="btn-primary w-full" disabled={busy}>
        {busy ? <Loader2 size={14} className="animate-spin" /> : tab === "signup" ? <UserPlus size={14} /> : <LogIn size={14} />}
        {tab === "signup" ? "Create account" : "Sign in"}
      </button>
    </form>
  );
}
