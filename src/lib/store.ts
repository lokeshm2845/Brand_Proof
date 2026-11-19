"use client";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { runRuleEngine, score, uid } from "./engine";
import { DEMO_KIT, personFor } from "./seed";
import * as team from "./team";
import type { Member } from "./team";
import type {
  BrandKit,
  ContentItem,
  CreativePage,
  Decision,
  Finding,
  ReviewMeta,
  RoleKey,
} from "./types";

export interface KitChange {
  version: number;
  at: string;
  by: string;
  change: string;
}

export interface TeamState {
  orgId: string;
  orgName: string;
  me: Member;
  members: Member[];
}

interface State {
  kit: BrandKit;
  kitHistory: KitChange[];
  items: ContentItem[];
  role: RoleKey;
  seeded: boolean;
  /** "demo" = private sandbox in this browser; "team" = shared Supabase workspace. */
  mode: "demo" | "team";
  team: TeamState | null;
  revs: Record<string, number>;
  demoSnapshot: { kit: BrandKit; kitHistory: KitChange[]; items: ContentItem[]; role: RoleKey } | null;
  lastOrgId: string | null;
  syncError: string | null;
  enterTeam: (t: TeamState, data: { kit: BrandKit; history: KitChange[]; items: ContentItem[]; revs: Record<string, number> }) => void;
  exitTeam: () => void;
  applyRemoteItem: (item: ContentItem, rev: number, deleted?: boolean) => void;
  applyRemoteKit: (kit: BrandKit, history: KitChange[]) => void;
  setMembers: (m: Member[]) => void;
  clearSyncError: () => void;
  setRole: (r: RoleKey) => void;
  saveKit: (kit: BrandKit, change: string) => void;
  resetDemo: () => void;
  ensureSeed: () => void;
  addItem: (item: ContentItem) => void;
  mutate: (id: string, fn: (it: ContentItem) => void) => void;
  removeItem: (id: string) => void;
}

const now = () => new Date().toISOString();

/** localStorage that never throws (private mode, quota exceeded, blocked storage). */
export let storageWarning: string | null = null;
const safeStorage = {
  getItem: (k: string) => {
    try {
      const v = localStorage.getItem(k);
      if (v !== null) JSON.parse(v); // damaged data → start fresh instead of failing to load
      return v;
    } catch {
      try {
        localStorage.removeItem(k);
      } catch {
        /* ignore */
      }
      return null;
    }
  },
  setItem: (k: string, v: string) => {
    try {
      localStorage.setItem(k, v);
      storageWarning = null;
    } catch {
      storageWarning = "Your browser storage is full, so the latest changes may not survive a page refresh. Delete a few large image items or use Reset demo.";
      if (typeof window !== "undefined") window.dispatchEvent(new Event("brandproof-storage"));
    }
  },
  removeItem: (k: string) => {
    try {
      localStorage.removeItem(k);
    } catch {
      /* ignore */
    }
  },
};
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

/** Display name of whoever is using the app right now (team member or demo persona). */
export function myName(): string {
  const s = useStore.getState();
  return s.mode === "team" && s.team ? s.team.me.name : personFor(s.role).name;
}

export function newItem(p: Partial<ContentItem> & { title: string; draftText: string }, role: RoleKey, kitVersion: number): ContentItem {
  const s = typeof window !== "undefined" ? useStore.getState() : null;
  const inTeam = s?.mode === "team" && s.team ? s.team : null;
  const who = inTeam ? inTeam.me.name : personFor(role).name;
  return {
    id: uid("c"),
    channel: "",
    audience: "",
    goal: "",
    format: "text",
    versions: [],
    status: "draft",
    needsLegal: false,
    approvals: {},
    comments: [],
    audit: [{ at: now(), by: who, action: "Created draft" }],
    decisions: [],
    createdBy: who,
    createdById: inTeam ? inTeam.me.userId : undefined,
    createdAt: now(),
    updatedAt: now(),
    kitVersion,
    ...p,
  };
}

