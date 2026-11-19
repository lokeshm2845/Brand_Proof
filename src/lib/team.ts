"use client";
/**
 * Team workspaces (Round 3, Improvement 1): Supabase Auth + Postgres with Row-Level Security.
 * Every query runs as the signed-in user, so the database itself enforces who can see what.
 */
import { createClient, type RealtimeChannel, type SupabaseClient } from "@supabase/supabase-js";
import type { BrandKit, ContentItem, RoleKey } from "./types";

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

let client: SupabaseClient | null = null;
export const teamConfigured = Boolean(URL_ && KEY);
export function sb(): SupabaseClient {
  if (!teamConfigured) throw new Error("Team workspaces are not configured on this deployment.");
  client ??= createClient(URL_!, KEY!, { auth: { persistSession: true, autoRefreshToken: true, storageKey: "brandproof-auth" } });
  return client;
}

export interface Member {
  userId: string;
  name: string;
  email: string;
  role: RoleKey;
}
export interface Workspace {
  orgId: string;
  orgName: string;
  role: RoleKey;
  name: string;
}
export interface Notice {
  id: number;
  itemId: string | null;
  text: string;
  read: boolean;
  at: string;
}

const friendly = (e: any): Error => {
  const m = String(e?.message ?? e);
  if (/Invalid login credentials/i.test(m)) return new Error("Email or password is wrong.");
  if (/already registered/i.test(m)) return new Error("This email already has an account — sign in instead.");
  if (/Password should be/i.test(m)) return new Error("Password must be at least 6 characters.");
  if (/Email not confirmed/i.test(m)) return new Error("Confirm your email first (check your inbox), then sign in.");
  if (/rate limit/i.test(m)) return new Error("Too many attempts — wait a minute and try again.");
  if (/Failed to fetch|NetworkError/i.test(m)) return new Error("Can't reach the server. Check your connection and try again.");
  return new Error(m.replace(/^.*?:\s*/, "") || "Something went wrong.");
};

// ── auth ──
export async function currentUser() {
  const { data } = await sb().auth.getSession();
  return data.session?.user ?? null;
}
export async function signUp(email: string, password: string) {
  const { data, error } = await sb().auth.signUp({ email: email.trim(), password });
  if (error) throw friendly(error);
  if (!data.session) throw new Error("Account created. Confirm your email from the link we sent, then sign in.");
  return data.user!;
}
export async function signIn(email: string, password: string) {
  const { data, error } = await sb().auth.signInWithPassword({ email: email.trim(), password });
  if (error) throw friendly(error);
  return data.user;
}
export async function signOut() {
  await sb().auth.signOut();
}
export async function accessToken() {
  const { data } = await sb().auth.getSession();
  return data.session?.access_token ?? null;
}

// ── workspaces ──
export async function myWorkspaces(): Promise<Workspace[]> {
  const u = await currentUser();
  if (!u) return [];
  const { data, error } = await sb().from("memberships").select("org_id, role, display_name, organizations(name)").eq("user_id", u.id);
  if (error) throw friendly(error);
  return (data ?? []).map((m: any) => ({ orgId: m.org_id, orgName: m.organizations?.name ?? "Workspace", role: m.role, name: m.display_name }));
}
export async function createWorkspace(orgName: string, myName: string, kit: BrandKit) {
  const { data, error } = await sb().rpc("create_org", { org_name: orgName, my_name: myName, kit: { ...kit, version: 1 } });
  if (error) throw friendly(error);
  return data as string;
}
export async function createInvite(orgId: string, role: RoleKey) {
  const { data, error } = await sb().from("invites").insert({ org_id: orgId, role }).select("token").single();
  if (error) throw friendly(error);
  return `${window.location.origin}/join/${data.token}`;
}
export async function inviteInfo(token: string) {
  const { data, error } = await sb().rpc("invite_info", { tok: token });
  if (error) throw friendly(error);
  return (data?.[0] ?? null) as { org_name: string; role: RoleKey; expired: boolean } | null;
}
export async function acceptInvite(token: string, myName: string) {
  const { data, error } = await sb().rpc("accept_invite", { tok: token, my_name: myName });
  if (error) throw friendly(error);
  return data as string;
}
export async function setMemberRole(orgId: string, userId: string, role: RoleKey) {
  const { error } = await sb().from("memberships").update({ role }).eq("org_id", orgId).eq("user_id", userId);
  if (error) throw friendly(error);
}

