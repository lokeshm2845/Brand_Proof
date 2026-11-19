"use client";
/**
 * Browser side of the Visual Compliance Engine: decodes creatives to pixels, runs the palette,
 * logo and OCR text-block analysis, and renders PDF pages. Everything runs on the user's device.
 */
import { analyzeImage } from "./image";
import { analyzeTextBlocks, excludeLogoLines, findLogo, mergeOcrLines, trimLogo, type LogoTemplate, type OcrLine, type RGBAImage } from "./vision";
import type { BrandKit, CreativePage, ImageAnalysis } from "./types";

export type Progress = (step: string) => void;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not load image"));
    img.src = src;
  });
}

export async function toRGBA(src: string, maxSide = 1200): Promise<RGBAImage> {
  const img = await loadImage(src);
  const s = Math.min(1, maxSide / Math.max(img.width, img.height));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(img.width * s));
  c.height = Math.max(1, Math.round(img.height * s));
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, c.width, c.height);
  const d = ctx.getImageData(0, 0, c.width, c.height);
  return { data: d.data, width: d.width, height: d.height };
}

// ── logo templates (cached per Brand Kit logo list) ──
let tplCache: { key: string; tpls: LogoTemplate[] } | null = null;
async function templatesFor(kit: BrandKit): Promise<LogoTemplate[]> {
  const logos = kit.logos ?? [];
  const key = logos.map((l) => `${l.id}:${l.kind}:${l.src.length}:${l.src.slice(-24)}`).join("|");
  if (tplCache?.key === key) return tplCache.tpls;
  const tpls: LogoTemplate[] = [];
  for (const l of logos) {
    try {
      tpls.push({ id: l.id, name: l.name, kind: l.kind, img: trimLogo(await toRGBA(l.src, 600)) });
    } catch {
      /* unreadable logo file: skip it */
    }
  }
  tplCache = { key, tpls };
  return tpls;
}

// ── OCR (tesseract.js, one shared worker) ──
let workerP: Promise<any> | null = null;
async function ocrWorker() {
  workerP ??= import("tesseract.js").then(({ createWorker }) => createWorker("eng"));
  try {
    return await workerP;
  } catch (e) {
    workerP = null;
    throw e;
  }
}

async function ocr(src: string): Promise<OcrLine[]> {
  const w = await ocrWorker();
  const { data } = await w.recognize(src);
  return (data.lines ?? []).map((ln: any) => ({ text: ln.text, confidence: ln.confidence, bbox: ln.bbox }));
}

const tick = () => new Promise((r) => setTimeout(r, 0));

/** Full visual analysis of one creative (data URL). OCR or logo failures degrade gracefully. */
export async function analyzeCreative(dataUrl: string, kit: BrandKit, progress: Progress = () => {}, page?: number, maxSide = 1200): Promise<ImageAnalysis> {
  const label = page ? ` (page ${page})` : "";
  progress(`Checking colours${label}…`);
  const base = await analyzeImage(dataUrl, kit.palette);
  const rgba = await toRGBA(dataUrl, maxSide);
  const result: ImageAnalysis = { ...base };

  progress(`Looking for the logo${label}…`);
  await tick();
  try {
    const t0 = performance.now();
    const tpls = await templatesFor(kit);
    if (tpls.length) result.logo = findLogo(rgba, tpls);
    result.logoMs = Math.round(performance.now() - t0);
  } catch {
    /* keep going without logo results */
  }

  progress(`Reading text on the creative${label} (first run downloads the OCR model)…`);
  try {
    const t0 = performance.now();
    // OCR at the same resolution the measurements use, so boxes line up
    const c = document.createElement("canvas");
    c.width = rgba.width;
    c.height = rgba.height;
    const ctx = c.getContext("2d")!;
    ctx.putImageData(new ImageData(new Uint8ClampedArray(rgba.data), rgba.width, rgba.height), 0, 0);
    const first = await ocr(c.toDataURL("image/png"));
    // Second pass on the inverted image catches light text on dark or saturated backgrounds,
    // which a single global threshold tends to miss.
    const inv = ctx.getImageData(0, 0, c.width, c.height);
    for (let i = 0; i < inv.data.length; i += 4) {
      inv.data[i] = 255 - inv.data[i];
      inv.data[i + 1] = 255 - inv.data[i + 1];
      inv.data[i + 2] = 255 - inv.data[i + 2];
    }
    ctx.putImageData(inv, 0, 0);
    const second = await ocr(c.toDataURL("image/png"));
    const lines = mergeOcrLines(first, second);
    // Text that belongs to the logo artwork is checked by the logo rules, not as content text
    const content = excludeLogoLines(lines, result.logo, rgba.width, rgba.height);
    result.blocks = analyzeTextBlocks(rgba, content, page);
    result.ocrText = content
      .filter((l) => l.confidence >= 45)
      .map((l) => l.text.replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .join(" ");
    result.ocrMs = Math.round(performance.now() - t0);
  } catch {
    result.blocks = [];
  }
  return result;
}

/** Renders up to `maxPages` pages of a PDF to JPEG data URLs and analyses each one. */
export async function analyzePdfPages(file: File, kit: BrandKit, progress: Progress = () => {}, maxPages = 5): Promise<{ pages: CreativePage[]; total: number }> {
  progress("Rendering PDF pages…");
  const { getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(await file.arrayBuffer()));
  const total = pdf.numPages;
  const pages: CreativePage[] = [];
  for (let i = 1; i <= Math.min(total, maxPages); i++) {
    const pg = await pdf.getPage(i);
    const vp0 = pg.getViewport({ scale: 1 });
    // analyse at 1600 px so small print is readable by OCR; keep a lighter copy for display
    const scale = Math.min(3, 1600 / Math.max(vp0.width, vp0.height));
    const vp = pg.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(vp.width);
    canvas.height = Math.round(vp.height);
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await pg.render({ canvasContext: ctx as any, viewport: vp } as any).promise;
    const full = canvas.toDataURL("image/jpeg", 0.92);
    const analysis = await analyzeCreative(full, kit, progress, i, 1600);
    const d = document.createElement("canvas");
    const k = Math.min(1, 900 / Math.max(canvas.width, canvas.height));
    d.width = Math.round(canvas.width * k);
    d.height = Math.round(canvas.height * k);
    d.getContext("2d")!.drawImage(canvas, 0, 0, d.width, d.height);
    pages.push({ page: i, dataUrl: d.toDataURL("image/jpeg", 0.75), analysis });
  }
  return { pages, total };
}
