import { z } from "zod";

const title = z.string().trim().min(1).max(140);
const label = z.string().trim().min(1).max(100);
const citations = z.array(z.number().int().min(1).max(1000)).min(1).max(12);

const barChartSchema = z.object({
  version: z.literal(1),
  type: z.literal("bar"),
  title,
  unit: z.string().trim().max(24).optional(),
  items: z
    .array(
      z.object({
        label,
        value: z.number().finite().min(0).max(999_999_999),
        citations,
      })
    )
    .min(2)
    .max(12),
});

const matrixChartSchema = z.object({
  version: z.literal(1),
  type: z.literal("matrix"),
  title,
  x_axis: z.object({ label, low: label, high: label }),
  y_axis: z.object({ label, low: label, high: label }),
  points: z
    .array(
      z.object({
        label,
        x: z.number().finite().min(0).max(100),
        y: z.number().finite().min(0).max(100),
        citations,
      })
    )
    .min(1)
    .max(20),
});

const heatmapChartSchema = z.object({
  version: z.literal(1),
  type: z.literal("heatmap"),
  title,
  columns: z.array(label).min(2).max(8),
  rows: z
    .array(
      z.object({
        label,
        cells: z
          .array(
            z.object({
              value: z.number().int().min(0).max(5),
              citations,
            })
          )
          .min(2)
          .max(8),
      })
    )
    .min(1)
    .max(10),
});

export const artifactChartSpecSchema = z.discriminatedUnion("type", [
  barChartSchema,
  matrixChartSchema,
  heatmapChartSchema,
]);

export type ArtifactChartSpec = z.infer<typeof artifactChartSpecSchema>;

export const STRUCTURED_VISUAL_OUTPUT_RULES = `VISUAL OUTPUT RULES:
- Never draw a chart, matrix, diagram, or table inside a code fence with ASCII borders, repeated dots, block glyphs, or monospace art. A normal Markdown table is allowed.
- Use a normal Markdown table for tabular comparisons.
- Only create a quantitative visualization when the supplied evidence supports every value. Do not invent scores or counts.
- For a bar chart, 2x2 matrix, or heat matrix, emit exactly one fenced discos-chart JSON object using one of these compact shapes:
  {"version":1,"type":"bar","title":"...","unit":"optional","items":[{"label":"...","value":3,"citations":[1,2]}]}
  {"version":1,"type":"matrix","title":"...","x_axis":{"label":"...","low":"...","high":"..."},"y_axis":{"label":"...","low":"...","high":"..."},"points":[{"label":"...","x":75,"y":60,"citations":[1]}]}
  {"version":1,"type":"heatmap","title":"...","columns":["..."],"rows":[{"label":"...","cells":[{"value":0,"citations":[1]}]}]}
- Chart values use numbers, matrix coordinates use 0-100, heatmap values use 0-5, and citations contain the supporting evidence numbers without brackets.
- Output valid JSON only inside a discos-chart fence. Do not add commentary inside the fence.`;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)));
}

function renderCitations(values: number[]): string {
  return Array.from(new Set(values))
    .map((value) => `<cite data-n="${value}">${value}</cite>`)
    .join("");
}

function renderBarChart(spec: z.infer<typeof barChartSchema>): string {
  const max = Math.max(1, ...spec.items.map((item) => item.value));
  const unit = spec.unit ? ` <span class="chart-unit">${escapeHtml(spec.unit)}</span>` : "";

  return [
    '<figure class="dp-chart chart-bar">',
    `<figcaption class="chart-title">${escapeHtml(spec.title)}${unit}</figcaption>`,
    '<div class="chart-bars">',
    ...spec.items.map((item) => {
      const value = formatNumber(item.value);
      return [
        '<div class="chart-bar-row">',
        `<span class="chart-label">${escapeHtml(item.label)}${renderCitations(item.citations)}</span>`,
        `<meter class="chart-meter" min="0" max="${formatNumber(max)}" value="${value}">${value}</meter>`,
        `<span class="chart-value">${value}</span>`,
        "</div>",
      ].join("");
    }),
    "</div>",
    "</figure>",
  ].join("");
}

