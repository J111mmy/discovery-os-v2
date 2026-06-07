"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export type FrameDraft = {
  problem: string;
  hypothesis: string;
  buyers: string;
  research_areas: string[];
};

function buildFrameText(draft: FrameDraft) {
  const areas = draft.research_areas.map((area) => `- ${area}`).join("\n");

  return [
    `Problem: ${draft.problem}`,
    `Hypothesis: ${draft.hypothesis}`,
    `Buyers: ${draft.buyers}`,
    `Research areas:\n${areas}`,
  ].join("\n\n");
}

export function FrameDraftBanner({
  projectId,
  draft,
  generatedAt,
  onAccepted,
  onDiscarded,
}: {
  projectId: string;
  draft: FrameDraft;
  generatedAt: string | null;
  onAccepted: (frameText: string) => void;
  onDiscarded: () => void;
}) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "accepting" | "discarding" | "error">("idle");

  async function accept() {
    const frameText = buildFrameText(draft);
    setState("accepting");

    const response = await fetch(`/api/projects/${projectId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ frame: frameText, frame_draft: null }),
    });

    if (!response.ok) {
      setState("error");
      return;
    }

    onAccepted(frameText);
    router.refresh();
  }

  async function discard() {
    setState("discarding");

    const response = await fetch(`/api/projects/${projectId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ frame_draft: null }),
    });

    if (!response.ok) {
      setState("error");
      return;
    }

    onDiscarded();
    router.refresh();
  }

  const formattedDate = generatedAt
    ? new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(new Date(generatedAt))
    : null;

  return (
    <div className="rounded-xl border border-[var(--accent)] bg-[var(--surface)] p-5">
      <div className="mb-4 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-sm font-semibold text-[var(--accent)]">AI-proposed frame</h2>
          {formattedDate && (
            <p className="mt-1 text-xs text-[var(--ink-faint)]">
              Generated {formattedDate} from your first research session
            </p>
          )}
        </div>
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            onClick={discard}
            disabled={state !== "idle"}
            className="rounded-lg border border-[var(--line)] px-3 py-1.5 text-xs font-medium text-[var(--ink-2)] transition-colors hover:border-[var(--ink-2)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {state === "discarding" ? "Discarding..." : "Discard"}
          </button>
          <button
            type="button"
            onClick={accept}
            disabled={state !== "idle"}
            className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {state === "accepting" ? "Applying..." : "Accept draft"}
          </button>
        </div>
      </div>

      <dl className="space-y-3 text-sm">
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-[var(--ink-faint)]">
            Problem
          </dt>
          <dd className="mt-1 leading-6 text-[var(--ink)]">{draft.problem}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-[var(--ink-faint)]">
            Hypothesis
          </dt>
          <dd className="mt-1 leading-6 text-[var(--ink)]">{draft.hypothesis}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-[var(--ink-faint)]">
            Buyers
          </dt>
          <dd className="mt-1 leading-6 text-[var(--ink)]">{draft.buyers}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-[var(--ink-faint)]">
            Research areas
          </dt>
          <dd className="mt-2 flex flex-wrap gap-2">
            {draft.research_areas.map((area) => (
              <span
                key={area}
                className="rounded-full border border-[var(--line)] px-2.5 py-0.5 text-xs text-[var(--ink-2)]"
              >
                {area}
              </span>
            ))}
          </dd>
        </div>
      </dl>

      {state === "error" && (
        <p className="mt-3 text-xs text-neg">Something went wrong. Please try again.</p>
      )}

      <p className="mt-4 text-xs text-[var(--ink-faint)]">
        Accepting saves this into the project frame field below. You can edit it any time.
      </p>
    </div>
  );
}
