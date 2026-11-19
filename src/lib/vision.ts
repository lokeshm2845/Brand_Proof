/**
 * BrandProof Visual Compliance Engine (pure TypeScript, no DOM).
 * Works on raw RGBA pixel buffers so the exact same code runs in the browser (canvas) and in
 * Node (pngjs) for the labelled evaluation in eval/creatives.
 *
 *  - Logo detection: multi-scale, multi-aspect normalised cross-correlation on edge maps
 *    (edges make matching robust to recolouring); decides current vs outdated logo,
 *    stretched (aspect changed) and recoloured (CIE Lab ΔE of logo ink).
 *  - Text blocks: given OCR line boxes, separates text from background pixels with 2-means
 *    clustering and computes the WCAG contrast ratio and the rendered size on a phone.
 */

export interface RGBAImage {
  data: Uint8ClampedArray | Uint8Array;
  width: number;
  height: number;
}
export interface Box {
  x: number; // normalised 0..1
  y: number;
  w: number;
  h: number;
  page?: number;
}
export interface LogoTemplate {
  id: string;
  name: string;
  kind: "approved" | "outdated";
  img: RGBAImage;
}
export interface LogoResult {
  found: boolean;
  templateId?: string;
  templateName?: string;
  kind?: "approved" | "outdated";
  score: number;
  approvedScore: number;
  outdatedScore: number;
  box?: Box;
  aspect: number; // height/width of the match relative to the template (1 = undistorted)
  colourDeltaE?: number;
}
export interface OcrLine {
  text: string;
  confidence: number;
  bbox: { x0: number; y0: number; x1: number; y1: number };
}
export interface TextBlock {
  text: string;
  box: Box;
  fg: string;
  bg: string;
  contrast: number;
  renderedPx: number;
  large: boolean;
}

// ───────────────────────── basic image ops ─────────────────────────
export function resizeRGBA(img: RGBAImage, w: number, h: number): RGBAImage {
  const out = new Uint8ClampedArray(w * h * 4);
  const sx = img.width / w;
  const sy = img.height / h;
  for (let y = 0; y < h; y++) {
    const y0 = Math.floor(y * sy);
    const y1 = Math.max(y0 + 1, Math.floor((y + 1) * sy));
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor(x * sx);
      const x1 = Math.max(x0 + 1, Math.floor((x + 1) * sx));
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let yy = y0; yy < Math.min(y1, img.height); yy++) {
        for (let xx = x0; xx < Math.min(x1, img.width); xx++) {
          const i = (yy * img.width + xx) * 4;
          r += img.data[i]; g += img.data[i + 1]; b += img.data[i + 2]; a += img.data[i + 3]; n++;
        }
      }
      const o = (y * w + x) * 4;
      out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n; out[o + 3] = a / n;
    }
  }
  return { data: out, width: w, height: h };
}

/** Crops away fully transparent (or uniform-corner) padding around a logo. */
export function trimLogo(img: RGBAImage): RGBAImage {
  const { width: w, height: h, data } = img;
  const transparent = data[3] < 128;
  const c = [data[0], data[1], data[2]];
  const isBg = (i: number) =>
    transparent ? data[i + 3] < 40 : Math.abs(data[i] - c[0]) + Math.abs(data[i + 1] - c[1]) + Math.abs(data[i + 2] - c[2]) < 24;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (!isBg((y * w + x) * 4)) {
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
  if (x1 < 0) return img;
  const nw = x1 - x0 + 1, nh = y1 - y0 + 1;
  const out = new Uint8ClampedArray(nw * nh * 4);
  for (let y = 0; y < nh; y++) out.set(data.subarray(((y + y0) * w + x0) * 4, ((y + y0) * w + x0 + nw) * 4), y * nw * 4);
  return { data: out, width: nw, height: nh };
}

/** Luminance; transparent pixels are composited on white. */
export function toGray(img: RGBAImage): Float32Array {
  const g = new Float32Array(img.width * img.height);
  for (let i = 0, p = 0; p < g.length; i += 4, p++) {
    const a = img.data[i + 3] / 255;
    const r = img.data[i] * a + 255 * (1 - a);
    const gg = img.data[i + 1] * a + 255 * (1 - a);
    const b = img.data[i + 2] * a + 255 * (1 - a);
    g[p] = 0.299 * r + 0.587 * gg + 0.114 * b;
  }
  return g;
}

function blur3(g: Float32Array, w: number, h: number): Float32Array {
  const o = new Float32Array(g.length);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let s = 0, n = 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx, yy = y + dy;
          if (xx >= 0 && yy >= 0 && xx < w && yy < h) { s += g[yy * w + xx]; n++; }
        }
      o[y * w + x] = s / n;
    }
  return o;
}

