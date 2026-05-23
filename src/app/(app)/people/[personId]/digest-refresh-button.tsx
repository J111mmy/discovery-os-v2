"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function DigestRefreshButton({ personId }: { personId: string }) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "queued" | "error">("idle");

  async function refresh() {
    setState("queued");

    const response = await fetch(`/api/people/${personId}/synthesise`, {
      method: "POST",
    });

    if (!response.ok) {
      setState("error");
      return;
    }

    window.setTimeout(() => {
      router.refresh();
      setState("idle");
    }, 8000);
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={refresh}
        disabled={state === "queued"}
        className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-medium text-[var(--ink)] transition-colors hover:border-[var(--brand)] hover:text-[var(--brand)] disabled:cursor-not-allowed disabled:opacity-50"
      >
        {state === "queued" ? "Generating..." : "Refresh digest"}
      </button>
      {state === "error" && (
        <span className="text-xs text-red-300">Could not start. Try again.</span>
      )}
      {state === "queued" && (
        <span className="text-xs text-[var(--ink-faint)]">This takes about 30 seconds</span>
      )}
    </div>
  );
}