/** Adds a reviewed version to an item (called after /api/review returns). */
export function withVersion(it: ContentItem, text: string, findings: Finding[], meta: ReviewMeta | undefined, by: string, note: string, kitVersion: number) {
  const n = it.versions.length + 1;
  it.versions.push({ n, text, createdAt: now(), by, note, findings, score: score(findings), meta });
  it.draftText = text;
  it.kitVersion = kitVersion;
  it.needsLegal = it.needsLegal || findings.some((f) => f.routeTo === "legal");
  if (it.status === "draft" || it.status === "changes_requested" || it.status === "checked") it.status = "checked";
  it.audit.push({ at: now(), by, action: `Brand check v${n}: ${findings.length} finding${findings.length === 1 ? "" : "s"}, score ${score(findings).total}` });
  it.updatedAt = now();
}

// ---------- demo history so Insights isn't empty on first visit ----------
function seedItems(kit: BrandKit): ContentItem[] {
  const day = (d: number, h = 10) => new Date(Date.UTC(2026, 10, d, h, 0)).toISOString();
  const defs: {
    title: string; channel: string; text: string; status: ContentItem["status"]; by: string; at: string;
    decisions: { rule: string; action: Decision["action"]; reason?: string; by: string }[]; approvedAt?: string;
  }[] = [
    {
      title: "Weekend offer push notification", channel: "Push notification",
      text: "Hurry! Weekend cashback on NovaPay UPI ends this Sunday. T&C apply.",
      status: "approved", by: "Aisha", at: day(6),
      decisions: [{ rule: "T-04", action: "rejected", reason: "The offer genuinely ends on Sunday, so the urgency is factual.", by: "Rohan" }],
      approvedAt: day(6, 15),
    },
    {
      title: "Merchant onboarding email", channel: "Email",
      text: "Join 3.1 lakh merchants who accept PayNova. Last chance to get zero onboarding fees this quarter (T&C apply).",
      status: "approved", by: "Aisha", at: day(8),
      decisions: [
        { rule: "T-04", action: "rejected", reason: "Quarter-end deadline is real and stated in the email.", by: "Rohan" },
        { rule: "F-RULE", action: "accepted", by: "Meera" },
      ],
      approvedAt: day(9, 11),
    },
    {
      title: "Diwali banner headline", channel: "Website banner",
      text: "LAST CHANCE: Diwali rewards on PayNova. T&C apply.",
      status: "changes_requested", by: "Aisha", at: day(10),
      decisions: [
        { rule: "T-04", action: "accepted", by: "Aisha" },
        { rule: "T-03", action: "rejected", reason: "Design team uses all-caps headlines on banners.", by: "Aisha" },
      ],
    },
    {
      title: "Student campaign app-store text", channel: "App store",
      text: "PayNova makes UPI simple for students. Hurry, sign up before exams start!",
      status: "in_review", by: "Aisha", at: day(12),
      decisions: [{ rule: "T-04", action: "rejected", reason: "Exam season is a real deadline for this student campaign.", by: "Aisha" }],
    },
  ];
  return defs.map((d) => {
    const it = newItem({ title: d.title, channel: d.channel, draftText: d.text, sample: true, createdAt: d.at, updatedAt: d.at }, "creator", kit.version);
    it.audit = [{ at: d.at, by: d.by, action: "Created draft" }];
    const findings = runRuleEngine(d.text, kit, { today: "2026-11-13" });
    for (const dec of d.decisions) {
      const f = findings.find((x) => x.ruleId === dec.rule && x.status === "open");
      if (f) {
        f.status = dec.action;
        f.reason = dec.reason;
        f.decidedBy = dec.by;
      }
      const rule = kit.rules.find((r) => r.id === dec.rule)!;
      it.decisions.push({ ruleId: dec.rule, category: rule.category, action: dec.action, reason: dec.reason, by: dec.by, at: d.at, origin: "rule" });
    }
    it.versions = [{ n: 1, text: d.text, createdAt: d.at, by: d.by, note: "Initial check", findings, score: score(findings), meta: { mode: "rules-only", aiProposed: 0, aiKept: 0, aiDropped: [], redactions: 0, ms: 12 } }];
    it.needsLegal = findings.some((f) => f.routeTo === "legal");
    it.audit.push({ at: d.at, by: d.by, action: `Brand check v1: ${findings.length} findings, score ${score(findings).total}` });
    it.status = d.status;
    if (d.status !== "checked") it.audit.push({ at: d.at, by: d.by, action: "Submitted for review" });
    if (d.approvedAt) {
      it.approvals.brand = { by: "Rohan", at: d.approvedAt };
      it.audit.push({ at: d.approvedAt, by: "Rohan", action: "Approved (Brand)" });
      if (it.needsLegal) {
        it.approvals.legal = { by: "Meera", at: d.approvedAt };
        it.audit.push({ at: d.approvedAt, by: "Meera", action: "Approved (Legal)" });
      }
      it.updatedAt = d.approvedAt;
    }
    if (d.status === "changes_requested") {
      it.comments.push({ id: uid("m"), by: "Rohan", role: "brand", at: day(10, 14), text: "Please drop the all-caps and the 'last chance' line — this offer has no end date." });
      it.audit.push({ at: day(10, 14), by: "Rohan", action: "Requested changes" });
    }
    return it;
  });
}