export function edges(g: Float32Array, w: number, h: number): Float32Array {
  const b = blur3(g, w, h);
  const o = new Float32Array(g.length);
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx = -b[i - w - 1] - 2 * b[i - 1] - b[i + w - 1] + b[i - w + 1] + 2 * b[i + 1] + b[i + w + 1];
      const gy = -b[i - w - 1] - 2 * b[i - w] - b[i - w + 1] + b[i + w - 1] + 2 * b[i + w] + b[i + w + 1];
      o[i] = Math.sqrt(gx * gx + gy * gy);
    }
  return o;
}

// ───────────────────────── colour ─────────────────────────
export function rgbToLab(r: number, g: number, b: number): [number, number, number] {
  const f = (c: number) => {
    c /= 255;
    return c > 0.04045 ? Math.pow((c + 0.055) / 1.055, 2.4) : c / 12.92;
  };
  const [R, G, B] = [f(r), f(g), f(b)];
  const X = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047;
  const Y = R * 0.2126 + G * 0.7152 + B * 0.0722;
  const Z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
  const p = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return [116 * p(Y) - 16, 500 * (p(X) - p(Y)), 200 * (p(Y) - p(Z))];
}
export const deltaE = (a: [number, number, number], b: [number, number, number]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const relLum = (r: number, g: number, b: number) => {
  const f = (c: number) => {
    c /= 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
export function wcagContrast(a: number[], b: number[]) {
  const [x, y] = [relLum(a[0], a[1], a[2]), relLum(b[0], b[1], b[2])].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}
export const hex = (c: number[]) => "#" + c.slice(0, 3).map((v) => Math.round(v).toString(16).padStart(2, "0")).join("").toUpperCase();

// ───────────────────────── template matching ─────────────────────────
/**
 * A matchable image at one resolution: intensity map + edge map, each with integral images
 * so the local mean/variance of any window is O(1).
 */
interface Pyr {
  W: number;
  H: number;
  maps: { I: Float32Array; S: Float64Array; SS: Float64Array }[]; // [intensity, edges]
}
interface Match { score: number; x: number; y: number; tw: number; th: number; aspect: number; wf: number }

function integrals(I: Float32Array, W: number, H: number) {
  const W1 = W + 1;
  const S = new Float64Array(W1 * (H + 1));
  const SS = new Float64Array(W1 * (H + 1));
  for (let y = 0; y < H; y++) {
    let rs = 0, rss = 0;
    for (let x = 0; x < W; x++) {
      const v = I[y * W + x];
      rs += v; rss += v * v;
      S[(y + 1) * W1 + x + 1] = S[y * W1 + x + 1] + rs;
      SS[(y + 1) * W1 + x + 1] = SS[y * W1 + x + 1] + rss;
    }
  }
  return { S, SS };
}

function pyramidLevel(img: RGBAImage, W: number): Pyr {
  const H = Math.max(1, Math.round((img.height * W) / img.width));
  const small = resizeRGBA(img, W, H);
  const g = toGray(small);
  const e = edges(g, W, H);
  return { W, H, maps: [g, e].map((I) => ({ I, ...integrals(I, W, H) })) };
}

function zeroMean(T: Float32Array) {
  let m = 0;
  for (let i = 0; i < T.length; i++) m += T[i];
  m /= T.length;
  const Z = new Float32Array(T.length);
  let n = 0;
  for (let i = 0; i < T.length; i++) { Z[i] = T[i] - m; n += Z[i] * Z[i]; }
  return { Z, norm: Math.sqrt(n) };
}

/**
 * Combined zero-mean NCC: average of intensity NCC and edge NCC. Intensity tells a solid logo
 * icon apart from plain text; edges keep the match working when the logo is recoloured.
 * Returns the best positions (local maxima) in the searched region.
 */
function nccSearch(P: Pyr, tpl: RGBAImage, tw: number, th: number, stride: number, region?: { x0: number; y0: number; x1: number; y1: number }, keep = 1) {
  const small = resizeRGBA(tpl, tw, th);
  const g = toGray(small);
  const T = [zeroMean(g), zeroMean(edges(g, tw, th))];
  const n = tw * th;
  const W1 = P.W + 1;
  const x0 = Math.max(0, region?.x0 ?? 0), y0 = Math.max(0, region?.y0 ?? 0);
  const x1 = Math.min(P.W - tw, region?.x1 ?? P.W - tw), y1 = Math.min(P.H - th, region?.y1 ?? P.H - th);
  const found: { score: number; x: number; y: number }[] = [];
  for (let y = y0; y <= y1; y += stride) {
    for (let x = x0; x <= x1; x += stride) {
      let total = 0, parts = 0;
      for (let k = 0; k < 2; k++) {
        const { I, S, SS } = P.maps[k];
        const { Z, norm } = T[k];
        if (norm < 1e-6) continue;
        const s = S[(y + th) * W1 + x + tw] - S[y * W1 + x + tw] - S[(y + th) * W1 + x] + S[y * W1 + x];
        const ss = SS[(y + th) * W1 + x + tw] - SS[y * W1 + x + tw] - SS[(y + th) * W1 + x] + SS[y * W1 + x];
        const v = ss - (s * s) / n;
        if (v < 1e-3) { parts++; continue; } // flat window: correlation 0
        let num = 0;
        for (let j = 0; j < th; j++) {
          const row = (y + j) * P.W + x, trow = j * tw;
          for (let i = 0; i < tw; i++) num += Z[trow + i] * I[row + i];
        }
        total += num / (norm * Math.sqrt(v));
        parts++;
      }
      const score = parts ? total / parts : -1;
      if (keep === 1) {
        if (!found.length || score > found[0].score) found[0] = { score, x, y };
      } else {
        found.push({ score, x, y });
      }
    }
  }
  if (keep === 1) return found;
  found.sort((a, b) => b.score - a.score);
  const picked: typeof found = [];
  for (const f of found) {
    if (picked.length >= keep) break;
    if (picked.every((p) => Math.abs(p.x - f.x) > tw / 2 || Math.abs(p.y - f.y) > th / 2)) picked.push(f);
  }
  return picked;
}

const COARSE_WIDTH = 160;
const FINE_WIDTH = 320;
const WIDTH_FRACTIONS = [0.1, 0.13, 0.17, 0.22, 0.28, 0.36, 0.46];
const ASPECTS = [0.67, 0.82, 1, 1.22, 1.5];

function matchOne(coarse: Pyr, fine: Pyr, tpl: RGBAImage): Match {
  const tAspect = tpl.height / tpl.width;
  // 1) coarse: every scale/aspect at stride 2, keep the 4 best distinct candidates overall
  const cands: Match[] = [];
  for (const wf of WIDTH_FRACTIONS)
    for (const af of ASPECTS) {
      const tw = Math.round(coarse.W * wf), th = Math.round(tw * tAspect * af);
      if (tw < 10 || th < 6 || tw >= coarse.W || th >= coarse.H) continue;
      for (const m of nccSearch(coarse, tpl, tw, th, 2, undefined, 2)) cands.push({ ...m, tw, th, aspect: af, wf });
    }
  cands.sort((a, b) => b.score - a.score);
  const top: Match[] = [];
  for (const c of cands) {
    if (top.length >= 4) break;
    if (top.every((t) => Math.abs(t.x / t.wf - c.x / c.wf) > 6 || Math.abs(t.y - c.y) > 6 || Math.abs(t.wf - c.wf) > 0.05)) top.push(c);
  }
  // 2) fine: refine each candidate at double resolution, stride 1, nearby scales/aspects
  const k = fine.W / coarse.W;
  let best: Match = { score: -1, x: 0, y: 0, tw: 0, th: 0, aspect: 1, wf: 0 };
  for (const c of top) {
    for (const dw of [0.92, 1, 1.08])
      for (const da of [0.9, 1, 1.1]) {
        const wf = c.wf * dw, af = c.aspect * da;
        const tw = Math.round(fine.W * wf), th = Math.round(tw * tAspect * af);
        if (tw < 12 || th < 8 || tw >= fine.W || th >= fine.H) continue;
        const cx = Math.round(c.x * k), cy = Math.round(c.y * k);
        const [m] = nccSearch(fine, tpl, tw, th, 1, { x0: cx - 8, y0: cy - 8, x1: cx + 8, y1: cy + 8 });
        if (m && m.score > best.score) best = { ...m, tw, th, aspect: af, wf };
      }
  }
  return best;
}

/** Mean Lab colour of the logo's "ink" pixels (pixels that differ from the template background). */
function inkLab(tpl: RGBAImage, creative: RGBAImage | null, map?: (u: number, v: number) => [number, number]) {
  const { width: w, height: h, data } = tpl;
  const corner = [data[0], data[1], data[2]];
  const cornerLab = rgbToLab(corner[0], corner[1], corner[2]);
  const transparentBg = data[3] < 128;
  let L = 0, A = 0, B = 0, n = 0;
  for (let v = 0; v < h; v += 2)
    for (let u = 0; u < w; u += 2) {
      const i = (v * w + u) * 4;
      const ink = transparentBg ? data[i + 3] > 200 : deltaE(rgbToLab(data[i], data[i + 1], data[i + 2]), cornerLab) > 20;
      if (!ink) continue;
      let r = data[i], g = data[i + 1], b = data[i + 2];
      if (creative && map) {
        const [x, y] = map(u, v);
        const j = (Math.min(creative.height - 1, Math.max(0, y)) * creative.width + Math.min(creative.width - 1, Math.max(0, x))) * 4;
        r = creative.data[j]; g = creative.data[j + 1]; b = creative.data[j + 2];
      }
      const lab = rgbToLab(r, g, b);
      L += lab[0]; A += lab[1]; B += lab[2]; n++;
    }
  return n ? ([L / n, A / n, B / n] as [number, number, number]) : null;
}

export const LOGO_THRESHOLD = 0.6;

export function findLogo(creative: RGBAImage, templates: LogoTemplate[]): LogoResult {
  const none: LogoResult = { found: false, score: 0, approvedScore: 0, outdatedScore: 0, aspect: 1 };
  if (!templates.length) return none;
  const coarse = pyramidLevel(creative, Math.min(COARSE_WIDTH, creative.width));
  const fine = pyramidLevel(creative, Math.min(FINE_WIDTH, creative.width));

  const results = templates.map((t) => ({ t, m: matchOne(coarse, fine, t.img) }));
  const bestOf = (k: "approved" | "outdated") => results.filter((r) => r.t.kind === k).sort((a, b) => b.m.score - a.m.score)[0];
  const ap = bestOf("approved");
  const od = bestOf("outdated");
  const approvedScore = ap?.m.score ?? 0;
  const outdatedScore = od?.m.score ?? 0;
  const top = [ap, od].filter(Boolean).sort((a, b) => b!.m.score - a!.m.score)[0]!;
  if (top.m.score < LOGO_THRESHOLD) return { ...none, approvedScore, outdatedScore, score: top.m.score };
  // prefer the approved logo unless the outdated one matches clearly better
  const winner = top.t.kind === "outdated" && ap && outdatedScore < approvedScore + 0.04 ? ap : top;
  const m = winner.m;
  const sx = creative.width / fine.W;
  const sy = creative.height / fine.H;
  const bx = m.x * sx, by = m.y * sy, bw = m.tw * sx, bh = m.th * sy;
  const box: Box = { x: bx / creative.width, y: by / creative.height, w: bw / creative.width, h: bh / creative.height };

  // colour check against the template's own ink colour
  const tpl = winner.t.img;
  const want = inkLab(tpl, null);
  const got = inkLab(tpl, creative, (u, v) => [Math.round(bx + (u / tpl.width) * bw), Math.round(by + (v / tpl.height) * bh)]);
  const colourDeltaE = want && got ? deltaE(want, got) : undefined;

  return {
    found: true,
    templateId: winner.t.id,
    templateName: winner.t.name,
    kind: winner.t.kind,
    score: m.score,
    approvedScore,
    outdatedScore,
    box,
    aspect: m.aspect,
    colourDeltaE,
  };
}

// ───────────────────────── text blocks (from OCR) ─────────────────────────
export const PHONE_WIDTH = 375;
export const MIN_RENDERED_PX = 10;

export function analyzeTextBlocks(img: RGBAImage, lines: OcrLine[], page?: number): TextBlock[] {
  const out: TextBlock[] = [];
  for (const ln of lines) {
    const text = ln.text.replace(/\s+/g, " ").trim();
    if (ln.confidence < 45 || text.replace(/[^A-Za-z0-9]/g, "").length < 2) continue;
    const x0 = Math.max(0, Math.floor(ln.bbox.x0)), y0 = Math.max(0, Math.floor(ln.bbox.y0));
    const x1 = Math.min(img.width, Math.ceil(ln.bbox.x1)), y1 = Math.min(img.height, Math.ceil(ln.bbox.y1));
    if (x1 - x0 < 4 || y1 - y0 < 4) continue;
    const px: number[][] = [];
    for (let y = y0; y < y1; y++)
      for (let x = x0; x < x1; x++) {
        const i = (y * img.width + x) * 4;
        px.push([img.data[i], img.data[i + 1], img.data[i + 2]]);
      }
    const L = px.map((p) => 0.299 * p[0] + 0.587 * p[1] + 0.114 * p[2]);
    // 2-means on luminance
    let c1 = Math.min(...L), c2 = Math.max(...L);
    let lab: number[] = [];
    for (let it = 0; it < 8; it++) {
      lab = L.map((l) => (Math.abs(l - c1) <= Math.abs(l - c2) ? 0 : 1));
      const m = [0, 1].map((k) => {
        const s = L.filter((_, i) => lab[i] === k);
        return s.length ? s.reduce((a, b) => a + b, 0) / s.length : k ? c2 : c1;
      });
      [c1, c2] = m;
    }
    const n0 = lab.filter((v) => v === 0).length;
    const fgK = n0 <= lab.length - n0 ? 0 : 1; // text = the smaller cluster
    const centre = [c1, c2];
    // trimmed means: ignore anti-aliased edge pixels between the two clusters
    const mean = (k: number) => {
      const d = Math.abs(c2 - c1);
      const sel = px.filter((_, i) => lab[i] === k && Math.abs(L[i] - centre[k]) <= d * 0.3);
      const use = sel.length ? sel : px.filter((_, i) => lab[i] === k);
      return [0, 1, 2].map((c) => use.reduce((a, p) => a + p[c], 0) / Math.max(1, use.length));
    };
    const fg = mean(fgK);
    const bg = mean(1 - fgK);
    const renderedPx = ((y1 - y0) * PHONE_WIDTH) / img.width;
    out.push({
      text,
      box: { x: x0 / img.width, y: y0 / img.height, w: (x1 - x0) / img.width, h: (y1 - y0) / img.height, page },
      fg: hex(fg),
      bg: hex(bg),
      contrast: wcagContrast(fg, bg),
      renderedPx,
      large: renderedPx >= 18,
    });
  }
  return out;
}

/** Union of two OCR passes; a line from the second pass is added only where the first found nothing. */
export function mergeOcrLines(a: OcrLine[], b: OcrLine[]): OcrLine[] {
  const area = (l: OcrLine) => Math.max(1, (l.bbox.x1 - l.bbox.x0) * (l.bbox.y1 - l.bbox.y0));
  const overlap = (p: OcrLine, q: OcrLine) => {
    const w = Math.min(p.bbox.x1, q.bbox.x1) - Math.max(p.bbox.x0, q.bbox.x0);
    const h = Math.min(p.bbox.y1, q.bbox.y1) - Math.max(p.bbox.y0, q.bbox.y0);
    return w > 0 && h > 0 ? (w * h) / Math.min(area(p), area(q)) : 0;
  };
  const good = (l: OcrLine) => l.confidence >= 45 && l.text.replace(/[^A-Za-z0-9]/g, "").length >= 2;
  const out = a.filter(good);
  for (const l of b.filter(good)) if (!out.some((x) => overlap(x, l) > 0.3)) out.push(l);
  return out.sort((p, q) => p.bbox.y0 - q.bbox.y0 || p.bbox.x0 - q.bbox.x0);
}

/**
 * Splits a creative into horizontal bands with different background colours (e.g. a yellow top
 * and a pink footer). OCR engines often skip text on a secondary background, so each band is
 * read separately. Returns [] when the whole image has one background.
 */
export function colourBands(img: RGBAImage, minFrac = 0.08): { y0: number; y1: number }[] {
  const { width: W, height: H, data } = img;
  const rowBg: [number, number, number][] = [];
  for (let y = 0; y < H; y++) {
    const counts = new Map<number, { n: number; r: number; g: number; b: number }>();
    for (let x = 0; x < W; x += 3) {
      const i = (y * W + x) * 4;
      const k = ((data[i] >> 4) << 8) | ((data[i + 1] >> 4) << 4) | (data[i + 2] >> 4);
      const c = counts.get(k) ?? { n: 0, r: 0, g: 0, b: 0 };
      c.n++; c.r += data[i]; c.g += data[i + 1]; c.b += data[i + 2];
      counts.set(k, c);
    }
    let best = { n: 0, r: 0, g: 0, b: 0 };
    counts.forEach((c) => { if (c.n > best.n) best = c; });
    rowBg.push(rgbToLab(best.r / best.n, best.g / best.n, best.b / best.n));
  }
  const cuts: number[] = [0];
  let ref = rowBg[0];
  for (let y = 1; y < H; y++) {
    if (deltaE(rowBg[y], ref) > 25) {
      // require the new background to persist for a few rows (ignore single text rows)
      const end = Math.min(H, y + 4);
      let stable = true;
      for (let k = y; k < end; k++) if (deltaE(rowBg[k], rowBg[y]) > 12) stable = false;
      if (stable) { cuts.push(y); ref = rowBg[y]; }
    }
  }
  cuts.push(H);
  const bands = [];
  for (let i = 0; i < cuts.length - 1; i++) if (cuts[i + 1] - cuts[i] >= H * minFrac) bands.push({ y0: cuts[i], y1: cuts[i + 1] });
  return bands.length > 1 ? bands : [];
}

export function cropRows(img: RGBAImage, y0: number, y1: number): RGBAImage {
  const W = img.width;
  return { data: img.data.slice(y0 * W * 4, y1 * W * 4), width: W, height: y1 - y0 };
}

/** Shifts OCR line boxes from a cropped band back to full-image coordinates. */
export const offsetLines = (lines: OcrLine[], dy: number): OcrLine[] =>
  lines.map((l) => ({ ...l, bbox: { x0: l.bbox.x0, x1: l.bbox.x1, y0: l.bbox.y0 + dy, y1: l.bbox.y1 + dy } }));

/** Drops OCR lines whose centre lies inside the detected logo (wordmark text is part of the logo). */
export function excludeLogoLines(lines: OcrLine[], logo: LogoResult | undefined, width: number, height: number): OcrLine[] {
  const lb = logo?.found ? logo.box : undefined;
  if (!lb) return lines;
  return lines.filter((l) => {
    const cx = (l.bbox.x0 + l.bbox.x1) / 2 / width, cy = (l.bbox.y0 + l.bbox.y1) / 2 / height;
    return !(cx >= lb.x && cx <= lb.x + lb.w && cy >= lb.y && cy <= lb.y + lb.h);
  });
}

export const needsContrast = (b: TextBlock) => (b.large ? 3 : 4.5);
