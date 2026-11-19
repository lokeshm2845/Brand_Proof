import { NextResponse } from "next/server";
import { aiRewriteRule, hasAI } from "@/lib/ai";
import { heuristicRewrite, themesFrom, validatePatterns } from "@/lib/ruleQuality";
import type { Rule } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Drafts a clearer version of a rule from reviewers' override reasons.
 * AI when available (patterns are validated before being returned); keyword heuristic otherwise.
 * Nothing is saved here — an admin reviews the impact preview and approves in the UI.
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const rule = body?.rule as Rule | undefined;
  const overridden = (Array.isArray(body?.overridden) ? body.overridden : []).slice(0, 40) as { reason: string; sentence: string; content?: string }[];
  const accepted = (Array.isArray(body?.accepted) ? body.accepted : []).slice(0, 40) as { sentence: string }[];
  if (!rule?.id || !overridden.length) return NextResponse.json({ error: "Need a rule and at least one override reason." }, { status: 400 });

  const fallback = () => {
    const h = heuristicRewrite(rule, overridden.map((o) => o.reason));
    return { themes: themesFrom(overridden.map((o) => o.reason)), proposal: h, note: hasAI() ? "AI was unavailable, so a keyword-based draft is shown." : undefined };
  };
  if (!hasAI()) return NextResponse.json(fallback());
  try {
    const r = await aiRewriteRule(rule, overridden, accepted);
    const patterns = (r.exception_patterns ?? []).map((p) => String(p).replace(/^\/|\/[gimsuy]*$/g, "")).filter(Boolean).slice(0, 8);
    const bad = validatePatterns(patterns);
    if (bad) {
      const fb = fallback();
      return NextResponse.json({ ...fb, themes: r.themes?.length ? r.themes : fb.themes, note: `The AI's patterns were rejected (${bad}). A keyword-based draft is shown instead.` });
    }
    return NextResponse.json({
      themes: (r.themes ?? []).map((t) => ({ theme: String(t.theme), count: Number(t.count) || 0, examples: (t.examples ?? []).slice(0, 4) })),
      proposal: {
        title: r.title || rule.title,
        description: r.description || rule.description,
        exceptionNote: r.exception_note || "",
        exceptionPatterns: patterns,
        scope: r.scope === "content" ? "content" : "sentence",
        source: "ai",
      },
    });
  } catch {
    return NextResponse.json(fallback());
  }
}
