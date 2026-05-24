"use client";

import { FormEvent, useState, useRef } from "react";
import type { EvidenceRecord } from "@/types/database";

type TrustScopeFilter = "include_pending" | "trusted";

interface AskInterfaceProps {
  projectId: string;
  projectName: string;
}

interface AskApiResponse {
  answer: string;
  sources: EvidenceRecord[];
  all_retrieved: EvidenceRecord[];
  record_count: number;
}

// ─── Citation rendering ───────────────────────────────────────────────────────

// Replace [N] markers in answer text with inline superscript chips.
// Returns an array of React-renderable segments.
function renderAnswerWithCitations(
  answer: string,
  onCitationClick: (n: number) => void
): React.ReactNode[] {
  const parts = answer.split(/(\[\d+\])/g);
  return parts.map((part, i) => {
    const match = part.match(/^\[(\d+)\]$/);
    if (match) {
      const n = parseInt(match[1], 10);
      return (
        <button
          key={i}
          onClick={() => onCitationClick(n)}
          className="mx-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded bg-[var(--brand)]/15 px-1 text-[10px] font-semibold text-[var(--brand)] transition-colors hover:bg-[var(--brand)]/30 align-super"
          title={`Jump to source ${n}`}
        >
          {n}
        </button>
      );
    }
    // Preserve paragraph breaks
    return <span key={i}>{part}</span>;
  });
}

// ─── Evidence card ────────────────────────────────────────────────────────────

