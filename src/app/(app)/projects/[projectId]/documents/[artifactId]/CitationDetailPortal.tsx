"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

export type CitationRecord = {
  n: number;
  evidence_id: string;
  content: string;
  summary: string | null;
  source_id?: string | null;
  source_title: string | null;
  source_type: string | null;
  segment_speaker: string | null;
  classification: "insight" | "verbatim" | "data_point" | "signal" | null;
  sentiment: "positive" | "negative" | "neutral" | "mixed" | null;
};

function sourceTypeLabel(value: string | null) {
  if (!value) return null;
  return value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function clippedQuote(value: string) {
  const trimmed = value.trim();
  return trimmed.length > 220 ? `${trimmed.slice(0, 220).trim()}...` : trimmed;
}

const POPOVER_WIDTH = 352;
const VIEWPORT_MARGIN = 16;
const ESTIMATED_HEIGHT = 180;

export function CitationDetailPortal({
  citation,
  projectId,
  anchorRect,
  onClose,
}: {
  citation: CitationRecord;
  projectId: string;
  anchorRect: DOMRect;
  onClose: () => void;
}) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return null;

  const left = Math.min(
    Math.max(anchorRect.left, VIEWPORT_MARGIN),
    window.innerWidth - POPOVER_WIDTH - VIEWPORT_MARGIN
  );
  const overflowsBelow = anchorRect.bottom + ESTIMATED_HEIGHT + 8 > window.innerHeight;
  const top = overflowsBelow
    ? Math.max(VIEWPORT_MARGIN, anchorRect.top - ESTIMATED_HEIGHT - 8)
    : anchorRect.bottom + 8;

  const sourceLabel = citation.source_title ?? "Open source";
  const sourceType = sourceTypeLabel(citation.source_type);
  const attribution = [citation.segment_speaker, sourceType].filter(Boolean).join(" / ");

  return createPortal(
    <div
      data-citation-detail-portal
      role="dialog"
      aria-label={`Citation ${citation.n}`}
      className="fixed z-50 w-[22rem] max-w-[calc(100vw-2rem)] rounded-xl border border-[var(--line)] bg-[var(--bg)] p-4 text-left shadow-2xl shadow-black/40"
      style={{ left, top }}
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs font-semibold text-[var(--accent)]">[{citation.n}]</div>
          {attribution && (
            <div className="mt-1 truncate text-xs font-medium text-[var(--ink-2)]">
              {attribution}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded border border-[var(--line)] px-1.5 py-0.5 text-xs text-[var(--ink-2)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]"
          aria-label="Close citation"
        >
          x
        </button>
      </div>

      <p className="text-sm leading-6 text-[var(--ink)]">&quot;{clippedQuote(citation.content)}&quot;</p>

      {citation.source_id && (
        <a
          href={`/projects/${projectId}/sources/${citation.source_id}`}
          className="mt-3 inline-flex max-w-full truncate text-xs font-medium text-[var(--ink-2)] transition-colors hover:text-[var(--accent)]"
        >
          {sourceLabel}
        </a>
      )}
    </div>,
    document.body
  );
}
