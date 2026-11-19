// Evaluates the Visual Compliance Engine on the labelled creatives in eval/creatives.
// Run: npm run eval:visual        (add --no-ocr to evaluate logo checks only)
import { readFileSync } from "fs";
import { PNG } from "pngjs";
import { analyzeTextBlocks, excludeLogoLines, findLogo, mergeOcrLines, trimLogo, type LogoTemplate, type OcrLine, type RGBAImage } from "../src/lib/vision";
import { visualIssues, type VisualIssueCode } from "../src/lib/visualRules";

const load = (p: string): RGBAImage => {
  const png = PNG.sync.read(readFileSync(p));
  return { data: png.data, width: png.width, height: png.height };
};

const templates: LogoTemplate[] = [
  { id: "L-1", name: "PayNova logo (current)", kind: "approved", img: trimLogo(load("public/brand/paynova-logo.png")) },
  { id: "L-0", name: "PayNova logo (2023, retired)", kind: "outdated", img: trimLogo(load("public/brand/paynova-logo-old.png")) },
];
const useOcr = !process.argv.includes("--no-ocr");
const CODES: VisualIssueCode[] = ["LOGO_OUTDATED", "LOGO_STRETCHED", "LOGO_RECOLOURED", "LOGO_MISSING", "TEXT_CONTRAST", "TEXT_SMALL"];

(async () => {
  const labels: { file: string; issues: VisualIssueCode[] }[] = JSON.parse(readFileSync("eval/creatives/labels.json", "utf8"));
  let worker: any = null;
  if (useOcr) {
    const { createWorker } = await import("tesseract.js");
    worker = await createWorker("eng");
  }
  const per: Record<string, { tp: number; fp: number; fn: number }> = {};
  CODES.forEach((c) => (per[c] = { tp: 0, fp: 0, fn: 0 }));
  let exact = 0;
  const t0 = Date.now();
  for (const l of labels) {
    const img = load(`eval/creatives/${l.file}`);
    const logo = findLogo(img, templates);
    let lines: OcrLine[] = [];
    if (worker) {
      // same two passes as the app: original + inverted, merged, minus the logo's own wordmark
      const toLines = (data: any): OcrLine[] => (data.lines ?? []).map((ln: any) => ({ text: ln.text, confidence: ln.confidence, bbox: ln.bbox }));
      const first = toLines((await worker.recognize(`eval/creatives/${l.file}`)).data);
      const png = PNG.sync.read(readFileSync(`eval/creatives/${l.file}`));
      for (let i = 0; i < png.data.length; i += 4) { png.data[i] = 255 - png.data[i]; png.data[i + 1] = 255 - png.data[i + 1]; png.data[i + 2] = 255 - png.data[i + 2]; }
      const second = toLines((await worker.recognize(PNG.sync.write(png))).data);
      lines = excludeLogoLines(mergeOcrLines(first, second), logo, img.width, img.height);
    }
    const blocks = analyzeTextBlocks(img, lines);
    const got = new Set(visualIssues({ logo, blocks, hasLogos: true }).map((i) => i.code).filter((c) => useOcr || c.startsWith("LOGO")));
    const exp = new Set(l.issues.filter((c) => useOcr || c.startsWith("LOGO")));
    let ok = true;
    for (const c of CODES) {
      if (!useOcr && !c.startsWith("LOGO")) continue;
      if (got.has(c) && exp.has(c)) per[c].tp++;
      else if (got.has(c)) { per[c].fp++; ok = false; }
      else if (exp.has(c)) { per[c].fn++; ok = false; }
    }
    if (ok) exact++;
    const minC = blocks.length ? Math.min(...blocks.map((b) => b.contrast)).toFixed(1) : "-";
    const minPx = blocks.length ? Math.min(...blocks.map((b) => b.renderedPx)).toFixed(1) : "-";
    console.log(
      `${ok ? "ok  " : "MISS"} ${l.file.padEnd(20)} exp=[${[...exp].join(",")}] got=[${[...got].join(",")}]  logo=${logo.found ? `${logo.kind} s=${logo.score.toFixed(2)} a=${logo.aspect.toFixed(2)} dE=${logo.colourDeltaE?.toFixed(0)}` : `none s=${logo.score.toFixed(2)}`} blocks=${blocks.length} minContrast=${minC} minPx=${minPx}`,
    );
  }
  if (worker) await worker.terminate();
  let TP = 0, FP = 0, FN = 0;
  console.log("\nper issue type:");
  for (const c of CODES) {
    const v = per[c];
    if (!useOcr && !c.startsWith("LOGO")) continue;
    TP += v.tp; FP += v.fp; FN += v.fn;
    const p = v.tp + v.fp ? (100 * v.tp) / (v.tp + v.fp) : 100;
    const r = v.tp + v.fn ? (100 * v.tp) / (v.tp + v.fn) : 100;
    console.log(`  ${c.padEnd(16)} tp ${v.tp} fp ${v.fp} fn ${v.fn}  precision ${p.toFixed(0)}%  recall ${r.toFixed(0)}%`);
  }
  console.log(
    `\ncreatives=${labels.length} fully-correct=${exact}/${labels.length}  precision=${((100 * TP) / Math.max(1, TP + FP)).toFixed(1)}% recall=${((100 * TP) / Math.max(1, TP + FN)).toFixed(1)}%  time=${((Date.now() - t0) / 1000).toFixed(1)}s`,
  );
})();
