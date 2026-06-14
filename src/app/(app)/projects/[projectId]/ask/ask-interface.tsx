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

// ─── Answer rendering ───────────────────────────────────────────────────────

// The answer arrives as lightly-formatted markdown (headings, bold, lists,
// paragraphs) plus [N] citation markers. We render a narrow markdown subset
// ourselves so citation markers can stay interactive inline chips.

type AnswerBlock =
  | { type: "heading"; level: 1 | 2 | 3; text: string }
  | { type: "paragraph"; text: string }
  | { type: "list"; ordered: boolean; items: string[] };

function parseAnswerBlocks(answer: string): AnswerBlock[] {
  const blocks: AnswerBlock[] = [];
  let paragraphLines: string[] = [];
  let listItems: string[] = [];
  let listOrdered = false;

  function flushParagraph() {
    if (paragraphLines.length > 0) {
      blocks.push({ type: "paragraph", text: paragraphLines.join(" ").trim() });
      paragraphLines = [];
    }
  }

  function flushList() {
    if (listItems.length > 0) {
      blocks.push({ type: "list", ordered: listOrdered, items: listItems });
      listItems = [];
    }
  }

  for (const rawLine of answer.split("\n")) {
    const line = rawLine.trim();

    if (line === "") {
      flushParagraph();
      flushList();
      continue;
    }

    const headingMatch = line.match(/^(#{1,3})\s+(.*)$/);
    if (headingMatch) {
      flushParagraph();
      flushList();
      blocks.push({
        type: "heading",
        level: headingMatch[1].length as 1 | 2 | 3,
        text: headingMatch[2].trim(),
      });
      continue;
    }

    const bulletMatch = line.match(/^[-*]\s+(.*)$/);
    const numberedMatch = line.match(/^\d+[.)]\s+(.*)$/);
    if (bulletMatch || numberedMatch) {
      flushParagraph();
      const ordered = Boolean(numberedMatch);
      const item = (bulletMatch ?? numberedMatch)![1].trim();
      if (listItems.length > 0 && listOrdered !== ordered) {
        flushList();
      }
      listOrdered = ordered;
      listItems.push(item);
      continue;
    }

    flushList();
    paragraphLines.push(line);
  }

  flushParagraph();
  flushList();
  return blocks;
}

// Mirrors parseCitedIndices() in src/lib/llm/prompts/ask.ts so the citation
// number shown/linked here matches the position of the record in `sources`
// (citedSources order), not the raw [N] index into the full retrieval set.
function buildCitationIndexMap(answer: string, total: number): Map<number, number> {
  const re = /\[(\d+)\]/g;
  const indices = new Set<number>();
  let match: RegExpExecArray | null;

  while ((match = re.exec(answer)) !== null) {
    const n = parseInt(match[1], 10);
    if (n >= 1 && n <= total) indices.add(n);
  }

  const sorted = Array.from(indices).sort((a, b) => a - b);
  const map = new Map<number, number>();
  sorted.forEach((raw, i) => map.set(raw, i + 1));
  return map;
}

// Render inline bold (**text**) and [N] citation markers within a text run.
function renderInline(
  text: string,
  citationIndexMap: Map<number, number>,
  onCitationClick: (displayNumber: number) => void
): React.ReactNode[] {
  const tokens = text.split(/(\*\*[^*]+\*\*|\[\d+\])/g).filter(Boolean);

  return tokens.map((token, i) => {
    const boldMatch = token.match(/^\*\*([^*]+)\*\*$/);
    if (boldMatch) {
      return <strong key={i}>{boldMatch[1]}</strong>;
    }

    const citationMatch = token.match(/^\[(\d+)\]$/);
    if (citationMatch) {
      const raw = parseInt(citationMatch[1], 10);
      const displayNumber = citationIndexMap.get(raw);
      if (displayNumber !== undefined) {
        return (
          <button
            key={i}
            type="button"
            onClick={() => onCitationClick(displayNumber)}
            className="mx-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded bg-[var(--accent)]/15 px-1 text-[10px] font-semibold text-[var(--accent)] transition-colors hover:bg-[var(--accent)]/30 align-super"
            title={`Jump to source ${displayNumber}`}
          >
            {displayNumber}
          </button>
        );
      }
    }

    return <span key={i}>{token}</span>;
  });
}

function AnswerBlockView({
  block,
  citationIndexMap,
  onCitationClick,
}: {
  block: AnswerBlock;
  citationIndexMap: Map<number, number>;
  onCitationClick: (displayNumber: number) => void;
}) {
  if (block.type === "heading") {
    const headingClasses =
      block.level === 1
        ? "text-base font-semibold text-[var(--ink)]"
        : block.level === 2
        ? "text-sm font-semibold text-[var(--ink)]"
        : "text-sm font-semibold text-[var(--ink-2)]";
    const Tag = block.level === 1 ? "h2" : block.level === 2 ? "h3" : "h4";
    return (
      <Tag className={headingClasses}>
        {renderInline(block.text, citationIndexMap, onCitationClick)}
      </Tag>
    );
  }

  if (block.type === "list") {
    const ListTag = block.ordered ? "ol" : "ul";
    return (
      <ListTag
        className={`${
          block.ordered ? "list-decimal" : "list-disc"
        } space-y-1.5 pl-5 text-sm leading-6 text-[var(--ink)]`}
      >
        {block.items.map((item, i) => (
          <li key={i}>{renderInline(item, citationIndexMap, onCitationClick)}</li>
        ))}
      </ListTag>
    );
  }

  return (
    <p className="text-sm leading-7 text-[var(--ink)]">
      {renderInline(block.text, citationIndexMap, onCitationClick)}
    </p>
  );
}

function AnswerContent({
  answer,
  recordCount,
  onCitationClick,
}: {
  answer: string;
  recordCount: number;
  onCitationClick: (displayNumber: number) => void;
}) {
  const blocks = parseAnswerBlocks(answer);
  const citationIndexMap = buildCitationIndexMap(answer, recordCount);

  return (
    <div className="grid gap-3">
      {blocks.map((block, i) => (
        <AnswerBlockView
          key={i}
          block={block}
          citationIndexMap={citationIndexMap}
          onCitationClick={onCitationClick}
        />
      ))}
    </div>
  );
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
      ? "border-[var(--accent)]/30 bg-[var(--accent-soft)] text-[var(--accent)]"
      : classification === "verbatim"
      ? "border-info/25 bg-info-bg text-info"
      : classification === "data_point"
      ? "border-info/25 bg-info-bg text-info"
      : "border-warn/25 bg-warn-bg text-warn";

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
      ? "bg-pos"
      : sentiment === "negative"
      ? "bg-neg"
      : sentiment === "mixed"
      ? "bg-warn"
      : "bg-[var(--ink-faint)]";
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-[var(--ink-2)]">
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
      className="scroll-mt-4 rounded-xl border border-[var(--line)] bg-[var(--surface)]"
    >
      {/* Header — always visible */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-start gap-3 p-4 text-left"
      >
        <span className="mt-0.5 flex h-5 min-w-5 items-center justify-center rounded bg-[var(--accent)]/15 text-[10px] font-bold text-[var(--accent)] shrink-0">
          {citationNumber}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-[var(--ink)]">
            {record.source_title ?? "Source"}
          </p>
          {record.segment_speaker && (
            <p className="mt-0.5 text-xs text-[var(--ink-2)]">
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
        <div className="border-t border-[var(--line)] px-4 pb-4 pt-3">
          <p className="whitespace-pre-wrap text-sm leading-6 text-[var(--ink)]">
            {record.content}
          </p>
          {record.summary && record.summary !== record.content && (
            <p className="mt-3 text-sm leading-6 text-[var(--ink-2)]">
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
        <p className="mt-2 text-sm leading-6 text-[var(--ink-2)]">
          Ask a question and get a sourced answer drawn from your transcripts and notes.
        </p>
      </div>

      {/* Query form */}
      <section className="rounded-xl border border-[var(--line)] bg-[var(--surface)]">
        <div className="border-b border-[var(--line)] p-4 sm:p-5">
          <form onSubmit={handleSubmit} className="flex flex-col gap-3 sm:flex-row">
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="min-w-0 flex-1 rounded-lg border border-[var(--line)] bg-[var(--bg)] px-3 py-2 text-[var(--ink)] outline-none transition-colors placeholder:text-[var(--ink-faint)] focus:border-[var(--accent)]"
              placeholder="What problems did users mention most?"
              disabled={loading}
            />
            <button
              type="submit"
              disabled={loading || !query.trim()}
              className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[var(--accent-hover)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? "Thinking…" : "Ask"}
            </button>
          </form>

          {/* Trust scope toggle */}
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <div className="inline-flex rounded-lg border border-[var(--line)] bg-[var(--bg)] p-1">
              <button
                type="button"
                onClick={() => handleTrustScopeChange("trusted")}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                  trustScope === "trusted"
                    ? "bg-[var(--accent)] text-white"
                    : "text-[var(--ink-2)] hover:text-[var(--ink)]"
                }`}
              >
                Trusted only
              </button>
              <button
                type="button"
                onClick={() => handleTrustScopeChange("include_pending")}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                  trustScope === "include_pending"
                    ? "bg-[var(--accent)] text-white"
                    : "text-[var(--ink-2)] hover:text-[var(--ink)]"
                }`}
              >
                All evidence
              </button>
            </div>
          </div>
        </div>

        {/* Loading state */}
        {loading && (
          <div className="flex items-center gap-3 px-5 py-8 text-sm text-[var(--ink-2)]">
            <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-[var(--line)] border-t-[var(--accent)]" />
            Reading through the evidence…
          </div>
        )}

        {/* Error state */}
        {error && !loading && (
          <div className="m-5 rounded-lg border border-neg/20 bg-neg-bg px-3 py-2 text-sm text-neg">
            {error}
          </div>
        )}

        {/* Empty state */}
        {!loading && !error && !response && (
          <div className="p-12 text-center text-sm text-[var(--ink-2)]">
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
            <AnswerContent
              answer={response.answer}
              recordCount={response.record_count}
              onCitationClick={scrollToSource}
            />
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
