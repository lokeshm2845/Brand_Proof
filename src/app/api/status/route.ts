import { NextResponse } from "next/server";
import { hasAI, MODEL } from "@/lib/ai";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ ai: hasAI(), model: hasAI() ? MODEL : null });
}