function renderMatrixChart(spec: z.infer<typeof matrixChartSchema>): string {
  const quadrants = [
    { className: "matrix-tl", xHigh: false, yHigh: true },
    { className: "matrix-tr", xHigh: true, yHigh: true },
    { className: "matrix-bl", xHigh: false, yHigh: false },
    { className: "matrix-br", xHigh: true, yHigh: false },
  ];

  const cells = quadrants.map((quadrant) => {
    const points = spec.points.filter(
      (point) => (point.x >= 50) === quadrant.xHigh && (point.y >= 50) === quadrant.yHigh
    );
    return [
      `<div class="matrix-cell ${quadrant.className}">`,
      points.length > 0
        ? `<ul class="chart-point-list">${points
            .map(
              (point) =>
                `<li>${escapeHtml(point.label)}${renderCitations(point.citations)}</li>`
            )
            .join("")}</ul>`
        : '<span class="chart-empty">No supported items</span>',
      "</div>",
    ].join("");
  });

  return [
    '<figure class="dp-chart chart-matrix">',
    `<figcaption class="chart-title">${escapeHtml(spec.title)}</figcaption>`,
    `<div class="matrix-y-high">${escapeHtml(spec.y_axis.high)}</div>`,
    `<div class="matrix-grid">${cells.join("")}</div>`,
    `<div class="matrix-x-axis"><span>${escapeHtml(spec.x_axis.low)}</span><strong>${escapeHtml(spec.x_axis.label)}</strong><span>${escapeHtml(spec.x_axis.high)}</span></div>`,
    `<div class="matrix-y-low">${escapeHtml(spec.y_axis.low)} · ${escapeHtml(spec.y_axis.label)}</div>`,
    '<div class="dp-table-wrap"><table class="dp-table chart-data-table"><thead><tr><th>Item</th><th>',
    escapeHtml(spec.x_axis.label),
    "</th><th>",
    escapeHtml(spec.y_axis.label),
    "</th></tr></thead><tbody>",
    ...spec.points.map(
      (point) =>
        `<tr><td>${escapeHtml(point.label)}${renderCitations(point.citations)}</td><td>${formatNumber(point.x)}</td><td>${formatNumber(point.y)}</td></tr>`
    ),
    "</tbody></table></div>",
    "</figure>",
  ].join("");
}

function renderHeatmapChart(spec: z.infer<typeof heatmapChartSchema>): string {
  return [
    '<figure class="dp-chart chart-heatmap">',
    `<figcaption class="chart-title">${escapeHtml(spec.title)}</figcaption>`,
    '<div class="dp-table-wrap"><table class="dp-table heatmap-table"><thead><tr><th>Signal</th>',
    ...spec.columns.map((column) => `<th>${escapeHtml(column)}</th>`),
    "</tr></thead><tbody>",
    ...spec.rows.map((row) => [
      `<tr><th>${escapeHtml(row.label)}</th>`,
      ...row.cells.map(
        (cell) =>
          `<td><span class="heat heat-${cell.value}">${cell.value}${renderCitations(cell.citations)}</span></td>`
      ),
      "</tr>",
    ].join("")),
    "</tbody></table></div>",
    "</figure>",
  ].join("");
}

export function parseArtifactChartSpec(input: string): ArtifactChartSpec {
  const parsed = JSON.parse(input.trim()) as unknown;
  const spec = artifactChartSpecSchema.parse(parsed);

  if (spec.type === "heatmap") {
    const invalidRow = spec.rows.findIndex((row) => row.cells.length !== spec.columns.length);
    if (invalidRow >= 0) {
      throw new Error(`Heatmap row ${invalidRow + 1} must have one cell per column.`);
    }
  }

  return spec;
}

export function artifactChartSpecToHtml(input: string): string {
  const spec = parseArtifactChartSpec(input);
  if (spec.type === "bar") return renderBarChart(spec);
  if (spec.type === "matrix") return renderMatrixChart(spec);
  return renderHeatmapChart(spec);
}

function citationsForSpec(spec: ArtifactChartSpec): number[] {
  if (spec.type === "bar") return spec.items.flatMap((item) => item.citations);
  if (spec.type === "matrix") return spec.points.flatMap((point) => point.citations);
  return spec.rows.flatMap((row) => row.cells.flatMap((cell) => cell.citations));
}

export function chartCitationNumbersFromMarkdown(markdown: string): number[] {
  const values: number[] = [];
  const chartFencePattern = /```discos-chart\s*\n([\s\S]*?)```/gi;
  let match: RegExpExecArray | null;

  while ((match = chartFencePattern.exec(markdown)) !== null) {
    values.push(...citationsForSpec(parseArtifactChartSpec(match[1] ?? "")));
  }

  return values;
}

export function assertNoAsciiChartArt(markdown: string): void {
  if (/[█▓▒░](?:\s*[█▓▒░]){1,}|[●○](?:\s*[●○]){1,}/.test(markdown)) {
    throw new Error("Generated artifact contains unsupported glyph-based chart art.");
  }

  if (/^\s*\+(?:[-=]{2,}\+){1,}\s*$/m.test(markdown)) {
    throw new Error("Generated artifact contains an unsupported ASCII table or chart.");
  }

  const codeBlockPattern = /```(?!discos-chart)[^\n]*\n([\s\S]*?)```/gi;
  let match: RegExpExecArray | null;
  while ((match = codeBlockPattern.exec(markdown)) !== null) {
    const structuralLines = (match[1] ?? "")
      .split("\n")
      .filter((line: string) => /^[\s|+\-:●○█▓▒░]+$/.test(line) && line.trim().length >= 4);
    if (structuralLines.length >= 2) {
      throw new Error("Generated artifact contains an unsupported monospace chart.");
    }
  }
}