export const useStore = create<State>()(
  persist(
    (set, get) => ({
      kit: clone(DEMO_KIT),
      kitHistory: [{ version: 1, at: DEMO_KIT.updatedAt, by: "Kabir", change: "Imported PayNova brand book (demo)" }],
      items: [],
      role: "creator",
      seeded: false,
      mode: "demo",
      team: null,
      revs: {},
      demoSnapshot: null,
      lastOrgId: null,
      syncError: null,
      setRole: (role) => {
        if (get().mode === "team") return; // in a team, your role comes from your membership
        set({ role });
      },
      saveKit: (kit, change) => {
        const st = get();
        const v = st.kit.version + 1;
        const by = myName();
        const next = { ...clone(kit), version: v, updatedAt: now() };
        const history = [{ version: v, at: now(), by, change }, ...st.kitHistory].slice(0, 50);
        const prev = { kit: st.kit, kitHistory: st.kitHistory };
        set({ kit: next, kitHistory: history });
        if (st.mode === "team" && st.team) {
          team.saveTeamKit(st.team.orgId, next, history, st.kit.version).catch((e) => set({ ...prev, syncError: `Brand Kit not saved: ${e.message}` }));
        }
      },
      resetDemo: () => {
        if (get().mode === "team") return;
        const kit = clone(DEMO_KIT);
        set({
          kit,
          kitHistory: [{ version: 1, at: DEMO_KIT.updatedAt, by: "Kabir", change: "Imported PayNova brand book (demo)" }],
          items: seedItems(kit),
          seeded: true,
          role: "creator",
        });
      },
      ensureSeed: () => {
        if (get().mode === "demo" && !get().seeded) set({ items: [...seedItems(get().kit), ...get().items], seeded: true });
      },
      addItem: (item) => {
        set({ items: [item, ...get().items.filter((i) => i.id !== item.id)] });
        const st = get();
        if (st.mode === "team" && st.team) {
          set({ revs: { ...st.revs, [item.id]: 1 } });
          team.insertItem(st.team.orgId, item).catch((e) => set({ syncError: `Could not save “${item.title}”: ${e.message}` }));
        }
      },
      mutate: (id, fn) => {
        const before = get().items.find((i) => i.id === id);
        if (!before) return;
        const c = clone(before);
        fn(c);
        c.updatedAt = now();
        set({ items: get().items.map((it) => (it.id === id ? c : it)) });
        const st = get();
        if (st.mode === "team" && st.team) enqueuePush(id, fn, before, c);
      },
      removeItem: (id) => {
        set({ items: get().items.filter((i) => i.id !== id) });
        if (get().mode === "team") team.deleteItem(id).catch((e) => set({ syncError: `Could not delete: ${e.message}` }));
      },
      enterTeam: (t, data) => {
        const st = get();
        set({
          demoSnapshot: st.mode === "demo" ? { kit: st.kit, kitHistory: st.kitHistory, items: st.items, role: st.role } : st.demoSnapshot,
          mode: "team",
          team: t,
          role: t.me.role,
          kit: data.kit,
          kitHistory: data.history,
          items: data.items,
          revs: data.revs,
          lastOrgId: t.orgId,
          syncError: null,
        });
      },
      exitTeam: () => {
        const snap = get().demoSnapshot;
        set({
          mode: "demo",
          team: null,
          revs: {},
          lastOrgId: null,
          demoSnapshot: null,
          ...(snap ?? { kit: clone(DEMO_KIT), items: [], kitHistory: [], role: "creator" as RoleKey }),
        });
      },
      applyRemoteItem: (item, rev, deleted) => {
        if (get().mode !== "team") return;
        if (deleted) {
          set({ items: get().items.filter((i) => i.id !== item.id) });
          return;
        }
        if ((get().revs[item.id] ?? 0) > rev) return; // we already hold a newer copy
        const exists = get().items.some((i) => i.id === item.id);
        set({
          items: exists ? get().items.map((i) => (i.id === item.id ? item : i)) : [item, ...get().items],
          revs: { ...get().revs, [item.id]: rev },
        });
      },
      applyRemoteKit: (kit, history) => {
        if (get().mode !== "team" || kit.version < get().kit.version) return;
        set({ kit, kitHistory: history });
      },
      setMembers: (m) => {
        const t = get().team;
        if (!t) return;
        const me = m.find((x) => x.userId === t.me.userId) ?? t.me;
        set({ team: { ...t, members: m, me }, role: me.role });
      },
      clearSyncError: () => set({ syncError: null }),
    }),
    {
      name: "brandproof-workspace-v1",
      version: 2,
      storage: createJSONStorage(() => safeStorage),
      // Only the private demo sandbox is stored in the browser; team data always comes from the server.
      partialize: (s) =>
        s.mode === "team" && s.demoSnapshot
          ? ({ ...s.demoSnapshot, seeded: s.seeded, lastOrgId: s.lastOrgId } as any)
          : ({ kit: s.kit, kitHistory: s.kitHistory, items: s.items, role: s.role, seeded: s.seeded, lastOrgId: s.lastOrgId } as any),
      // v1 → v2: Round 3 adds logos and visual rules V-04…V-08 to the demo Brand Kit
      migrate: (persisted: any, from: number) => {
        if (persisted?.kit && from < 2) {
          const kit = persisted.kit as BrandKit;
          if (!kit.logos) kit.logos = clone(DEMO_KIT.logos ?? []);
          for (const r of DEMO_KIT.rules) if (!kit.rules.some((x) => x.id === r.id)) kit.rules.push(clone(r));
        }
        return persisted;
      },
    },
  ),
);

