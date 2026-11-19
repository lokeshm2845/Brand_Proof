"use client";
import type { Finding, ImageAnalysis } from "@/lib/types";

const COLOR: Record<string, string> = { high: "#E11D48", medium: "#D97706", low: "#0284C7" };

/**
 * Shows a creative with the Visual Compliance Engine's findings drawn as boxes.
 * Clicking a box selects its finding card; the selected finding's box is emphasised.
 */
export default function CreativeViewer({
  src, alt, findings, analysis, page, active, onPick,
}: {
  src: string;
  alt: string;
  findings: Finding[];
  analysis?: ImageAnalysis;
  page?: number;
  active?: string;
  onPick: (id: string) => void;
}) {
  const boxed = findings.filter((f) => f.box && f.status === "open" && (f.box.page ?? undefined) === page && !(f.box.w >= 0.99 && f.box.h >= 0.99));
  const logo = analysis?.logo;
  const logoOk = logo?.found && logo.box && !boxed.some((f) => f.ruleId === "V-04" || f.ruleId === "V-05" || f.ruleId === "V-06");
  return (
    <div className="relative w-full overflow-hidden rounded-lg border bg-slate-50">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={alt} className="block w-full" />
      {logoOk && logo?.box && (
        <div
          className="pointer-events-none absolute rounded-sm border-2 border-dashed border-emerald-500"
          style={{ left: `${logo.box.x * 100}%`, top: `${logo.box.y * 100}%`, width: `${logo.box.w * 100}%`, height: `${logo.box.h * 100}%` }}
          title="Current logo — OK"
        >
          <span className="absolute -top-4 left-0 whitespace-nowrap rounded bg-emerald-600 px-1 text-[9px] font-bold text-white">logo ✓</span>
        </div>
      )}
      {boxed.map((f) => {
        const b = f.box!;
        const on = active === f.id;
        return (
          <button
            key={f.id}
            type="button"
            onClick={() => onPick(f.id)}
            aria-label={`${f.ruleId}: ${f.message}`}
            title={f.message}
            className="absolute rounded-sm transition"
            style={{
              left: `${b.x * 100}%`,
              top: `${b.y * 100}%`,
              width: `${b.w * 100}%`,
              height: `${b.h * 100}%`,
              border: `${on ? 3 : 2}px solid ${COLOR[f.severity]}`,
              background: on ? `${COLOR[f.severity]}22` : "transparent",
              boxShadow: on ? `0 0 0 3px ${COLOR[f.severity]}55` : undefined,
            }}
          >
            <span className="absolute -top-4 left-0 whitespace-nowrap rounded px-1 text-[9px] font-bold text-white" style={{ background: COLOR[f.severity] }}>
              {f.ruleId}
            </span>
          </button>
        );
      })}
    </div>
  );
}
