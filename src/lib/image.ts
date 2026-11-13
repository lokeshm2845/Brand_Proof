"use client";
import type { ImageAnalysis, PaletteColor } from "./types";

const hexToRgb = (hex: string): [number, number, number] => {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const toHex = (r: number, g: number, b: number) =>
  "#" + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("").toUpperCase();

function rgbToLab([r, g, b]: [number, number, number]) {
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
export const deltaE = (a: [number, number, number], b: [number, number, number]) => {
  const A = rgbToLab(a), B = rgbToLab(b);
  return Math.hypot(A[0] - B[0], A[1] - B[1], A[2] - B[2]);
};
const lum = ([r, g, b]: [number, number, number]) => {
  const f = (c: number) => {
    c /= 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
export const contrast = (a: [number, number, number], b: [number, number, number]) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

/** Dominant-colour analysis done fully in the browser — the image never leaves the device for this step. */
export function analyzeImage(dataUrl: string, palette: PaletteColor[]): Promise<ImageAnalysis> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const max = 120;
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      const ctx = c.getContext("2d");
      if (!ctx) return reject(new Error("no canvas"));
      ctx.drawImage(img, 0, 0, w, h);
      const { data } = ctx.getImageData(0, 0, w, h);
      const buckets = new Map<number, { r: number; g: number; b: number; n: number }>();
      let total = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] < 128) continue;
        const key = ((data[i] >> 4) << 8) | ((data[i + 1] >> 4) << 4) | (data[i + 2] >> 4);
        const bk = buckets.get(key) ?? { r: 0, g: 0, b: 0, n: 0 };
        bk.r += data[i]; bk.g += data[i + 1]; bk.b += data[i + 2]; bk.n++;
        buckets.set(key, bk);
        total++;
      }
      // merge visually similar buckets
      const cols = [...buckets.values()]
        .map((b) => ({ rgb: [b.r / b.n, b.g / b.n, b.b / b.n] as [number, number, number], n: b.n }))
        .sort((a, b) => b.n - a.n);
      const merged: { rgb: [number, number, number]; n: number }[] = [];
      for (const col of cols) {
        const m = merged.find((x) => deltaE(x.rgb, col.rgb) < 12);
        if (m) m.n += col.n;
        else merged.push({ ...col });
      }
      merged.sort((a, b) => b.n - a.n);
      const pal = palette.map((p) => ({ name: p.name, rgb: hexToRgb(p.hex) }));
      const dominant = merged.filter((m) => m.n / Math.max(1, total) >= 0.03).slice(0, 6).map((m) => {
        let best = { name: "—", d: 999 };
        for (const p of pal) {
          const d = deltaE(m.rgb, p.rgb);
          if (d < best.d) best = { name: p.name, d };
        }
        return { hex: toHex(...m.rgb), share: m.n / Math.max(1, total), nearest: best.name, deltaE: best.d };
      });
      const top = merged.slice(0, 2);
      const contrastEstimate = top.length > 1 ? contrast(top[0].rgb, top[1].rgb) : 21;
      resolve({ dominant, contrastEstimate, width: img.width, height: img.height });
    };
    img.onerror = () => reject(new Error("Could not load image"));
    img.src = dataUrl;
  });
}

/** Downscale large uploads so they fit comfortably in browser storage and API limits. */
export function shrinkImage(file: File, maxSide = 1200): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const s = Math.min(1, maxSide / Math.max(img.width, img.height));
        const c = document.createElement("canvas");
        c.width = Math.round(img.width * s);
        c.height = Math.round(img.height * s);
        c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
        resolve(c.toDataURL("image/jpeg", 0.85));
      };
      img.onerror = () => reject(new Error("Unsupported image"));
      img.src = String(reader.result);
    };
    reader.onerror = () => reject(new Error("Could not read file"));
    reader.readAsDataURL(file);
  });
}
