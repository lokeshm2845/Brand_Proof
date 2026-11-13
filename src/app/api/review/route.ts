import { NextResponse } from "next/server";
import { aiReview, hasAI, readCreative } from "@/lib/ai";
import { runRuleEngine } from "@/lib/engine";
import type { BrandKit, Finding, ImageAnalysis, ReviewMeta } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

interface Body {
  text: string;
  kit: BrandKit;
  intent?: { channel?: string; audience?: string; goal?: string };
  isImage?: boolean;
  imageDataUrl?: string;
  altText?: string;
  imageAnalysis?: ImageAnalysis;
  /**
   * "all" (default): vision + rule engine + AI in one blocking call.
   * "ai": the browser already ran the rule engine and sends its findings; only the AI layer runs here,
   *       so the user sees rule results instantly and AI results are merged in when they arrive.
   */
  layers?: "all" | "ai";
  ruleFindings?: Finding[];
}

export async function POST(req: Request) {
  const t0 = Date.now();
  let body: Body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const { kit } = body;
  if (!kit?.rules) return NextResponse.json({ error: "Missing brand kit" }, { status: 400 });
  let text = (body.text ?? "").slice(0, 20000);
  const aiOnly = body.layers === "ai" && Array.isArray(body.ruleFindings);

  const meta: ReviewMeta = {
    mode: hasAI() ? "hybrid" : "rules-only",
    aiProposed: 0,
    aiKept: 0,
    aiDropped: [],
    redactions: 0,
    ms: 0,
  };
  const notes: string[] = [];

  // 1) Creative: read its text + draft alt text (vision model)
  if (body.isImage && body.imageDataUrl && hasAI()) {
    try {
      const v = await readCreative(body.imageDataUrl);
      if (!aiOnly && !text.trim() && v?.text_in_image) {
        text = String(v.text_in_image);
        meta.extractedText = text;
        notes.push("Text was read from the creative by the vision model — please confirm it is correct.");
      }
      if (v?.alt_text) meta.altTextSuggestion = String(v.alt_text);
    } catch {
      notes.push("Could not read the image with AI (no alt-text draft).");
    }
  }

  // 2) Deterministic layer (or the browser's copy of it)
  const ruleFindings: Finding[] = aiOnly
    ? (body.ruleFindings as Finding[]).slice(0, 200)
    : runRuleEngine(text, kit, { isImage: body.isImage, altText: body.altText, image: body.imageAnalysis });
  if (meta.altTextSuggestion) {
    const a3 = ruleFindings.find((f) => f.ruleId === "A-03");
    if (a3 && a3.suggestion === undefined) {
      a3.suggestion = meta.altTextSuggestion;
      a3.suggestionBy = "ai";
    }
  }

  // 3) AI layer (grounded + verified). Falls back to rules-only if anything fails.
  let aiFindings: Finding[] = [];
  if (hasAI() && text.trim()) {
    try {
      const r = await aiReview(text, kit, body.intent ?? {}, ruleFindings);
      aiFindings = r.findings;
      Object.assign(meta, r.meta);
    } catch (e: any) {
      meta.mode = "rules-only";
      meta.model = undefined;
      notes.push(`AI reviewer unavailable (${String(e?.message ?? e).slice(0, 140)}). Showing rule-engine results only.`);
    }
  } else if (!hasAI()) {
    notes.push("AI layer is switched off on this deployment (no API key). All findings come from the deterministic rule engine.");
  }

  meta.ms = Date.now() - t0;
  if (notes.length) meta.note = [meta.note, ...notes].filter(Boolean).join(" ");
  return NextResponse.json({ findings: [...ruleFindings, ...aiFindings], meta, text });
}
