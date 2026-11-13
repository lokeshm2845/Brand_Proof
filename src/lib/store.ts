"use client";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { runRuleEngine, score, uid } from "./engine";
import { DEMO_KIT, personFor } from "./seed";
import type {
  BrandKit,
  ContentItem,
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

interface State {
  kit: BrandKit;
  kitHistory: KitChange[];
  items: ContentItem[];
  role: RoleKey;
  seeded: boolean;
  setRole: (r: RoleKey) => void;
  saveKit: (kit: BrandKit, change: string) => void;
  resetDemo: () => void;
  ensureSeed: () => void;
  addItem: (item: ContentItem) => void;
  mutate: (id: string, fn: (it: ContentItem) => void) => void;
  removeItem: (id: string) => void;
}

const now = () => new Date().toISOString();
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

export function newItem(p: Partial<ContentItem> & { title: string; draftText: string }, role: RoleKey, kitVersion: number): ContentItem {
  const who = personFor(role).name;
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
      setRole: (role) => set({ role }),
      saveKit: (kit, change) => {
        const v = get().kit.version + 1;
        const by = personFor(get().role).name;
        set({
          kit: { ...clone(kit), version: v, updatedAt: now() },
          kitHistory: [{ version: v, at: now(), by, change }, ...get().kitHistory].slice(0, 50),
        });
      },
      resetDemo: () => {
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
        if (!get().seeded) set({ items: [...seedItems(get().kit), ...get().items], seeded: true });
      },
      addItem: (item) => set({ items: [item, ...get().items] }),
      mutate: (id, fn) =>
        set({
          items: get().items.map((it) => {
            if (it.id !== id) return it;
            const c = clone(it);
            fn(c);
            c.updatedAt = now();
            return c;
          }),
        }),
      removeItem: (id) => set({ items: get().items.filter((i) => i.id !== id) }),
    }),
    { name: "brandproof-workspace-v1" },
  ),
);

/** Calls the review API and returns findings + meta. */
export async function requestReview(payload: {
  text: string;
  kit: BrandKit;
  intent: { channel?: string; audience?: string; goal?: string };
  isImage?: boolean;
  imageDataUrl?: string;
  altText?: string;
  imageAnalysis?: ContentItem["imageAnalysis"];
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
