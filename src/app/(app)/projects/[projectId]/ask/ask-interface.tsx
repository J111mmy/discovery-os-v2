"use client";

import { FormEvent, useState } from "react";
import type { EvidenceRecord } from "@/types/database";

type TrustScopeFilter = "include_pending" | "trusted";

interface AskInterfaceProps {
  projectId: string;
  projectName: string;
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

function ClassificationBadge({ classification }: { classification: EvidenceRecord["classification"] }) {
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

function SentimentIndicator({ sentiment }: { sentiment: EvidenceRecord["sentiment"] }) {
  if (!sentiment) return null;

  const classes =
    sentiment === "positive"
      ? "bg-green-400"
      : sentiment === "negative"
      ? "bg-red-400"
      : sentiment === "mixed"
      ? "bg-yellow-400"
      : "bg-[var(--ink-faint)]";

  return (
    <span className="mt-1 inline-flex items-center gap-1.5 text-xs font-medium text-[var(--ink-muted)]">
      <span className={`h-1.5 w-1.5 rounded-full ${classes}`} />
      {sentiment}
    </span>
  );
}

function EvidenceResultCard({ record }: { record: EvidenceRecord }) {
  return (
    <article className="rounded-xl border border-[var(--border)] bg-[var(--surface-1)] p-5">
      <p className="whitespace-pre-wrap text-sm leading-6 text-[var(--ink)]">
        {record.content}
      </p>

      {record.summary && (
        <p className="mt-3 text-sm leading-6 text-[var(--ink-muted)]">{record.summary}</p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <ClassificationBadge classification={record.classification} />
        <SentimentIndicator sentiment={record.sentiment} />
        <TrustBadge trustScope={record.trust_scope} />
        <span className="text-xs text-[var(--ink-muted)]">
          {record.segment_speaker ? `— ${record.segment_speaker} · ` : ""}
          {record.source_title ?? "Source unavailable"}
          {record.source_type ? ` · ${record.source_type}` : ""}
        </span>
      </div>
    </article>
  );
}

export function AskInterface({ projectId, projectName }: AskInterfaceProps) {
  const [query, setQuery] = useState("");
  const [lastQuery, setLastQuery] = useState("");
  const [results, setResults] = useState<EvidenceRecord[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [trustScope, setTrustScope] = useState<TrustScopeFilter>("include_pending");

  async function runQuery(nextTrustScope = trustScope) {
    const trimmedQuery = query.trim();
    if (!trimmedQuery) {
      setError("Ask a question about the evidence first.");
      setResults(null);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project_id: projectId,
          q: trimmedQuery,
          trust_scope: nextTrustScope,
          limit: 20,
        }),
      });

      const payload = await response.json();

      if (!response.ok) {
        const message =
          typeof payload.error === "string" ? payload.error : "Could not query evidence.";
        setError(message);
        setResults(null);
        return;
      }

      setLastQuery(payload.query ?? trimmedQuery);
      setResults(payload.records ?? []);
    } catch {
      setError("Could not query evidence.");
      setResults(null);
    } finally {
      setLoading(false);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void runQuery();
  }

  function handleTrustScopeChange(nextTrustScope: TrustScopeFilter) {
    setTrustScope(nextTrustScope);
    if (results !== null) {
      void runQuery(nextTrustScope);
    }
  }

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-8">
        <div className="mb-2 text-xs font-medium uppercase tracking-wide text-[var(--ink-faint)]">
          {projectName}
        </div>
        <h1 className="text-2xl font-semibold text-[var(--ink)]">Ask your evidence</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--ink-muted)]">
          Ask a question and DiscOS will retrieve the source-backed records most relevant to it.
        </p>
      </div>

      <section className="rounded-xl border border-[var(--border)] bg-[var(--surface-1)]">
        <div className="border-b border-[var(--border)] p-4 sm:p-5">
          <form onSubmit={handleSubmit} className="flex flex-col gap-3 lg:flex-row">
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-[var(--surface-0)] px-3 py-2 text-[var(--ink)] outline-none transition-colors placeholder:text-[var(--ink-faint)] focus:border-[var(--brand)]"
              placeholder="What problems did users mention?"
            />
            <button
              type="submit"
              disabled={loading}
              className="rounded-lg bg-[var(--brand)] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[var(--brand-dim)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              Search
            </button>
          </form>

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
            {loading && <span className="text-xs text-[var(--ink-muted)]">Searching...</span>}
          </div>
        </div>

        {error && (
          <div className="m-5 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-300">
            {error}
          </div>
        )}

        {results !== null && !error && (
          <div className="border-b border-[var(--border)] px-5 py-3 text-xs text-[var(--ink-muted)]">
            {results.length} results for "{lastQuery}"
          </div>
        )}

        {results !== null && results.length === 0 && !error ? (
          <div className="p-12 text-center text-sm text-[var(--ink-muted)]">
            No matching evidence found. Try a broader question or switch to All evidence.
          </div>
        ) : results && results.length > 0 ? (
          <div className="grid gap-3 p-4 sm:p-5">
            {results.map((record) => (
              <EvidenceResultCard key={record.id} record={record} />
            ))}
          </div>
        ) : (
          <div className="p-12 text-center text-sm text-[var(--ink-muted)]">
            Ask about user problems, workflow gaps, buying signals, or anything else in the evidence base.
          </div>
        )}
      </section>
    </div>
  );
}
