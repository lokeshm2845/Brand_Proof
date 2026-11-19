// Team workspaces integration test against a real Supabase project (Round 3, Improvement 1).
// Creates three throw-away accounts on the *.demo-paynova.in test domain (no emails are ever sent there).
// Run:  npx tsx scripts/team-test.ts        (needs NEXT_PUBLIC_SUPABASE_URL / _ANON_KEY in .env.local)
import { readFileSync } from "fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8").split(/\r?\n/).filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
);
const URL_ = env.NEXT_PUBLIC_SUPABASE_URL, KEY = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!URL_ || !KEY) {
  console.error("Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local first.");
  process.exit(1);
}
const run = Date.now().toString(36);
const pw = `Bp-${run}-test!`;
let pass = 0, fail = 0;
const ok = (c: boolean, m: string) => { c ? pass++ : fail++; console.log(`${c ? "PASS" : "FAIL"} ${m}`); };

async function user(name: string): Promise<{ c: SupabaseClient; id: string }> {
  const c = createClient(URL_!, KEY!, { auth: { persistSession: false } });
  const email = `${name}.${run}@demo-paynova.in`;
  const { data, error } = await c.auth.signUp({ email, password: pw });
  if (error) throw new Error(`${name} sign-up: ${error.message}`);
  if (!data.session) throw new Error(`${name}: no session — turn OFF "Confirm email" in Supabase → Authentication → Email`);
  return { c, id: data.user!.id };
}

(async () => {
  const aisha = await user("aisha"); // creator + admin of workspace A
  const rohan = await user("rohan"); // brand reviewer in A
  const eve = await user("eve"); // admin of a different workspace B
  ok(true, "three accounts created and signed in");

  const kit = JSON.parse(JSON.stringify({ brandName: "PayNova", version: 1, rules: [], glossary: [], facts: [], palette: [], confidentialTerms: [], competitorNames: [], voice: "", updatedAt: new Date().toISOString() }));
  const { data: orgA, error: e1 } = await aisha.c.rpc("create_org", { org_name: `Test A ${run}`, my_name: "Aisha", kit });
  ok(!e1 && Boolean(orgA), `Aisha creates workspace A ${e1?.message ?? ""}`);
  const { data: orgB, error: e2 } = await eve.c.rpc("create_org", { org_name: `Test B ${run}`, my_name: "Eve", kit });
  ok(!e2 && Boolean(orgB), `Eve creates workspace B ${e2?.message ?? ""}`);

  const { data: inv, error: e3 } = await aisha.c.from("invites").insert({ org_id: orgA, role: "brand" }).select("token").single();
  ok(!e3 && Boolean(inv?.token), "admin creates a Brand reviewer invite");
  const { error: e4 } = await rohan.c.rpc("accept_invite", { tok: inv!.token, my_name: "Rohan" });
  ok(!e4, `Rohan joins workspace A as Brand reviewer ${e4?.message ?? ""}`);
  const { data: inv2 } = await eve.c.from("invites").select("token").eq("org_id", orgA);
  ok((inv2 ?? []).length === 0, "outsider cannot list workspace A's invites");

  const item = { id: `t_${run}`, title: "RLS test post", status: "checked", approvals: {}, comments: [], audit: [], versions: [] };
  const { error: e5 } = await aisha.c.from("content_items").insert({ id: item.id, org_id: orgA, data: item, status: "checked", rev: 1 });
  ok(!e5, `Aisha inserts a content item ${e5?.message ?? ""}`);
  // Aisha submits (rev 1 → 2)
  const sub = { ...item, status: "in_review" };
  const { data: u1 } = await aisha.c.from("content_items").update({ data: sub, status: "in_review", rev: 2 }).eq("id", item.id).eq("rev", 1).select("rev");
  ok(u1?.length === 1, "Aisha submits for review (rev 1 → 2)");
  // Rohan sees it and approves from his own session (rev 2 → 3)
  const { data: seen } = await rohan.c.from("content_items").select("data, rev").eq("id", item.id).single();
  ok(seen?.rev === 2 && (seen?.data as any).status === "in_review", "Rohan sees the submitted item on his device");
  const appr = { ...sub, status: "approved", approvals: { brand: { by: "Rohan", at: new Date().toISOString() } } };
  const { data: u2 } = await rohan.c.from("content_items").update({ data: appr, status: "approved", rev: 3 }).eq("id", item.id).eq("rev", 2).select("rev");
  ok(u2?.length === 1, "Rohan approves (rev 2 → 3)");
  // A stale write (rev 2 again) must be rejected by optimistic concurrency
  const { data: stale } = await aisha.c.from("content_items").update({ data: sub, status: "in_review", rev: 3 }).eq("id", item.id).eq("rev", 2).select("rev");
  ok((stale ?? []).length === 0, "stale write from an old copy is rejected (no lost updates)");
  // notification to Aisha
  const { error: e6 } = await rohan.c.from("notifications").insert({ org_id: orgA, user_id: aisha.id, item_id: item.id, text: "Approved" });
  ok(!e6, "Rohan notifies Aisha in-app");
  const { data: mine } = await aisha.c.from("notifications").select("text").eq("item_id", item.id);
  ok((mine ?? []).length === 1, "Aisha receives the notification");

  // ── Row-Level Security: Eve (workspace B) must not see or touch workspace A ──
  const { data: leak } = await eve.c.from("content_items").select("id").eq("org_id", orgA);
  ok((leak ?? []).length === 0, "RLS: outsider reads 0 of workspace A's items");
  const { data: leakKit } = await eve.c.from("brand_kits").select("org_id").eq("org_id", orgA);
  ok((leakKit ?? []).length === 0, "RLS: outsider cannot read workspace A's Brand Kit");
  const { data: leakMem } = await eve.c.from("memberships").select("email").eq("org_id", orgA);
  ok((leakMem ?? []).length === 0, "RLS: outsider cannot see workspace A's members or emails");
  const { error: e7 } = await eve.c.from("content_items").insert({ id: `x_${run}`, org_id: orgA, data: {}, status: "draft" });
  ok(Boolean(e7), "RLS: outsider cannot insert into workspace A");
  const { data: hijack } = await eve.c.from("content_items").update({ status: "approved" }).eq("id", item.id).select("id");
  ok((hijack ?? []).length === 0, "RLS: outsider cannot approve workspace A's item");
  const { error: e8 } = await eve.c.from("notifications").insert({ org_id: orgA, user_id: aisha.id, text: "spam" });
  ok(Boolean(e8), "RLS: outsider cannot send notifications into workspace A");
  const { data: snoop } = await eve.c.from("notifications").select("id").eq("user_id", aisha.id);
  ok((snoop ?? []).length === 0, "RLS: nobody can read someone else's notifications");
  // ── Roles: only admins edit the Brand Kit ──
  const { data: kitEdit } = await rohan.c.from("brand_kits").update({ version: 99 }).eq("org_id", orgA).select("version");
  ok((kitEdit ?? []).length === 0, "Roles: a Brand reviewer cannot change the Brand Kit");
  const { data: kitAdmin } = await aisha.c.from("brand_kits").update({ version: 2 }).eq("org_id", orgA).eq("version", 1).select("version");
  ok(kitAdmin?.length === 1, "Roles: the admin can change the Brand Kit");

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error("ERROR", e.message);
  process.exit(1);
});
