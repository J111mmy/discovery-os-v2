import { getProjectForUser } from "@/lib/auth/org";
import { createClient } from "@/lib/supabase/server";
import type { ArtifactType } from "@/types/database";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { ReactNode } from "react";

interface Props {
  params: { projectId: string; artifactId: string };
}

type ArtifactRow = {
  id: string;
  title: string;
  type: ArtifactType;
  content_md: string;
  created_at: string;
  word_count: number | null;
  metadata: Record<string, unknown> | null;
};

function dateLabel(value: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

function renderInline(text: string) {
  const nodes: ReactNode[] = [];
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }

    const token = match[0];
    const key = `${match.index}-${token}`;
    if (token.startsWith("**")) {
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

function MarkdownContent({ markdown }: { markdown: string }) {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let index = 0;

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
                    {renderInline(header)}
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
                      {renderInline(row[cellIndex] ?? "")}
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
          {renderInline(text)}
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
              {renderInline(quoteLine)}
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
            <li key={`${item}-${itemIndex}`}>{renderInline(item)}</li>
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
            <li key={`${item}-${itemIndex}`}>{renderInline(item)}</li>
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
        {renderInline(paragraphLines.join(" "))}
      </p>
    );
  }

  return <div className="space-y-5">{blocks}</div>;
}

export default async function ArtifactDetailPage({ params }: Props) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const project = await getProjectForUser<{ id: string; org_id: string; name: string }>(
    user.id,
    params.projectId,
    "id, org_id, name"
  );

  if (!project) notFound();

  const { data: artifact } = await supabase
    .from("artifacts")
    .select("id, title, type, content_md, created_at, word_count, metadata")
    .eq("org_id", project.org_id)
    .eq("project_id", project.id)
    .eq("id", params.artifactId)
    .single();

  if (!artifact) notFound();

  const artifactRow = artifact as ArtifactRow;
  const rawSourceId = artifactRow.metadata?.source_id;
  const sourceId = typeof rawSourceId === "string" ? rawSourceId : null;

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-8">
        {sourceId ? (
          <Link
            href={`/projects/${project.id}/sources/${sourceId}`}
            className="mb-4 inline-flex text-sm font-medium text-[var(--ink-muted)] transition-colors hover:text-[var(--ink)]"
          >
            Back to source
          </Link>
        ) : (
          <Link
            href={`/projects/${project.id}/documents`}
            className="mb-4 inline-flex text-sm font-medium text-[var(--ink-muted)] transition-colors hover:text-[var(--ink)]"
          >
            All documents
          </Link>
        )}
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <span className="rounded-full border border-[var(--border)] bg-[var(--surface-2)] px-2 py-0.5 text-xs font-medium capitalize text-[var(--ink-muted)]">
            {artifactRow.type}
          </span>
          <span className="text-xs text-[var(--ink-faint)]">
            {dateLabel(artifactRow.created_at)}
          </span>
          {artifactRow.word_count !== null && (
            <span className="text-xs text-[var(--ink-faint)]">
              {artifactRow.word_count} words
            </span>
          )}
        </div>
        <h1 className="text-2xl font-semibold text-[var(--ink)]">{artifactRow.title}</h1>
      </div>

      <article className="rounded-xl border border-[var(--border)] bg-[var(--surface-1)] p-6">
        <MarkdownContent markdown={artifactRow.content_md} />
      </article>
    </div>
  );
}