// ── data ──
export async function loadWorkspace(orgId: string) {
  const [kitR, itemsR, memR] = await Promise.all([
    sb().from("brand_kits").select("version, data, history").eq("org_id", orgId).single(),
    sb().from("content_items").select("id, data, rev").eq("org_id", orgId).order("updated_at", { ascending: false }).limit(300),
    sb().from("memberships").select("user_id, display_name, email, role").eq("org_id", orgId),
  ]);
  if (kitR.error) throw friendly(kitR.error);
  if (itemsR.error) throw friendly(itemsR.error);
  if (memR.error) throw friendly(memR.error);
  const kit = { ...(kitR.data.data as BrandKit), version: kitR.data.version };
  const items = (itemsR.data ?? []).map((r: any) => r.data as ContentItem);
  const revs = Object.fromEntries((itemsR.data ?? []).map((r: any) => [r.id, r.rev as number]));
  const members: Member[] = (memR.data ?? []).map((m: any) => ({ userId: m.user_id, name: m.display_name, email: m.email, role: m.role }));
  return { kit, history: (kitR.data.history ?? []) as any[], items, revs, members };
}

export async function insertItem(orgId: string, item: ContentItem) {
  const { error } = await sb().from("content_items").insert({ id: item.id, org_id: orgId, data: item, status: item.status, rev: 1 });
  if (error) throw friendly(error);
  return 1;
}

export class ConflictError extends Error {}

/** Optimistic concurrency: the update only applies if nobody else saved the item in the meantime. */
export async function updateItem(orgId: string, item: ContentItem, expectedRev: number) {
  const { data, error } = await sb()
    .from("content_items")
    .update({ data: item, status: item.status, rev: expectedRev + 1, updated_at: new Date().toISOString() })
    .eq("id", item.id)
    .eq("org_id", orgId)
    .eq("rev", expectedRev)
    .select("rev");
  if (error) throw friendly(error);
  if (!data?.length) throw new ConflictError("Someone else changed this item at the same time.");
  return data[0].rev as number;
}

export async function fetchItem(id: string) {
  const { data, error } = await sb().from("content_items").select("data, rev").eq("id", id).single();
  if (error) throw friendly(error);
  return { item: data.data as ContentItem, rev: data.rev as number };
}

export async function deleteItem(id: string) {
  const { error } = await sb().from("content_items").delete().eq("id", id);
  if (error) throw friendly(error);
}

export async function saveTeamKit(orgId: string, kit: BrandKit, history: any[], expectedVersion: number) {
  const { data, error } = await sb()
    .from("brand_kits")
    .update({ data: kit, version: kit.version, history, updated_at: new Date().toISOString() })
    .eq("org_id", orgId)
    .eq("version", expectedVersion)
    .select("version");
  if (error) throw friendly(error);
  if (!data?.length) throw new ConflictError("The Brand Kit was changed by someone else. Reload and try again.");
}

// ── notifications ──
export async function myNotices(): Promise<Notice[]> {
  const { data, error } = await sb().from("notifications").select("id, item_id, text, read, created_at").order("created_at", { ascending: false }).limit(30);
  if (error) throw friendly(error);
  return (data ?? []).map((n: any) => ({ id: n.id, itemId: n.item_id, text: n.text, read: n.read, at: n.created_at }));
}
export async function markRead(ids: number[]) {
  if (!ids.length) return;
  await sb().from("notifications").update({ read: true }).in("id", ids);
}

/** In-app notification rows (RLS: only to members of the same workspace) + best-effort email. */
export async function notify(orgId: string, userIds: string[], text: string, itemId: string) {
  const targets = [...new Set(userIds)];
  if (!targets.length) return;
  const { error } = await sb().from("notifications").insert(targets.map((u) => ({ org_id: orgId, user_id: u, text: text.slice(0, 300), item_id: itemId })));
  if (error) console.warn("notification insert failed", error.message);
  try {
    const token = await accessToken();
    await fetch("/api/notify", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ orgId, userIds: targets, text, itemUrl: `${window.location.origin}/content/${itemId}` }),
    });
  } catch {
    /* email is best-effort */
  }
}

// ── realtime ──
export function subscribe(
  orgId: string,
  userId: string,
  on: { item: (item: ContentItem, rev: number, deleted?: boolean) => void; kit: (kit: BrandKit, history: any[]) => void; members: () => void; notice: () => void; status?: (s: string) => void },
): () => void {
  const ch: RealtimeChannel = sb()
    .channel(`org-${orgId}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "content_items", filter: `org_id=eq.${orgId}` }, (p: any) => {
      if (p.eventType === "DELETE") on.item({ id: p.old.id } as ContentItem, 0, true);
      else on.item(p.new.data as ContentItem, p.new.rev as number);
    })
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "brand_kits", filter: `org_id=eq.${orgId}` }, (p: any) =>
      on.kit({ ...(p.new.data as BrandKit), version: p.new.version }, p.new.history ?? []),
    )
    .on("postgres_changes", { event: "*", schema: "public", table: "memberships", filter: `org_id=eq.${orgId}` }, () => on.members())
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` }, () => on.notice())
    .subscribe((s) => on.status?.(s));
  return () => {
    sb().removeChannel(ch);
  };
}
