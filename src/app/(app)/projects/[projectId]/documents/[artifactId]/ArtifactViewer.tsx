"use client";

import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

type CitationRecord = {
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

type CitationsResponse = {
  artifact_id: string;
  citations: CitationRecord[];
};

type ArtifactViewerProps = {
  artifactId: string;
  projectId: string;
  contentMd: string;
};

function tableCells(line: string) {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function isTableDivider(line: string) {
  return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
}

function isTableStart(lines: string[], index: number) {
  return Boolean(lines[index]?.includes("|") && lines[index + 1] && isTableDivider(lines[index + 1]));
}

function isSpecialLine(lines: string[], index: number) {
  const line = lines[index];
  return (
    /^#{1,6}\s+/.test(line) ||
    /^>\s?/.test(line) ||
    /^[-*]\s+/.test(line) ||
    /^\d+\.\s+/.test(line) ||
    /^```/.test(line) ||
    /^---+$/.test(line.trim()) ||
    isTableStart(lines, index)
  );
}

function sourceTypeLabel(value: string | null) {
  if (!value) return null;

  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function clippedQuote(value: string) {
  const trimmed = value.trim();
  return trimmed.length > 220 ? `${trimmed.slice(0, 220).trim()}...` : trimmed;
}

function CitationPopover({
  citation,
  projectId,
  onClose,
}: {
  citation: CitationRecord;
  projectId: string;
  onClose: () => void;
}) {
  const sourceLabel = citation.source_title ?? "Open source";
  const sourceType = sourceTypeLabel(citation.source_type);
  const attribution = [citation.segment_speaker, sourceType].filter(Boolean).join(" / ");

  return (
    <div
      className="absolute left-0 top-full z-30 mt-2 w-[min(22rem,calc(100vw-2rem))] rounded-xl border border-[var(--border)] bg-[var(--surface-0)] p-4 text-left shadow-2xl shadow-black/40"
      role="dialog"
      aria-label={`Citation ${citation.n}`}
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs font-semibold text-[var(--brand)]">[{citation.n}]</div>
          {attribution && (
            <div className="mt-1 truncate text-xs font-medium text-[var(--ink-muted)]">
              {attribution}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded border border-[var(--border)] px-1.5 py-0.5 text-xs text-[var(--ink-muted)] transition-colors hover:border-[var(--brand)] hover:text-[var(--brand)]"
          aria-label="Close citation"
        >
          x
        </button>
      </div>

      <p className="text-sm leading-6 text-[var(--ink)]">"{clippedQuote(citation.content)}"</p>

      {citation.source_id && (
        <a
          href={`/projects/${projectId}/sources/${citation.source_id}`}
          className="mt-3 inline-flex max-w-full truncate text-xs font-medium text-[var(--ink-muted)] transition-colors hover:text-[var(--brand)]"
        >
          {sourceLabel}
        </a>
      )}
    </div>
  );
}

function renderInline(
  text: string,
  citationsLoaded: boolean,
  citationsByNumber: Map<number, CitationRecord>,
  openCitation: number | null,
  setOpenCitation: (n: number | null) => void,
  projectId: string
) {
  const nodes: ReactNode[] = [];
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`|\[\d+\])/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }

    const token = match[0];
    const key = `${match.index}-${token}`;
    const citationMatch = /^\[(\d+)\]$/.exec(token);

    if (citationMatch) {
      const n = Number(citationMatch[1]);
      const citation = citationsLoaded ? citationsByNumber.get(n) : null;

      if (!citation) {
        nodes.push(token);
      } else {
        nodes.push(
          <span key={key} className="relative inline-flex" data-citation-popover-root>
            <button
              type="button"
              onClick={() => setOpenCitation(openCitation === n ? null : n)}
              className="mx-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded bg-[var(--brand)]/15 px-1 align-super text-[10px] font-semibold text-[var(--brand)] transition-colors hover:bg-[var(--brand)]/30"
              aria-label={`Open citation ${n}`}
            >
              {n}
            </button>
            {openCitation === n && (
              <CitationPopover
                citation={citation}
                projectId={projectId}
                onClose={() => setOpenCitation(null)}
              />
            )}
          </span>
        );
      }
    } else if (token.startsWith("**")) {
      nodes.push(
        <strong key={key} className="font-semibold text-[var(--ink)]">
          {token.slice(2, -2)}
        </strong>
      );
    } else {
      nodes.push(
        <code
          key={key}
          className="rounded border border-[var(--border)] bg-[var(--surface-2)] px-1 py-0.5 text-[0.9em] text-[var(--ink)]"
        >
          {token.slice(1, -1)}
        </code>
      );
    }

    lastIndex = pattern.lastIndex;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes;
}

function MarkdownContent({
  markdown,
  citationsLoaded,
  citationsByNumber,
  openCitation,
  setOpenCitation,
  projectId,
}: {
  markdown: string;
  citationsLoaded: boolean;
  citationsByNumber: Map<number, CitationRecord>;
  openCitation: number | null;
  setOpenCitation: (n: number | null) => void;
  projectId: string;
}) {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let index = 0;

  const inline = (text: string) =>
    renderInline(text, citationsLoaded, citationsByNumber, openCitation, setOpenCitation, projectId);

  while (index < lines.length) {
    const line = lines[index];
    const trimmed = line.trim();

    if (!trimmed) {
      index += 1;
      continue;
    }

    if (/^---+$/.test(trimmed)) {
      blocks.push(<hr key={`hr-${index}`} className="my-6 border-[var(--border)]" />);
      index += 1;
      continue;
    }

    if (line.startsWith("```")) {
      const code: string[] = [];
      const start = index;
      index += 1;
      while (index < lines.length && !lines[index].startsWith("```")) {
        code.push(lines[index]);
        index += 1;
      }
      index += 1;
      blocks.push(
        <pre
          key={`code-${start}`}
          className="overflow-x-auto rounded-lg border border-[var(--border)] bg-[var(--surface-0)] p-4 text-sm leading-6 text-[var(--ink)]"
        >
          <code>{code.join("\n")}</code>
        </pre>
      );
      continue;
    }

    if (isTableStart(lines, index)) {
      const start = index;
      const headers = tableCells(lines[index]);
      index += 2;
      const rows: string[][] = [];
      while (index < lines.length && lines[index].includes("|") && lines[index].trim()) {
        rows.push(tableCells(lines[index]));
        index += 1;
      }
      blocks.push(
        <div key={`table-${start}`} className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr>
                {headers.map((header, headerIndex) => (
                  <th
                    key={`${header}-${headerIndex}`}
                    className="border-b border-[var(--border)] px-3 py-2 font-semibold text-[var(--ink)]"
                  >
                    {inline(header)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => (
                <tr key={`row-${rowIndex}`} className="border-b border-[var(--border)]/70">
                  {headers.map((_, cellIndex) => (
                    <td
                      key={`cell-${rowIndex}-${cellIndex}`}
                      className="px-3 py-2 align-top text-[var(--ink-muted)]"
                    >
                      {inline(row[cellIndex] ?? "")}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      continue;
    }

    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      const text = heading[2].trim();
      const className =
        level === 1
          ? "text-2xl"
          : level === 2
            ? "text-xl"
            : level === 3
              ? "text-lg"
              : "text-base";

      blocks.push(
        <h2
          key={`heading-${index}`}
          className={`mt-8 font-semibold leading-tight text-[var(--ink)] first:mt-0 ${className}`}
        >
          {inline(text)}
        </h2>
      );
      index += 1;
      continue;
    }

    if (line.startsWith(">")) {
      const start = index;
      const quoteLines: string[] = [];
      while (index < lines.length && lines[index].startsWith(">")) {
        quoteLines.push(lines[index].replace(/^>\s?/, ""));
        index += 1;
      }
      blocks.push(
        <blockquote
          key={`quote-${start}`}
          className="border-l-2 border-[var(--brand)] pl-4 text-sm italic leading-7 text-[var(--ink)]"
        >
          {quoteLines.map((quoteLine, quoteIndex) => (
            <p key={`${quoteLine}-${quoteIndex}`} className={quoteIndex > 0 ? "mt-2" : ""}>
              {inline(quoteLine)}
            </p>
          ))}
        </blockquote>
      );
      continue;
    }

    if (/^[-*]\s+/.test(line)) {
      const start = index;
      const items: string[] = [];
      while (index < lines.length && /^[-*]\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^[-*]\s+/, ""));
        index += 1;
      }
      blocks.push(
        <ul key={`ul-${start}`} className="list-disc space-y-2 pl-5 text-sm leading-7 text-[var(--ink-muted)]">
          {items.map((item, itemIndex) => (
            <li key={`${item}-${itemIndex}`}>{inline(item)}</li>
          ))}
        </ul>
      );
      continue;
    }

    if (/^\d+\.\s+/.test(line)) {
      const start = index;
      const items: string[] = [];
      while (index < lines.length && /^\d+\.\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^\d+\.\s+/, ""));
        index += 1;
      }
      blocks.push(
        <ol key={`ol-${start}`} className="list-decimal space-y-2 pl-5 text-sm leading-7 text-[var(--ink-muted)]">
          {items.map((item, itemIndex) => (
            <li key={`${item}-${itemIndex}`}>{inline(item)}</li>
          ))}
        </ol>
      );
      continue;
    }

    const start = index;
    const paragraphLines: string[] = [];
    while (index < lines.length && lines[index].trim() && !isSpecialLine(lines, index)) {
      paragraphLines.push(lines[index].trim());
      index += 1;
    }
    blocks.push(
      <p key={`p-${start}`} className="text-sm leading-7 text-[var(--ink-muted)]">
        {inline(paragraphLines.join(" "))}
      </p>
    );
  }

  return <div className="space-y-5">{blocks}</div>;
}

export function ArtifactViewer({ artifactId, projectId, contentMd }: ArtifactViewerProps) {
  const [citations, setCitations] = useState<CitationRecord[]>([]);
  const [citationsLoaded, setCitationsLoaded] = useState(false);
  const [openCitation, setOpenCitation] = useState<number | null>(null);

  useEffect(() => {
    let active = true;

    async function loadCitations() {
      try {
        const response = await fetch(`/api/artifacts/${artifactId}/citations`, {
          cache: "no-store",
        });
        if (!response.ok) return;

        const payload = (await response.json()) as CitationsResponse;
        if (active) {
          setCitations(payload.citations ?? []);
          setCitationsLoaded(true);
        }
      } catch {
        if (active) {
          setCitationsLoaded(false);
        }
      }
    }

    void loadCitations();

    return () => {
      active = false;
    };
  }, [artifactId]);

  useEffect(() => {
    if (openCitation === null) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpenCitation(null);
      }
    }

    function onPointerDown(event: MouseEvent) {
      const target = event.target as HTMLElement | null;
      if (!target?.closest("[data-citation-popover-root]")) {
        setOpenCitation(null);
      }
    }

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("mousedown", onPointerDown);

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("mousedown", onPointerDown);
    };
  }, [openCitation]);

  const citationsByNumber = useMemo(
    () => new Map(citations.map((citation) => [citation.n, citation])),
    [citations]
  );
  const sourceCount = useMemo(() => {
    const sourceKeys = new Set(
      citations.map((citation) => citation.source_title ?? citation.source_id ?? "Source")
    );
    return sourceKeys.size;
  }, [citations]);

  return (
    <div>
      <MarkdownContent
        markdown={contentMd}
        citationsLoaded={citationsLoaded}
        citationsByNumber={citationsByNumber}
        openCitation={openCitation}
        setOpenCitation={setOpenCitation}
        projectId={projectId}
      />
      {citations.length > 0 && sourceCount > 0 && (
        <div className="mt-6 border-t border-[var(--border)] pt-4 text-xs text-[var(--ink-faint)]">
          Built from {sourceCount} source{sourceCount === 1 ? "" : "s"}
        </div>
      )}
    </div>
  );
}
