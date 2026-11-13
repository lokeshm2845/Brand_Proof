"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { newItem, requestReview, useStore, withVersion } from "./store";
import { personFor } from "./seed";
import type { ContentItem } from "./types";

export interface CheckInput {
  title: string;
  channel: string;
  audience: string;
  goal: string;
  text: string;
  format: ContentItem["format"];
  fileName?: string;
  imageDataUrl?: string;
  imageAnalysis?: ContentItem["imageAnalysis"];
  altText?: string;
}

/** Creates a content item, runs the brand check, and opens the review screen. */
export function useCreateCheck() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(input: CheckInput) {
    setBusy(true);
    setError(null);
    try {
      // Content is always created by a creator; reviewers acting here are switched to Aisha.
      if (useStore.getState().role === "brand" || useStore.getState().role === "legal") useStore.getState().setRole("creator");
      const { kit, role, addItem, mutate } = useStore.getState();
      const item = newItem(
        {
          title: input.title || "Untitled content",
          channel: input.channel,
          audience: input.audience,
          goal: input.goal,
          draftText: input.text,
          format: input.format,
          fileName: input.fileName,
          imageDataUrl: input.imageDataUrl,
          imageAnalysis: input.imageAnalysis,
          altText: input.altText,
        },
        role,
        kit.version,
      );
      addItem(item);
      const r = await requestReview({
        text: input.text,
        kit,
        intent: { channel: input.channel, audience: input.audience, goal: input.goal },
        isImage: input.format === "image",
        imageDataUrl: input.imageDataUrl,
        altText: input.altText,
        imageAnalysis: input.imageAnalysis,
      });
      mutate(item.id, (it) => withVersion(it, r.text ?? input.text, r.findings, r.meta, personFor(role).name, "First brand check", kit.version));
      router.push(`/content/${item.id}`);
    } catch (e: any) {
      setError(String(e?.message ?? e));
      setBusy(false);
    }
  }
  return { run, busy, error };
}
