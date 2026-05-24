"use client";

import { useEffect, useMemo, useState } from "react";

type AgentRunSummary = {
  id: string;
  agent_type: string;
  status: "running" | "completed" | "failed";
  project_id: string | null;
  source_id: string | null;
  started_at: string;
  completed_at: string | null;
  duration_ms: number | null;
  model_used: string | null;
  output_summary: string | null;
  error: string | null;
};

type Props = {
  projectId: string;
  sourceId: string;
  projectName: string;
};

const STEP_LABELS: Record<string, string> = {
  "entity-extraction": "Finding who's in the room",
  "session-review": "Writing up the session",
  "action-extraction": "Spotting commitments & requests",
  "project-synthesis": "Updating the project picture",
  "problem-discovery": "Looking for patterns across sessions",
  "gap-detection": "Checking what still needs answering",
  "frame-draft": "Drafting a research frame",
  "person-digest": "Building a contact profile",
  "company-digest": "Building a company profile",
  "competitor-digest": "Building a competitor profile",
  "claim-verification": "Checking the evidence",
  compose: "Drafting your document",
};

const GENERIC_FLAVOUR = [
  "Reading through the session...",
  "Identifying key voices...",
  "Picking out what matters...",
  "Connecting the useful signals...",
];

const PROCUREMENT_FLAVOUR = [
  "Reviewing the tender notes...",
  "Mapping the stakeholders...",
  "Flagging the procurement signals...",
  "Tracing the buying context...",
];

function isProcurementProject(projectName: string) {
  return /proc|tender|supplier|vendor|buy|buyer|purchase/i.test(projectName);
}

export function InsightProgress({ projectId, sourceId, projectName }: Props) {
  const [runs, setRuns] = useState<AgentRunSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  const [flavourIndex, setFlavourIndex] = useState(0);

  const visibleRuns = runs.filter((run) => run.status === "running" || run.status === "failed");
  const hasRunning = visibleRuns.some((run) => run.status === "running");
  const flavourLines = useMemo(
    () => (isProcurementProject(projectName) ? PROCUREMENT_FLAVOUR : GENERIC_FLAVOUR),
    [projectName]
  );

  useEffect(() => {
    let cancelled = false;

    async function loadRuns() {
      try {
        const response = await fetch(`/api/agent-runs?source_id=${sourceId}`, {
          cache: "no-store",
        });
        if (!response.ok) return;

        const data = (await response.json()) as { runs?: AgentRunSummary[] };
        if (!cancelled) {
          setRuns(data.runs ?? []);
          setLoading(false);
        }
      } catch {
        if (!cancelled) setLoading(false);
      }
    }

    void loadRuns();
    const interval = window.setInterval(() => {
      if (hasRunning || loading) void loadRuns();
    }, 5_000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [hasRunning, loading, sourceId]);

  useEffect(() => {
    if (!hasRunning) return;

    const interval = window.setInterval(() => {
      setFlavourIndex((current) => (current + 1) % flavourLines.length);
    }, 3_500);

    return () => window.clearInterval(interval);
  }, [flavourLines.length, hasRunning]);

  async function retrySource() {
    setRetrying(true);
    setRetryError(null);

    try {
      const response = await fetch("/api/ingest/retry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project_id: projectId, source_id: sourceId }),
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error || "Try again from the source actions menu.");
      }

      const runsResponse = await fetch(`/api/agent-runs?source_id=${sourceId}`, {
        cache: "no-store",
      });
      const data = (await runsResponse.json()) as { runs?: AgentRunSummary[] };
      setRuns(data.runs ?? []);
    } catch (error) {
      setRetryError(error instanceof Error ? error.message : "Try again from the source actions menu.");
    } finally {
      setRetrying(false);
    }
  }

  if (loading || visibleRuns.length === 0) return null;

  return (
    <section className="mb-6 rounded-xl border border-[var(--border)] bg-[var(--surface-1)] p-5">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <div className="text-xs font-medium uppercase tracking-wide text-[var(--ink-faint)]">
            Insights being built
          </div>
          {hasRunning && (
            <p className="mt-1 text-sm text-[var(--ink-muted)]">{flavourLines[flavourIndex]}</p>
          )}
        </div>
        {hasRunning && (
          <span className="mt-1 h-2.5 w-2.5 rounded-full bg-[var(--brand)] shadow-[0_0_18px_rgba(124,109,250,0.75)]" />
        )}
      </div>

      <div className="space-y-2">
        {visibleRuns.map((run) => {
          const failed = run.status === "failed";

          return (
            <div
              key={run.id}
              className={`flex items-center justify-between gap-4 rounded-lg border px-3 py-2 ${
                failed
                  ? "border-red-500/20 bg-red-500/10"
                  : "border-[var(--border)] bg-[var(--surface-0)]"
              }`}
            >
              <div className="flex min-w-0 items-center gap-3">
                {failed ? (
                  <span className="h-2 w-2 shrink-0 rounded-full bg-red-300" />
                ) : (
                  <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-[var(--brand)]" />
                )}
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-[var(--ink)]">
                    {STEP_LABELS[run.agent_type] ?? "Working through the source"}
                  </div>
                  {failed && (
                    <div className="mt-0.5 text-xs text-red-200">
                      Something did not go as planned here.
                    </div>
                  )}
                </div>
              </div>

              {failed && (
                <button
                  type="button"
                  onClick={retrySource}
                  disabled={retrying}
                  className="shrink-0 text-xs font-medium text-red-200 transition-colors hover:text-red-100 disabled:cursor-wait disabled:opacity-60"
                >
                  {retrying ? "Trying..." : "Try again"}
                </button>
              )}
            </div>
          );
        })}
      </div>

      {retryError && <p className="mt-3 text-xs text-red-300">{retryError}</p>}
    </section>
  );
}
