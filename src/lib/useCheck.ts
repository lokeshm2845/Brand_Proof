"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { newItem, reviewItem, useStore } from "./store";
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

/** Creates a content item, runs the brand check, and opens the review screen as soon as results exist. */
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
      const { kit, role, addItem } = useStore.getState();
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
      let opened = false;
      const open = () => {
        if (!opened) {
          opened = true;
          router.push(`/content/${item.id}`);
        }
      };
      // The AI layer keeps running after the page opens and merges its findings in.
      reviewItem(item.id, input.text, "First brand check", personFor(role).name, open)
        .then(open)
        .catch((e) => {
          setError(String(e?.message ?? e));
          setBusy(false);
        });
    } catch (e: any) {
      setError(String(e?.message ?? e));
      setBusy(false);
    }
  }
  return { run, busy, error };
}