/** Page analyses without the page images (keeps API payloads small). */
const lightPages = (p?: CreativePage[]) => p?.map((x) => ({ ...x, dataUrl: "" }));

let aiStatus: Promise<boolean> | null = null;
export function aiEnabled(): Promise<boolean> {
  aiStatus ??= fetch("/api/status")
    .then((r) => r.json())
    .then((j) => Boolean(j.ai))
    .catch(() => false);
  return aiStatus;
}

/** Version is waiting on the AI layer (ignores stale flags left by a page reload). */
export function isAIPending(meta?: ReviewMeta) {
  return Boolean(meta?.aiPending && meta.startedAt && Date.now() - new Date(meta.startedAt).getTime() < 90_000);
}

/**
 * Runs a brand check on an item and saves it as a new version.
 * Rule-engine results appear instantly (computed in the browser); when AI is enabled the AI layer
 * runs in the background and its findings and fixes are merged into the same version on arrival.
 */
export async function reviewItem(itemId: string, text: string, note: string, by: string, onReady?: () => void): Promise<void> {
  const { kit, mutate } = useStore.getState();
  const it = useStore.getState().items.find((i) => i.id === itemId);
  if (!it) return;
  const intent = { channel: it.channel, audience: it.audience, goal: it.goal };
  const isImage = it.format === "image";
  const ai = await aiEnabled();

  // An image with no typed text needs the vision model to read it first, so that path stays blocking.
  if (!ai || (isImage && !text.trim())) {
    const r = await requestReview({ text, kit, intent, isImage, imageDataUrl: it.imageDataUrl, altText: it.altText, imageAnalysis: it.imageAnalysis, pages: lightPages(it.pages) });
    mutate(itemId, (x) => withVersion(x, r.text ?? text, r.findings, r.meta, by, note, kit.version));
    onReady?.();
    return;
  }

  const ruleFindings = runRuleEngine(text, kit, { isImage, altText: it.altText, image: it.imageAnalysis, pages: it.pages });
  const startedAt = new Date().toISOString();
  let n = 0;
  mutate(itemId, (x) => {
    withVersion(x, text, ruleFindings, { mode: "hybrid", aiProposed: 0, aiKept: 0, aiDropped: [], redactions: 0, ms: 0, aiPending: true, startedAt }, by, note, kit.version);
    n = x.versions.length;
  });
  onReady?.();

  const r = await requestReview({
    text, kit, intent, isImage, imageDataUrl: it.imageDataUrl, altText: it.altText, imageAnalysis: it.imageAnalysis,
    layers: "ai", ruleFindings, pages: lightPages(it.pages),
  });
  mutate(itemId, (x) => {
    const v = x.versions.find((vv) => vv.n === n);
    if (!v) return;
    const byId = new Map(r.findings.map((f) => [f.id, f]));
    // Update rule findings the user hasn't decided yet (AI may have added a fix or widened the quote).
    v.findings = v.findings.map((f) => {
      const u = byId.get(f.id);
      if (!u || f.status !== "open") return f;
      return { ...f, quote: u.quote, suggestion: u.suggestion, suggestionBy: u.suggestionBy };
    });
    const known = new Set(v.findings.map((f) => f.id));
    const added = r.findings.filter((f) => !known.has(f.id) && f.origin === "ai");
    v.findings.push(...added);
    v.meta = { ...r.meta, aiPending: false, startedAt };
    v.score = score(v.findings);
    x.needsLegal = x.needsLegal || added.some((f) => f.routeTo === "legal");
    x.audit.push({
      at: new Date().toISOString(),
      by: "BrandProof",
      action: r.meta.mode === "hybrid"
        ? `AI review for v${n}: ${added.length} new finding${added.length === 1 ? "" : "s"}, ${r.meta.aiDropped.length} filtered by the verifier (${r.meta.model}, ${(r.meta.ms / 1000).toFixed(1)}s)`
        : `AI review for v${n} unavailable — rule-engine results stand`,
    });
  });
}

