import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 30;

/** Extracts plain text from an uploaded DOCX or PDF. Files are processed in memory and never stored. */
export async function POST(req: Request) {
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "No file" }, { status: 400 });
  if (file.size > 4 * 1024 * 1024) return NextResponse.json({ error: "File is larger than 4 MB" }, { status: 413 });
  const name = file.name.toLowerCase();
  const buf = Buffer.from(await file.arrayBuffer());
  try {
    if (name.endsWith(".docx")) {
      const mammoth = await import("mammoth");
      const r = await mammoth.extractRawText({ buffer: buf });
      return NextResponse.json({ text: r.value.replace(/\n{3,}/g, "\n\n").trim(), format: "docx" });
    }
    if (name.endsWith(".pdf")) {
      const { extractText, getDocumentProxy } = await import("unpdf");
      const pdf = await getDocumentProxy(new Uint8Array(buf));
      const { text } = await extractText(pdf, { mergePages: true });
      const t = (Array.isArray(text) ? text.join("\n") : text).replace(/[ \t]+/g, " ").trim();
      return NextResponse.json({ text: t, format: "pdf" });
    }
    if (name.endsWith(".txt") || name.endsWith(".md")) {
      return NextResponse.json({ text: buf.toString("utf8"), format: "text" });
    }
    return NextResponse.json({ error: "Supported files: .docx, .pdf, .txt" }, { status: 415 });
  } catch (e: any) {
    return NextResponse.json({ error: `Could not read file: ${String(e?.message ?? e).slice(0, 120)}` }, { status: 422 });
  }
}
