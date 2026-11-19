/** Turns raw vision measurements into explainable visual issues (shared by the app and the evaluation). */
import { MIN_RENDERED_PX, needsContrast, type Box, type LogoResult, type TextBlock } from "./vision";

export type VisualIssueCode =
  | "LOGO_OUTDATED"
  | "LOGO_STRETCHED"
  | "LOGO_RECOLOURED"
  | "LOGO_MISSING"
  | "TEXT_CONTRAST"
  | "TEXT_SMALL";

export const RULE_FOR: Record<VisualIssueCode, string> = {
  LOGO_OUTDATED: "V-04",
  LOGO_STRETCHED: "V-05",
  LOGO_RECOLOURED: "V-06",
  LOGO_MISSING: "V-07",
  TEXT_CONTRAST: "V-03",
  TEXT_SMALL: "V-08",
};

export interface VisualIssue {
  code: VisualIssueCode;
  message: string;
  detail: string;
  box?: Box;
  swatches?: string[];
  quote?: string;
}

export const STRETCH_TOLERANCE = 0.15;
export const MIN_RENDERED_PX_PRINT = 6;
export const RECOLOUR_DELTA_E = 25;

export function visualIssues({ logo, blocks, hasLogos, page }: { logo?: LogoResult; blocks: TextBlock[]; hasLogos: boolean; page?: number }): VisualIssue[] {
  const out: VisualIssue[] = [];
  const where = page ? ` (page ${page})` : "";
  if (logo && hasLogos) {
    const box = logo.box ? { ...logo.box, page } : undefined;
    if (!logo.found) {
      out.push({
        code: "LOGO_MISSING",
        message: `No brand logo found${where}`,
        detail: `None of the logos in the Brand Kit was detected (best match score ${logo.score.toFixed(2)}, needs 0.60). Public creatives should carry the current logo.`,
      });
    } else if (logo.kind === "outdated") {
      out.push({
        code: "LOGO_OUTDATED",
        message: `Retired logo used: ${logo.templateName}${where}`,
        detail: `The logo in the box matches "${logo.templateName}" (match ${logo.outdatedScore.toFixed(2)}) better than the current logo (${logo.approvedScore.toFixed(2)}). Replace it with the current logo from the Brand Kit.`,
        box,
      });
    } else {
      const stretch = Math.abs(logo.aspect - 1);
      if (stretch >= STRETCH_TOLERANCE) {
        out.push({
          code: "LOGO_STRETCHED",
          message: `Logo is ${logo.aspect > 1 ? "stretched vertically" : "stretched horizontally"}${where}`,
          detail: `The logo's height-to-width ratio is ${Math.round(logo.aspect * 100)}% of the original (allowed: 85–115%). Resize it proportionally — never stretch or squash it.`,
          box,
        });
      }
      if (logo.colourDeltaE !== undefined && logo.colourDeltaE > RECOLOUR_DELTA_E) {
        out.push({
          code: "LOGO_RECOLOURED",
          message: `Logo colours changed${where}`,
          detail: `The logo's colours differ from the approved artwork by ΔE ${logo.colourDeltaE.toFixed(0)} (allowed up to ${RECOLOUR_DELTA_E}). Use the original colours from the Brand Kit.`,
          box,
        });
      }
    }
  }
  for (const b of blocks) {
    const need = needsContrast(b);
    if (b.contrast < need) {
      out.push({
        code: "TEXT_CONTRAST",
        message: `Low text contrast (${b.contrast.toFixed(1)}:1)${where}`,
        detail: `"${b.text.slice(0, 60)}" — text ${b.fg} on ${b.bg} has a contrast ratio of ${b.contrast.toFixed(1)}:1; WCAG AA needs ${need}:1 for ${b.large ? "large" : "normal"} text.`,
        box: b.box,
        swatches: [b.fg, b.bg],
        quote: b.text,
      });
    }
    // Printed pages (PDF) are read zoomed in, so they get a lower floor than social creatives.
    const minPx = page ? MIN_RENDERED_PX_PRINT : MIN_RENDERED_PX;
    if (b.renderedPx < minPx) {
      out.push({
        code: "TEXT_SMALL",
        message: `Text too small to read${page ? "" : " on a phone"}${where}`,
        detail: `"${b.text.slice(0, 60)}" renders about ${b.renderedPx.toFixed(0)} px tall when the ${page ? "page" : "creative"} is shown 375 px wide on a phone (minimum ${minPx} px${page ? " for documents" : " for feed creatives"}).`,
        box: b.box,
        quote: b.text,
      });
    }
  }
  // one contrast/size finding per kind is enough noise for the same creative region: merge duplicates
  const seen = new Set<string>();
  return out.filter((i) => {
    const k = `${i.code}|${i.box ? `${i.box.page ?? 0}:${i.box.x.toFixed(2)}:${i.box.y.toFixed(2)}` : ""}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
