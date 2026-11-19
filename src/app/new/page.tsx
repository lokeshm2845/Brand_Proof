"use client";
import { useEffect, useRef, useState } from "react";
import { FileText, Image as ImageIcon, Loader2, ShieldCheck, Type, Upload } from "lucide-react";
import { SAMPLES } from "@/lib/seed";
import { useCreateCheck } from "@/lib/useCheck";
import { shrinkImage } from "@/lib/image";
import { analyzeCreative, analyzePdfPages } from "@/lib/creative";
import { useStore } from "@/lib/store";
import type { ContentItem, CreativePage, ImageAnalysis } from "@/lib/types";

type Mode = "text" | "doc" | "image";

export default function NewCheck() {
  const kit = useStore((s) => s.kit);
  const { run, busy, error } = useCreateCheck();
  const [mode, setMode] = useState<Mode>("text");
  const [title, setTitle] = useState("");
  const [channel, setChannel] = useState("LinkedIn");
  const [audience, setAudience] = useState("");
  const [goal, setGoal] = useState("");
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState<string>();
  const [format, setFormat] = useState<ContentItem["format"]>("text");
  const [img, setImg] = useState<string>();
  const [analysis, setAnalysis] = useState<ImageAnalysis>();
  const [alt, setAlt] = useState("");
  const [fileBusy, setFileBusy] = useState(false);
  const [fileErr, setFileErr] = useState<string | null>(null);
  const [progress, setProgress] = useState<string>("");
  const [pages, setPages] = useState<CreativePage[]>();
  const [pageTotal, setPageTotal] = useState(0);
  const [ocrFilled, setOcrFilled] = useState(false);
  const docRef = useRef<HTMLInputElement>(null);
  const imgRef = useRef<HTMLInputElement>(null);

  const loadSample = (i: number) => {
    const s = SAMPLES[i];
    setMode("text");
    setFormat("text");
    setTitle(s.title);
    setChannel(s.channel);
    setAudience(s.audience);
    setGoal(s.goal);
    setText(s.text);
  };

  async function onDoc(file: File) {
    setFileErr(null);
    setFileBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await fetch("/api/extract", { method: "POST", body: fd });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "Could not read the file");
      if (!String(j.text ?? "").trim()) throw new Error("No text found in this file. If it is a scanned PDF, upload the pages as images instead.");
      setText(j.text);
      setFileName(file.name);
      setFormat(j.format === "pdf" ? "pdf" : j.format === "docx" ? "docx" : "text");
      if (!title) setTitle(file.name.replace(/\.[^.]+$/, ""));
      setPages(undefined);
      setPageTotal(0);
      if (j.format === "pdf") {
        // Visual check of each page: logo, colours, text contrast and size
        try {
          const r2 = await analyzePdfPages(file, kit, setProgress);
          setPages(r2.pages);
          setPageTotal(r2.total);
        } catch {
          setFileErr("The text was extracted, but the pages could not be rendered for the visual check.");
        }
      }
    } catch (e: any) {
      setFileErr(e.message);
    } finally {
      setFileBusy(false);
      setProgress("");
    }
  }

  async function onImage(file: File) {
    setFileErr(null);
    setFileBusy(true);
    try {
      if (file.size > 15 * 1024 * 1024) throw new Error("Image is larger than 15 MB.");
      const url = await shrinkImage(file);
      setImg(url);
      setAnalysis(undefined);
      setFileName(file.name);
      setFormat("image");
      if (!title) setTitle(file.name.replace(/\.[^.]+$/, ""));
      const a = await analyzeCreative(url, kit, setProgress);
      setAnalysis(a);
      // Fill the text box with what OCR read, unless the creator already typed something
      setText((t) => {
        if (t.trim() || !a.ocrText) return t;
        setOcrFilled(true);
        return a.ocrText;
      });
    } catch (e: any) {
      setFileErr(e.message);
    } finally {
      setFileBusy(false);
      setProgress("");
    }
  }

  async function loadSampleCreative() {
    setTitle("Festive Instagram ad creative");
    setChannel("Instagram");
    setGoal("Promote festive cashback");
    setAudience("Young adults");
    setText("");
    setOcrFilled(false);
    try {
      const res = await fetch("/samples/festive-ad-offbrand.png");
      const blob = await res.blob();
      await onImage(new File([blob], "festive-ad-offbrand.png", { type: "image/png" }));
    } catch {
      setFileErr("Could not load the sample image.");
    }
  }

  // Deep link from the home page: /new?sample=image opens the off-brand ad straight away
  const autoSample = useRef(false);
  useEffect(() => {
    if (autoSample.current) return;
    autoSample.current = true;
    if (new URLSearchParams(window.location.search).get("sample") === "image") {
      setMode("image");
      loadSampleCreative();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const canSubmit =
    !busy && !fileBusy && (mode === "image" ? Boolean(img) : text.trim().length > 0);

  const submit = () =>
    run({
      title,
      channel,
      audience,
      goal,
      text,
      format: mode === "image" ? "image" : format,
      fileName,
      imageDataUrl: mode === "image" ? img : undefined,
      imageAnalysis: mode === "image" ? analysis : undefined,
      altText: mode === "image" ? alt : undefined,
      pages: mode === "doc" && format === "pdf" ? pages : undefined,
    });

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div>
        <h1 className="text-2xl font-bold">New brand check</h1>
        <p className="text-sm text-slate-500">
          Tell us what the content is for, add it, and run the check. Your intent is used so suggested fixes keep your message.
        </p>
      </div>

      <div className="card p-5">
        <p className="label">Quick samples (PayNova demo brand)</p>
        <div className="flex flex-wrap gap-2">
          {SAMPLES.map((s, i) => (
            <button key={s.title} className="btn-ghost" onClick={() => loadSample(i)}>
              {s.title}
            </button>
          ))}
          <button
            className="btn-ghost"
            onClick={() => {
              setMode("image");
              loadSampleCreative();
            }}
          >
            Off-brand ad creative (image)
          </button>
          <a className="btn-ghost" href="/samples/paynova-newsletter.docx" download>
            Download sample .docx
          </a>
          <a className="btn-ghost" href="/samples/paynova-flyer.pdf" download>
            Download sample .pdf
          </a>
        </div>
      </div>

      <div className="card space-y-5 p-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="title">Title</label>
            <input id="title" className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Diwali cashback email" />
          </div>
          <div>
            <label className="label" htmlFor="channel">Channel</label>
            <select id="channel" className="input" value={channel} onChange={(e) => setChannel(e.target.value)}>
              {["LinkedIn", "Instagram", "X / Twitter", "Email", "Website", "Website banner", "Push notification", "App store", "Print / PDF", "Press release"].map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="aud">Audience</label>
            <input id="aud" className="input" value={audience} onChange={(e) => setAudience(e.target.value)} placeholder="e.g. College students" />
          </div>
          <div>
            <label className="label" htmlFor="goal">Goal (what must the fix keep?)</label>
            <input id="goal" className="input" value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="e.g. Drive sign-ups for the festive offer" />
          </div>
        </div>

        <div>
          <div className="mb-3 flex flex-wrap gap-1 rounded-lg border border-slate-200 p-1 text-sm">
            {([
              ["text", "Paste text", Type],
              ["doc", "Upload document (DOCX / PDF)", FileText],
              ["image", "Upload creative (image)", ImageIcon],
            ] as const).map(([k, l, Icon]) => (
              <button
                key={k}
                onClick={() => {
                  setMode(k);
                  setFormat(k === "image" ? "image" : "text");
                }}
                className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-2 ${mode === k ? "bg-nova-soft font-semibold text-nova" : "text-slate-600"}`}
              >
                <Icon size={15} /> {l}
              </button>
            ))}
          </div>

          {mode === "doc" && (
            <div className="mb-3 flex flex-wrap items-center gap-3 rounded-xl border border-dashed border-slate-300 p-4">
              <input ref={docRef} type="file" accept=".docx,.pdf,.txt" className="hidden" onChange={(e) => e.target.files?.[0] && onDoc(e.target.files[0])} />
              <button className="btn-ghost" onClick={() => docRef.current?.click()} disabled={fileBusy}>
                {fileBusy ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />} Choose .docx / .pdf
              </button>
              <span className="text-sm text-slate-500">{fileName ? `Loaded ${fileName} — text extracted below. You can edit it before checking.` : "Max 4 MB. Files are read in memory and not stored on our server. PDF pages also get a visual check."}</span>
              {pages && pages.length > 0 && (
                <div className="w-full">
                  <p className="label">Pages checked visually{pageTotal > pages.length ? ` (first ${pages.length} of ${pageTotal})` : ""}</p>
                  <div className="flex flex-wrap gap-2">
                    {pages.map((p) => (
                      <div key={p.page} className="w-24 text-center text-[10px] text-slate-500">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={p.dataUrl} alt={`Page ${p.page}`} className="mb-1 w-full rounded border" />
                        Page {p.page} · {p.analysis.logo?.found ? (p.analysis.logo.kind === "outdated" ? "old logo" : "logo ✓") : "no logo"} · {p.analysis.blocks?.length ?? 0} text blocks
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {mode === "image" && (
            <div className="mb-3 grid gap-4 rounded-xl border border-dashed border-slate-300 p-4 md:grid-cols-[220px_1fr]">
              <div>
                <input ref={imgRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => e.target.files?.[0] && onImage(e.target.files[0])} />
                {img ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={img} alt={alt || "Uploaded creative preview"} className="w-full rounded-lg border" />
                ) : (
                  <div className="flex aspect-square items-center justify-center rounded-lg bg-slate-50 text-xs text-slate-400">No image yet</div>
                )}
                <button className="btn-ghost mt-2 w-full" onClick={() => imgRef.current?.click()} disabled={fileBusy}>
                  {fileBusy ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />} Choose PNG / JPG
                </button>
              </div>
              <div className="space-y-3">
                {analysis && (
                  <div>
                    <p className="label">Colours found (analysed in your browser)</p>
                    <div className="flex flex-wrap gap-2">
                      {analysis.dominant.map((d) => (
                        <span key={d.hex} className="flex items-center gap-1.5 rounded-lg border px-2 py-1 text-xs">
                          <span className="h-4 w-4 rounded border" style={{ background: d.hex }} />
                          {d.hex} · {Math.round(d.share * 100)}%
                          <span className={d.deltaE > 25 ? "text-rose-600" : "text-emerald-600"}>{d.deltaE > 25 ? "off-palette" : `≈ ${d.nearest}`}</span>
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {analysis?.logo && (kit.logos?.length ?? 0) > 0 && (
                  <div className="text-xs">
                    <p className="label">Logo</p>
                    {analysis.logo.found ? (
                      <span className={analysis.logo.kind === "outdated" ? "text-rose-600" : "text-emerald-700"}>
                        {analysis.logo.kind === "outdated" ? "Retired logo detected" : "Current logo detected"} (match {Math.round(analysis.logo.score * 100)}%)
                        {analysis.logo.kind === "approved" && Math.abs(analysis.logo.aspect - 1) >= 0.15 && <b className="ml-1 text-rose-600">· looks stretched</b>}
                        {analysis.logo.kind === "approved" && (analysis.logo.colourDeltaE ?? 0) > 25 && <b className="ml-1 text-rose-600">· colours changed</b>}
                      </span>
                    ) : (
                      <span className="text-amber-700">No brand logo found</span>
                    )}
                  </div>
                )}
                {analysis?.blocks && (
                  <div className="text-xs">
                    <p className="label">Text blocks read by OCR</p>
                    {analysis.blocks.length === 0 ? (
                      <span className="text-slate-500">No readable text found.</span>
                    ) : (
                      <span className="text-slate-600">
                        {analysis.blocks.length} block{analysis.blocks.length > 1 ? "s" : ""} · lowest contrast {Math.min(...analysis.blocks.map((b) => b.contrast)).toFixed(1)}:1 · smallest text ≈{" "}
                        {Math.min(...analysis.blocks.map((b) => b.renderedPx)).toFixed(0)} px on a phone
                      </span>
                    )}
                  </div>
                )}
                <div>
                  <label className="label" htmlFor="alt">Alt text</label>
                  <input id="alt" className="input" value={alt} onChange={(e) => setAlt(e.target.value)} placeholder="Describe the creative for screen-reader users (leave empty to get an AI draft)" />
                </div>
                <p className="text-xs text-slate-500">
                  {ocrFilled
                    ? "The text below was read from the creative by OCR. Correct it if anything was misread."
                    : "The text on the creative is read automatically (OCR) after you choose an image. You can also type or correct it below."}
                </p>
              </div>
            </div>
          )}

          <label className="label" htmlFor="content">{mode === "image" ? "Text on the creative (optional)" : "Content"}</label>
          <textarea
            id="content"
            className="input min-h-[180px] font-[450] leading-relaxed"
            value={text}
            onChange={(e) => setText(e.target.value.slice(0, 20000))}
            maxLength={20000}
            placeholder={mode === "image" ? "e.g. MEGA DIWALI SALE — 100% guaranteed cashback!" : "Paste your post, email or ad copy here…"}
          />
          <p className="mt-1 text-right text-xs text-slate-400">{text.split(/\s+/).filter(Boolean).length} words{text.length >= 20000 ? " · limit of 20,000 characters reached" : ""}</p>
        </div>

        {progress && (
          <p className="flex items-center gap-2 rounded-lg bg-nova-soft p-3 text-sm text-nova" role="status">
            <Loader2 size={14} className="animate-spin" /> {progress}
          </p>
        )}
        {(error || fileErr) && <p className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700" role="alert">{error || fileErr}</p>}

        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-slate-500">Checked against Brand Kit v{kit.version}. Personal data and confidential terms are masked before any AI call.</p>
          <button className="btn-primary px-5 py-2.5" onClick={submit} disabled={!canSubmit}>
            {busy ? <Loader2 size={16} className="animate-spin" /> : <ShieldCheck size={16} />}
            {busy ? "Checking…" : "Run brand check"}
          </button>
        </div>
      </div>
    </div>
  );
}
