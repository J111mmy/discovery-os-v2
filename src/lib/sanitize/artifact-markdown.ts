import { sanitizeArtifactHtml } from "./artifact-html";

const DATA_N_RE = /^[1-9]\d{0,3}$/;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/&[a-z]+;/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || "section";
}

function tableCells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function isTableDivider(line: string): boolean {
  return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
}

function isTableStart(lines: string[], index: number): boolean {
  return Boolean(lines[index]?.includes("|") && lines[index + 1] && isTableDivider(lines[index + 1]));
}

function isSpecialLine(lines: string[], index: number): boolean {
  const line = (lines[index] ?? "").trim();
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

function renderInline(value: string): string {
  const parts: string[] = [];
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`|\[\d+\])/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(value)) !== null) {
    if (match.index > lastIndex) {
      parts.push(escapeHtml(value.slice(lastIndex, match.index)));
    }

    const token = match[0];
    const citationMatch = /^\[(\d+)\]$/.exec(token);
    if (citationMatch && DATA_N_RE.test(citationMatch[1])) {
      parts.push(`<cite data-n="${citationMatch[1]}">${citationMatch[1]}</cite>`);
    } else if (token.startsWith("**")) {
      parts.push(`<strong>${renderInline(token.slice(2, -2))}</strong>`);
    } else if (token.startsWith("`")) {
      parts.push(`<code>${escapeHtml(token.slice(1, -1))}</code>`);
    } else {
      parts.push(escapeHtml(token));
    }

    lastIndex = pattern.lastIndex;
  }

  if (lastIndex < value.length) {
    parts.push(escapeHtml(value.slice(lastIndex)));
  }

  return parts.join("");
}

function headingHtml(level: number, text: string): string {
  if (level === 1) {
    return `<header class="dp-hero"><h1>${renderInline(text)}</h1></header>`;
  }

  if (level === 2) {
    const section = escapeHtml(text).slice(0, 120);
    return `<section class="sec" id="sec-${slugify(section)}"><h2 class="dp-h2" data-section="${section}">${renderInline(text)}</h2></section>`;
  }

  const tagName = level === 3 ? "h3" : "h4";
  const className = level === 3 ? ' class="dp-h3"' : "";
  return `<${tagName}${className}>${renderInline(text)}</${tagName}>`;
}

function markdownToContractHtml(markdown: string): string {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const blocks: string[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? "";
    const trimmed = line.trim();

    if (!trimmed) {
      index += 1;
      continue;
    }

    if (/^---+$/.test(trimmed)) {
      blocks.push("<hr>");
      index += 1;
      continue;
    }

    if (trimmed.startsWith("```")) {
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index].trim().startsWith("```")) {
        code.push(lines[index]);
        index += 1;
      }
      index += 1;
      blocks.push(`<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`);
      continue;
    }

    if (isTableStart(lines, index)) {
      const headers = tableCells(lines[index]);
      index += 2;
      const rows: string[][] = [];

      while (index < lines.length && lines[index].includes("|") && lines[index].trim()) {
        rows.push(tableCells(lines[index]));
        index += 1;
      }

      blocks.push(
        [
          '<table class="dp-table"><thead><tr>',
          headers.map((header) => `<th>${renderInline(header)}</th>`).join(""),
          "</tr></thead><tbody>",
          rows
            .map(
              (row) =>
                `<tr>${headers
                  .map((_, cellIndex) => `<td>${renderInline(row[cellIndex] ?? "")}</td>`)
                  .join("")}</tr>`
            )
            .join(""),
          "</tbody></table>",
        ].join("")
      );
      continue;
    }

    const heading = /^(#{1,6})\s+(.+)$/.exec(trimmed);
    if (heading) {
      blocks.push(headingHtml(Math.min(heading[1].length, 4), heading[2].trim()));
      index += 1;
      continue;
    }

    if (trimmed.startsWith(">")) {
      const quoteLines: string[] = [];
      while (index < lines.length && lines[index].trim().startsWith(">")) {
        quoteLines.push(lines[index].trim().replace(/^>\s?/, ""));
        index += 1;
      }
      blocks.push(`<blockquote class="pq"><p class="pq-text">${renderInline(quoteLines.join(" "))}</p></blockquote>`);
      continue;
    }

    if (/^[-*]\s+/.test(trimmed)) {
      const items: string[] = [];
      while (index < lines.length && /^[-*]\s+/.test(lines[index].trim())) {
        items.push(lines[index].trim().replace(/^[-*]\s+/, ""));
        index += 1;
      }
      blocks.push(`<ul class="dp-list">${items.map((item) => `<li>${renderInline(item)}</li>`).join("")}</ul>`);
      continue;
    }

    if (/^\d+\.\s+/.test(trimmed)) {
      const items: string[] = [];
      while (index < lines.length && /^\d+\.\s+/.test(lines[index].trim())) {
        items.push(lines[index].trim().replace(/^\d+\.\s+/, ""));
        index += 1;
      }
      blocks.push(`<ol>${items.map((item) => `<li>${renderInline(item)}</li>`).join("")}</ol>`);
      continue;
    }

    const paragraphLines: string[] = [];
    while (index < lines.length && lines[index].trim() && !isSpecialLine(lines, index)) {
      paragraphLines.push(lines[index].trim());
      index += 1;
    }
    blocks.push(`<p>${renderInline(paragraphLines.join(" "))}</p>`);
  }

  return blocks.join("\n");
}

export function markdownToSanitizedArtifactHtml(markdown: string): string {
  return sanitizeArtifactHtml(markdownToContractHtml(markdown));
}
