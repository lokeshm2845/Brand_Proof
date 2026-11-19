"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Bell, X } from "lucide-react";
import { useStore } from "@/lib/store";
import * as team from "@/lib/team";
import { timeAgo } from "./ui";

/** Opens the team workspace that was open before a refresh. Returns true once the app can render. */
export function useTeamResume() {
  const [ready, setReady] = useState(!team.teamConfigured);
  const lastOrgId = useStore((s) => s.lastOrgId);
  const mode = useStore((s) => s.mode);
  const started = useRef(false);
  useEffect(() => {
    if (!team.teamConfigured || started.current) return;
    started.current = true;
    if (mode === "team" || !lastOrgId) {
      setReady(true);
      return;
    }
    openWorkspace(lastOrgId)
      .catch(() => useStore.setState({ lastOrgId: null }))
      .finally(() => setReady(true));
  }, [lastOrgId, mode]);
  return ready;
}

export async function openWorkspace(orgId: string) {
  const user = await team.currentUser();
  if (!user) throw new Error("Signed out");
  const ws = (await team.myWorkspaces()).find((w) => w.orgId === orgId);
  if (!ws) throw new Error("You are no longer a member of this workspace.");
  const data = await team.loadWorkspace(orgId);
  const me = data.members.find((m) => m.userId === user.id) ?? { userId: user.id, name: ws.name, email: user.email ?? "", role: ws.role };
  useStore.getState().enterTeam({ orgId, orgName: ws.orgName, me, members: data.members }, { kit: data.kit, history: data.history, items: data.items, revs: data.revs });
}

/** Live sync + notification bell, rendered in the header while a team workspace is open. */
export function TeamLive() {
  const router = useRouter();
  const t = useStore((s) => s.team);
  const syncError = useStore((s) => s.syncError);
  const [notices, setNotices] = useState<team.Notice[]>([]);
  const [open, setOpen] = useState(false);
  const [live, setLive] = useState<string>("connecting");

  const refreshNotices = useCallback(() => {
    team.myNotices().then(setNotices).catch(() => {});
  }, []);

  useEffect(() => {
    if (!t) return;
    refreshNotices();
    const off = team.subscribe(t.orgId, t.me.userId, {
      item: (item, rev, deleted) => useStore.getState().applyRemoteItem(item, rev, deleted),
      kit: (kit, history) => useStore.getState().applyRemoteKit(kit, history),
      members: () => team.loadWorkspace(t.orgId).then((d) => useStore.getState().setMembers(d.members)).catch(() => {}),
      notice: refreshNotices,
      status: setLive,
    });
    const { data: sub } = team.sb().auth.onAuthStateChange((ev) => {
      if (ev === "SIGNED_OUT") useStore.getState().exitTeam();
    });
    return () => {
      off();
      sub.subscription.unsubscribe();
    };
  }, [t?.orgId, t?.me.userId, refreshNotices]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!t) return null;
  const unread = notices.filter((n) => !n.read);
  return (
    <>
      <div className="relative">
        <button
          aria-label={`Notifications (${unread.length} unread)`}
          className="relative rounded-lg border border-slate-200 bg-white p-1.5 text-slate-600 hover:text-nova"
          onClick={() => {
            setOpen(!open);
            if (!open && unread.length) team.markRead(unread.map((n) => n.id)).then(refreshNotices);
          }}
        >
          <Bell size={16} />
          {unread.length > 0 && <span className="absolute -right-1 -top-1 rounded-full bg-rose-600 px-1 text-[10px] font-bold text-white">{unread.length}</span>}
        </button>
        {open && (
          <div className="absolute right-0 z-40 mt-2 w-80 rounded-xl border bg-white p-2 shadow-xl">
            <p className="px-2 py-1 text-xs font-semibold text-slate-500">Notifications · {live === "SUBSCRIBED" ? "live" : "reconnecting…"}</p>
            {notices.length === 0 && <p className="px-2 py-4 text-center text-sm text-slate-400">Nothing yet.</p>}
            {notices.map((n) => (
              <button
                key={n.id}
                className={`block w-full rounded-lg px-2 py-2 text-left text-sm hover:bg-slate-50 ${n.read ? "text-slate-500" : "font-medium text-ink"}`}
                onClick={() => {
                  setOpen(false);
                  if (n.itemId) router.push(`/content/${n.itemId}`);
                }}
              >
                {n.text}
                <span className="block text-[11px] text-slate-400">{timeAgo(n.at)}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      {syncError && (
        <div className="fixed bottom-4 left-1/2 z-50 flex max-w-lg -translate-x-1/2 items-start gap-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-900 shadow-lg ring-1 ring-amber-200" role="alert">
          <span className="flex-1">{syncError}</span>
          <button aria-label="Dismiss" onClick={() => useStore.getState().clearSyncError()}>
            <X size={16} />
          </button>
        </div>
      )}
    </>
  );
}

export function TeamBadge() {
  const t = useStore((s) => s.team);
  if (!t) return null;
  return (
    <Link href="/team" className="hidden items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs text-emerald-800 sm:inline-flex" title="Shared team workspace">
      <span className="h-2 w-2 rounded-full bg-emerald-500" />
      <b>{t.orgName}</b> · {t.me.name} ({t.me.role === "brand" ? "Brand" : t.me.role === "legal" ? "Legal" : t.me.role === "admin" ? "Admin" : "Creator"})
    </Link>
  );
}
