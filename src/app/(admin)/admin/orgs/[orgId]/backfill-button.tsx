"use client";

import { useState } from "react";

type BackfillStatus = "idle" | "running" | "done" | "error";

type BackfillResponse = {
  queued?: number;
  sources_queued?: number;
  skipped?: number;
  error?: string;
};

export function BackfillButton({ orgId }: { orgId: string }) {
  const [status, setStatus] = useState<BackfillStatus>("idle");
  const [message, setMessage] = useState<string | null>(null);

  async function handleClick() {
    setStatus("running");
    setMessage(null);

    try {
      const response = await fetch("/api/admin/backfill-grades", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ org_id: orgId }),
      });
      const data = (await response.json()) as BackfillResponse;

      if (!response.ok) {
        throw new Error(data.error ?? "Could not queue evidence grading.");
      }

      const queued = data.queued ?? 0;
      const sourcesQueued = data.sources_queued ?? 0;
      const skipped = data.skipped ?? 0;

      if (queued === 0) {
        setMessage(
          skipped > 0
            ? `No source-backed evidence was queued. ${skipped} record${skipped === 1 ? "" : "s"} could not be mapped to a source.`
            : "All source-backed evidence is already graded."
        );
      } else {
        setMessage(
          `Queued ${queued} evidence record${queued === 1 ? "" : "s"} across ${sourcesQueued} source${sourcesQueued === 1 ? "" : "s"} for grading. Check Inngest for progress.`
        );
      }
      setStatus("done");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Something went wrong.");
      setStatus("error");
    }
  }

  return (
    <section>
      <h2 className="mb-3 text-sm font-semibold text-[var(--ink)]">Evidence grading</h2>
      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-1)] p-5">
        <p className="mb-4 text-sm leading-6 text-[var(--ink-muted)]">
          Grade all ungraded evidence for this organisation. Jobs run in the background, grouped by source, so the existing evidence grading pipeline handles the work.
        </p>
        <button
          type="button"
          onClick={handleClick}
          disabled={status === "running" || status === "done"}
          className="rounded-lg bg-[var(--brand)] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[var(--brand-dim)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {status === "running"
            ? "Queuing..."
            : status === "done"
              ? "Queued ✓"
              : "Re-grade all evidence"}
        </button>
        {message && (
          <p
            className={`mt-3 text-sm ${
              status === "error" ? "text-red-400" : "text-green-400"
            }`}
          >
            {message}
          </p>
        )}
      </div>
    </section>
  );
}
