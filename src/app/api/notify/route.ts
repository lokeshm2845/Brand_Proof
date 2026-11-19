import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * Sends review notifications by email (best effort). In-app notifications are already stored by the
 * browser; this route only emails. It queries as the calling user, so Row-Level Security guarantees
 * the caller can only email members of a workspace they belong to.
 * Email is enabled when SMTP_HOST / SMTP_USER / SMTP_PASS (and optionally SMTP_PORT, SMTP_FROM) are set.
 */
const sent = new Map<string, number>(); // simple per-instance rate limit

export async function POST(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const auth = req.headers.get("authorization") ?? "";
  if (!url || !anon) return NextResponse.json({ emailed: 0, reason: "team workspaces not configured" });
  if (!auth.startsWith("Bearer ") || auth.length < 20) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const body = await req.json().catch(() => null);
  const orgId = String(body?.orgId ?? "");
  const userIds: string[] = Array.isArray(body?.userIds) ? body.userIds.slice(0, 20).map(String) : [];
  const text = String(body?.text ?? "").slice(0, 300);
  const itemUrl = String(body?.itemUrl ?? "");
  if (!orgId || !userIds.length || !text) return NextResponse.json({ error: "Bad request" }, { status: 400 });

  const db = createClient(url, anon, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
  const { data: who } = await db.auth.getUser(auth.slice(7));
  if (!who?.user) return NextResponse.json({ error: "Session expired" }, { status: 401 });
  const { data: members, error } = await db.from("memberships").select("user_id, email, display_name").eq("org_id", orgId).in("user_id", userIds);
  if (error) return NextResponse.json({ error: "Not allowed" }, { status: 403 });

  const host = process.env.SMTP_HOST, user = process.env.SMTP_USER, pass = process.env.SMTP_PASS;
  if (!host || !user || !pass) return NextResponse.json({ emailed: 0, reason: "email not configured (in-app notification only)" });

  const key = `${who.user.id}:${Math.floor(Date.now() / 60000)}`;
  if ((sent.get(key) ?? 0) > 20) return NextResponse.json({ emailed: 0, reason: "rate limited" }, { status: 429 });

  const nodemailer = await import("nodemailer");
  const tx = nodemailer.createTransport({ host, port: Number(process.env.SMTP_PORT ?? 465), secure: Number(process.env.SMTP_PORT ?? 465) === 465, auth: { user, pass } });
  let emailed = 0;
  const skipped: string[] = [];
  for (const m of members ?? []) {
    // demo/test addresses never receive mail
    if (/@(demo-paynova\.in|example\.(com|org|net))$/i.test(m.email)) {
      skipped.push(m.email);
      continue;
    }
    try {
      await tx.sendMail({
        from: process.env.SMTP_FROM ?? `BrandProof <${user}>`,
        to: m.email,
        subject: `BrandProof: ${text.slice(0, 80)}`,
        text: `Hi ${m.display_name},\n\n${text}\n\nOpen it: ${itemUrl}\n\n— BrandProof`,
        html: `<p>Hi ${escapeHtml(m.display_name)},</p><p>${escapeHtml(text)}</p><p><a href="${escapeHtml(itemUrl)}">Open in BrandProof</a></p><p style="color:#888">— BrandProof</p>`,
      });
      emailed++;
    } catch {
      skipped.push(m.email);
    }
  }
  sent.set(key, (sent.get(key) ?? 0) + emailed);
  return NextResponse.json({ emailed, skipped: skipped.length });
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