function ClassificationBadge({
  classification,
}: {
  classification: EvidenceRecord["classification"];
}) {
  if (!classification) return null;
  const classes =
    classification === "insight"
      ? "border-[var(--brand)]/30 bg-[var(--brand)]/10 text-[var(--brand)]"
      : classification === "verbatim"
      ? "border-blue-500/25 bg-blue-500/10 text-blue-300"
      : classification === "data_point"
      ? "border-cyan-500/25 bg-cyan-500/10 text-cyan-300"
      : "border-amber-500/25 bg-amber-500/10 text-amber-300";

  return (
    <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${classes}`}>
      {classification.replace("_", " ")}
    </span>
  );
}

function SentimentDot({ sentiment }: { sentiment: EvidenceRecord["sentiment"] }) {
  if (!sentiment) return null;
  const color =
    sentiment === "positive"
      ? "bg-green-400"
      : sentiment === "negative"
      ? "bg-red-400"
      : sentiment === "mixed"
      ? "bg-yellow-400"
      : "bg-[var(--ink-faint)]";
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-[var(--ink-muted)]">
      <span className={`h-1.5 w-1.5 rounded-full ${color}`} />
      {sentiment}
    </span>
  );
}

function SourceCard({
  record,
  citationNumber,
  id,
}: {
  record: EvidenceRecord;
  citationNumber: number;
  id: string;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <article
      id={id}
      className="scroll-mt-4 rounded-xl border border-[var(--border)] bg-[var(--surface-1)]"
    >
      {/* Header — always visible */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-start gap-3 p-4 text-left"
      >
        <span className="mt-0.5 flex h-5 min-w-5 items-center justify-center rounded bg-[var(--brand)]/15 text-[10px] font-bold text-[var(--brand)] shrink-0">
          {citationNumber}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-[var(--ink)]">
            {record.source_title ?? "Source"}
          </p>
          {record.segment_speaker && (
            <p className="mt-0.5 text-xs text-[var(--ink-muted)]">
              {record.segment_speaker}
            </p>
          )}
        </div>
        <span className="ml-auto shrink-0 text-xs text-[var(--ink-faint)]">
          {expanded ? "▲" : "▼"}
        </span>
      </button>

      {/* Expanded body */}
      {expanded && (
        <div className="border-t border-[var(--border)] px-4 pb-4 pt-3">
          <p className="whitespace-pre-wrap text-sm leading-6 text-[var(--ink)]">
            {record.content}
          </p>
          {record.summary && record.summary !== record.content && (
            <p className="mt-3 text-sm leading-6 text-[var(--ink-muted)]">
              {record.summary}
            </p>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <ClassificationBadge classification={record.classification} />
            <SentimentDot sentiment={record.sentiment} />
            {record.source_type && (
              <span className="text-xs text-[var(--ink-faint)]">
                {record.source_type.replace(/_/g, " ")}
              </span>
            )}
          </div>
        </div>
      )}
    </article>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function AskInterface({ projectId, projectName }: AskInterfaceProps) {
  const [query, setQuery] = useState("");
  const [lastQuery, setLastQuery] = useState("");
  const [response, setResponse] = useState<AskApiResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [trustScope, setTrustScope] = useState<TrustScopeFilter>("include_pending");
  const sourcesRef = useRef<HTMLDivElement>(null);

  function scrollToSource(n: number) {
    const el = document.getElementById(`source-${n}`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
      // Auto-expand on jump
      const toggle = el.querySelector("button");
      if (toggle) toggle.click();
    }
  }

  async function runQuery(nextTrustScope = trustScope) {
    const trimmedQuery = query.trim();
    if (!trimmedQuery) {
      setError("Ask a question about the evidence first.");
      setResponse(null);
      return;
    }

    setLoading(true);
    setError(null);
    setResponse(null);

    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project_id: projectId,
          question: trimmedQuery,
          trust_scope: nextTrustScope,
          limit: 20,
        }),
      });

      const payload = await res.json();

      if (!res.ok) {
        const message =
          typeof payload.error === "string" ? payload.error : "Could not get an answer.";
        setError(message);
        return;
      }

      setLastQuery(trimmedQuery);
      setResponse(payload as AskApiResponse);
    } catch {
      setError("Could not reach the server. Try again.");
    } finally {
      setLoading(false);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void runQuery();
  }

  function handleTrustScopeChange(next: TrustScopeFilter) {
    setTrustScope(next);
    if (response !== null) void runQuery(next);
  }

  const hasSources = response && response.sources.length > 0;
  const hasAnswer = response && response.answer;

  return (
    <div className="mx-auto max-w-3xl">
      {/* Page header */}
      <div className="mb-8">
        <div className="mb-2 text-xs font-medium uppercase tracking-wide text-[var(--ink-faint)]">
          {projectName}
        </div>
        <h1 className="text-2xl font-semibold text-[var(--ink)]">Ask your evidence</h1>
        <p className="mt-2 text-sm leading-6 text-[var(--ink-muted)]">
          Ask a question and get a sourced answer drawn from your transcripts and notes.
        </p>
      </div>

      {/* Query form */}
      <section className="rounded-xl border border-[var(--border)] bg-[var(--surface-1)]">
        <div className="border-b border-[var(--border)] p-4 sm:p-5">
          <form onSubmit={handleSubmit} className="flex flex-col gap-3 sm:flex-row">
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-[var(--surface-0)] px-3 py-2 text-[var(--ink)] outline-none transition-colors placeholder:text-[var(--ink-faint)] focus:border-[var(--brand)]"
              placeholder="What problems did users mention most?"
              disabled={loading}
            />
            <button
              type="submit"
              disabled={loading || !query.trim()}
              className="rounded-lg bg-[var(--brand)] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[var(--brand-dim)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? "Thinking…" : "Ask"}
            </button>
          </form>

          {/* Trust scope toggle */}
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <div className="inline-flex rounded-lg border border-[var(--border)] bg-[var(--surface-0)] p-1">
              <button
                type="button"
                onClick={() => handleTrustScopeChange("trusted")}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                  trustScope === "trusted"
                    ? "bg-[var(--brand)] text-white"
                    : "text-[var(--ink-muted)] hover:text-[var(--ink)]"
                }`}
              >
                Trusted only
              </button>
              <button
                type="button"
                onClick={() => handleTrustScopeChange("include_pending")}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                  trustScope === "include_pending"
                    ? "bg-[var(--brand)] text-white"
                    : "text-[var(--ink-muted)] hover:text-[var(--ink)]"
                }`}
              >
                All evidence
              </button>
            </div>
          </div>
        </div>

        {/* Loading state */}
        {loading && (
          <div className="flex items-center gap-3 px-5 py-8 text-sm text-[var(--ink-muted)]">
            <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-[var(--border)] border-t-[var(--brand)]" />
            Reading through the evidence…
          </div>
        )}

        {/* Error state */}
        {error && !loading && (
          <div className="m-5 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-300">
            {error}
          </div>
        )}

        {/* Empty state */}
        {!loading && !error && !response && (
          <div className="p-12 text-center text-sm text-[var(--ink-muted)]">
            Ask about user problems, workflow gaps, buying signals, or anything in the evidence.
          </div>
        )}

        {/* Answer */}
        {hasAnswer && !loading && (
          <div className="px-5 py-6">
            {/* Metadata line */}
            <p className="mb-4 text-xs text-[var(--ink-faint)]">
              Answer for "{lastQuery}" · drawn from {response.record_count} evidence records
            </p>

            {/* Narrative answer with citation chips */}
            <div className="prose prose-sm max-w-none text-[var(--ink)] leading-7">
              {response.answer.split("\n\n").map((para, i) => (
                <p key={i} className={i > 0 ? "mt-4" : ""}>
                  {renderAnswerWithCitations(para, scrollToSource)}
                </p>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* Sources */}
      {hasSources && !loading && (
        <div className="mt-8" ref={sourcesRef}>
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-[var(--ink-faint)]">
            Sources · {response.sources.length} cited
          </h2>
          <div className="flex flex-col gap-2">
            {response.sources.map((record, i) => (
              <SourceCard
                key={record.id}
                record={record}
                citationNumber={i + 1}
                id={`source-${i + 1}`}
              />
            ))}
          </div>
        </div>
      )}

      {/* Fallback: answer returned but nothing was cited */}
      {hasAnswer && !hasSources && !loading && (
        <p className="mt-4 text-center text-xs text-[var(--ink-faint)]">
          No specific records were cited — the answer is based on general patterns across the evidence.
        </p>
      )}
    </div>
  );
}