/** Calls the review API and returns findings + meta. */
export async function requestReview(payload: {
  text: string;
  kit: BrandKit;
  intent: { channel?: string; audience?: string; goal?: string };
  isImage?: boolean;
  imageDataUrl?: string;
  altText?: string;
  imageAnalysis?: ContentItem["imageAnalysis"];
  layers?: "all" | "ai";
  ruleFindings?: Finding[];
  pages?: CreativePage[];
}): Promise<{ findings: Finding[]; meta: ReviewMeta; text: string }> {
  try {
    const res = await fetch("/api/review", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`Review failed (${res.status})`);
    return await res.json();
  } catch (e) {
    // Offline / server error: the rule engine also runs in the browser, so the product keeps working.
    const findings = runRuleEngine(payload.text, payload.kit, {
      isImage: payload.isImage,
      altText: payload.altText,
      image: payload.imageAnalysis,
      pages: payload.pages,
    });
    return {
      findings,
      text: payload.text,
      meta: {
        mode: "rules-only",
        aiProposed: 0,
        aiKept: 0,
        aiDropped: [],
        redactions: 0,
        ms: 0,
        note: "Server unreachable — the rule engine ran in your browser instead.",
      },
    };
  }
}


// ───────────── team sync: ordered saves, optimistic concurrency, notifications ─────────────
// Saves for the same item run one after another, so two quick clicks never race each other.
const queues = new Map<string, Promise<void>>();
function enqueuePush(id: string, fn: (it: ContentItem) => void, before: ContentItem, after: ContentItem) {
  const prev = queues.get(id) ?? Promise.resolve();
  const next = prev.then(() => pushItem(id, fn, before, after)).catch(() => {});
  queues.set(id, next);
}

