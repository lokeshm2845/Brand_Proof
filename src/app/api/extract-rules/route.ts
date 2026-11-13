import { NextResponse } from "next/server";
import { aiExtractRules, hasAI } from "@/lib/ai";

export const runtime = "nodejs";
export const maxDuration = 60;

type Cat = "tone" | "terminology" | "claims" | "facts" | "messaging" | "visual" | "accessibility";

/** Fallback when no AI key is configured: turn imperative guideline lines into draft rules. */
function heuristic(text: string) {
  const lines = text
    .split(/\n|(?<=[.!?])\s+(?=[A-Z])/)
    .map((l) => l.replace(/^[\s\-•*\d.)]+/, "").trim())
    .filter((l) => l.length > 12 && /\b(must|never|always|avoid|do not|don't|should|only|use|keep|no )\b/i.test(l));
  const guess = (l: string): Cat => {
    const s = l.toLowerCase();
    if (/colou?r|logo|font|image|visual|palette/.test(s)) return "visual";
    if (/alt text|contrast|accessib|readab|screen reader/.test(s)) return "accessibility";
    if (/claim|guarantee|best|#1|number|statistic|fact|source/.test(s)) return "claims";
    if (/spell|name|term|capital|word/.test(s)) return "terminology";
    if (/competitor|message|benefit|call to action|cta/.test(s)) return "messaging";
    return "tone";
  };
  return lines.slice(0, 40).map((l) => ({
    category: guess(l),
    title: l.length > 70 ? l.slice(0, 67) + "…" : l,
    description: l,
    severity: /never|must|guarantee|legal|claim/i.test(l) ? "medium" : "low",
  }));
}

export async function POST(req: Request) {
  const { text } = await req.json().catch(() => ({ text: "" }));
  if (!text || String(text).trim().length < 20)
    return NextResponse.json({ error: "Paste at least a few lines of guidelines." }, { status: 400 });
  if (hasAI()) {
    try {
      const rules = await aiExtractRules(String(text));
      return NextResponse.json({ rules, mode: "ai" });
    } catch {
      /* fall through */
    }
  }
  return NextResponse.json({ rules: heuristic(String(text)), mode: "heuristic" });
}
