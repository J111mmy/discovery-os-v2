"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import type { EvidenceRecord } from "@/types/database";
import { updateEvidenceTrustAction } from "./actions";

interface EvidenceBrowserProps {
  projectId: string;
  initialRecords: EvidenceRecord[];
  pendingCount: number;
  trustedCount: number;
}

function TrustBadge({ trustScope }: { trustScope: string }) {
  const classes =
    trustScope === "trusted"
      ? "border-green-500/20 bg-green-500/10 text-green-300"
      : trustScope === "pending"
      ? "border-yellow-500/20 bg-yellow-500/10 text-yellow-300"
      : "border-red-500/20 bg-red-500/10 text-red-300";

  return (
    <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${classes}`}>
      {trustScope}
    </span>
  );
}

function EvidenceCard({ projectId, record }: { projectId: string; record: EvidenceRecord }) {
  return (
    <article className="rounded-xl border border-[var(--border)] bg-[var(--surface-1)] p-5 transition-colors hover:border-white/15">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          {record.source_title && (
            <div className="truncate text-xs font-medium uppercase tracking-wide text-[var(--ink-faint)]">
              {record.source_title}
            </div>
          )}
          {record.segment_speaker && (
            <div className="mt-1 text-xs font-medium text-[var(--brand)]">
              {record.segment_speaker}
            </div>
          )}
          {record.summary && (
            <div className="mt-1 text-sm font-medium text-[var(--ink)]">{record.summary}</div>
          )}
        </div>
        <TrustBadge trustScope={record.trust_scope} />
      </div>

      <p className="whitespace-pre-wrap text-sm leading-6 text-[var(--ink)]">
        {record.content}
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        <form action={updateEvidenceTrustAction}>
          <input type="hidden" name="project_id" value={projectId} />
          <input type="hidden" name="evidence_id" value={record.id} />
          <input type="hidden" name="trust_scope" value="trusted" />
          <button
            type="submit"
            disabled={record.trust_scope === "trusted"}
            className="rounded-lg border border-green-500/20 px-3 py-1.5 text-xs font-medium text-green-300 transition-colors hover:border-green-400 disabled:cursor-not-allowed disabled:opacity-45"
          >
            Trust
          </button>
        </form>
        <form action={updateEvidenceTrustAction}>
          <input type="hidden" name="project_id" value={projectId} />
          <input type="hidden" name="evidence_id" value={record.id} />
          <input type="hidden" name="trust_scope" value="excluded" />
          <button
            type="submit"
            disabled={record.trust_scope === "excluded"}
            className="rounded-lg border border-red-500/20 px-3 py-1.5 text-xs font-medium text-red-300 transition-colors hover:border-red-400 disabled:cursor-not-allowed disabled:opacity-45"
          >
            Exclude
          </button>
        </form>
      </div>
    </article>
  );
}

export function EvidenceBrowser({
  projectId,
  initialRecords,
  pendingCount,
  trustedCount,
}: EvidenceBrowserProps) {
  const [query, setQuery] = useState("");
  const [records, setRecords] = useState(initialRecords);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const trimmedQuery = useMemo(() => query.trim(), [query]);

  useEffect(() => {
    if (!trimmedQuery) {
      setRecords(initialRecords);
      setError(null);
      return;
    }

    const timeout = window.setTimeout(() => {
      startTransition(async () => {
        const response = await fetch("/api/query", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            project_id: projectId,
            q: trimmedQuery,
            limit: 20,
            trust_scope: "all",
          }),
        });

        const payload = await response.json();
        if (!response.ok) {
          setError(payload.error ?? "Search failed.");
          return;
        }

        setError(null);
        setRecords(payload.records ?? []);
      });
    }, 400);

    return () => window.clearTimeout(timeout);
  }, [initialRecords, projectId, trimmedQuery]);

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-1)]">
      <div className="border-b border-[var(--border)] p-4 sm:p-5">
        <div className="mb-3 flex flex-col gap-3 xl:flex-row">
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-[var(--surface-0)] px-3 py-2 text-[var(--ink)] outline-none transition-colors placeholder:text-[var(--ink-faint)] focus:border-[var(--brand)]"
            placeholder="Search evidence"
          />
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-0)] px-3 py-2 text-xs font-medium text-[var(--ink-muted)]">
              <span className="text-yellow-300">{pendingCount}</span> pending review
              <span className="px-2 text-[var(--ink-faint)]">/</span>
              <span className="text-green-300">{trustedCount}</span> trusted
            </div>
          <form action={updateEvidenceTrustAction}>
            <input type="hidden" name="project_id" value={projectId} />
            <input type="hidden" name="trust_scope" value="trusted" />
            <button
              type="submit"
              className="w-full rounded-lg border border-[var(--border)] px-3 py-2 text-sm font-medium text-[var(--ink)] transition-colors hover:border-[var(--brand)] hover:text-[var(--brand)] sm:w-auto"
            >
              Trust all
            </button>
          </form>
          </div>
        </div>
        <div className="text-xs text-[var(--ink-muted)]">
          {isPending ? "Searching..." : trimmedQuery ? `${records.length} matches` : "20 most recent records"}
        </div>
      </div>

      {error && (
        <div className="m-5 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {error}
        </div>
      )}

      {records.length === 0 ? (
        <div className="p-12 text-center text-sm text-[var(--ink-muted)]">
          No evidence found.
        </div>
      ) : (
        <div className="grid gap-3 p-4 sm:p-5">
          {records.map((record) => (
            <EvidenceCard key={record.id} projectId={projectId} record={record} />
          ))}
        </div>
      )}
    </div>
  );
}