async function pushItem(id: string, fn: (it: ContentItem) => void, before: ContentItem, after: ContentItem) {
  const st = useStore.getState();
  const t = st.team;
  if (!t) return;
  try {
    const rev = await team.updateItem(t.orgId, after, st.revs[id] ?? 1);
    useStore.setState({ revs: { ...useStore.getState().revs, [id]: rev } });
  } catch (e) {
    if (!(e instanceof team.ConflictError)) {
      useStore.setState({ syncError: `Not saved: ${(e as Error).message}` });
      return;
    }
    // Someone else saved first: re-apply this change on top of their version (once).
    try {
      const fresh = await team.fetchItem(id);
      const merged = clone(fresh.item);
      fn(merged);
      merged.updatedAt = now();
      const rev = await team.updateItem(t.orgId, merged, fresh.rev);
      useStore.setState({
        items: useStore.getState().items.map((i) => (i.id === id ? merged : i)),
        revs: { ...useStore.getState().revs, [id]: rev },
        syncError: "Someone else edited this item at the same time — your change was applied on top of theirs.",
      });
      after = merged;
    } catch (e2) {
      useStore.setState({ syncError: `Not saved — the item changed elsewhere. Refresh and try again. (${(e2 as Error).message})` });
      return;
    }
  }
  notifyTransition(before, after);
}

function notifyTransition(before: ContentItem, after: ContentItem) {
  const t = useStore.getState().team;
  if (!t) return;
  const me = t.me.userId;
  const byRole = (...roles: RoleKey[]) => t.members.filter((m) => roles.includes(m.role) && m.userId !== me).map((m) => m.userId);
  const creator = after.createdById && after.createdById !== me ? [after.createdById] : [];
  if (before.status !== after.status) {
    if (after.status === "in_review") {
      const reviewers = [...byRole("brand"), ...(after.needsLegal ? byRole("legal") : [])];
      team.notify(t.orgId, reviewers.length ? reviewers : byRole("admin"), `${t.me.name} submitted “${after.title}” for review${after.needsLegal ? " (Brand + Legal)" : ""}.`, after.id);
    } else if (after.status === "changes_requested") {
      team.notify(t.orgId, creator, `${t.me.name} requested changes on “${after.title}”.`, after.id);
    } else if (after.status === "approved") {
      team.notify(t.orgId, creator, `“${after.title}” is approved and ready to publish.`, after.id);
    }
  } else if (after.approvals.brand && !before.approvals.brand && after.needsLegal && !after.approvals.legal) {
    team.notify(t.orgId, byRole("legal"), `${t.me.name} approved “${after.title}” for Brand — Legal sign-off is next.`, after.id);
  }
  if (after.comments.length > before.comments.length) {
    const last = after.comments[after.comments.length - 1];
    const others = after.comments.map((c) => t.members.find((m) => m.name === c.by)?.userId).filter((u): u is string => Boolean(u));
    team.notify(t.orgId, [...new Set([...creator, ...others])].filter((u) => u !== me), `${t.me.name} commented on “${after.title}”: ${last.text.slice(0, 120)}`, after.id);
  }
}

/** The person using the app: the signed-in team member, or the demo persona picked in "Acting as". */
export function useMe(): { key: RoleKey; name: string; title: string } {
  const mode = useStore((s) => s.mode);
  const t = useStore((s) => s.team);
  const role = useStore((s) => s.role);
  if (mode === "team" && t) return { key: t.me.role, name: t.me.name, title: personFor(t.me.role).title };
  return personFor(role);
}
