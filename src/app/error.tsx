"use client";
import { useEffect } from "react";

/** Last-resort error screen: never leave a judge on a blank page. */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div className="mx-auto max-w-lg space-y-3 py-16 text-center">
      <h1 className="text-xl font-bold">Something went wrong on this page</h1>
      <p className="text-sm text-slate-600">Your data is safe. Try again — if it keeps happening, the saved demo data in this browser may be damaged and can be reset.</p>
      <div className="flex justify-center gap-2">
        <button className="btn-primary" onClick={() => reset()}>Try again</button>
        <button
          className="btn-ghost"
          onClick={() => {
            try {
              localStorage.removeItem("brandproof-workspace-v1");
            } catch {}
            window.location.href = "/";
          }}
        >
          Reset demo data
        </button>
      </div>
    </div>
  );
}
