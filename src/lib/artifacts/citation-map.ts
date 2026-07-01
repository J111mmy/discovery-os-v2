export function metadataObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function readCitationMap(metadata: Record<string, unknown>) {
  const raw = metadata.citation_map;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};

  const map: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    const n = Number.parseInt(key, 10);
    if (!Number.isFinite(n) || n < 1 || String(n) !== key) continue;
    if (typeof value !== "string" || value.trim().length === 0) continue;
    map[key] = value;
  }
  return map;
}

export function readEvidenceIds(metadata: Record<string, unknown>) {
  const raw = metadata.evidence_ids;
  return Array.isArray(raw)
    ? raw.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    : [];
}

export function parseRenderedCitationNumbers(contentHtml: string | null, contentMd: string | null) {
  const numbers = new Set<number>();
  const add = (value: string) => {
    const n = Number.parseInt(value, 10);
    if (Number.isFinite(n) && n > 0) numbers.add(n);
  };

  if (contentHtml) {
    const dataN = /\bdata-n=(?:"|')(\d+)(?:"|')/g;
    let match: RegExpExecArray | null;
    while ((match = dataN.exec(contentHtml)) !== null) add(match[1]);
  }

  if (contentMd) {
    const markdownCitation = /\[(\d+)\]/g;
    let match: RegExpExecArray | null;
    while ((match = markdownCitation.exec(contentMd)) !== null) add(match[1]);
  }

  return Array.from(numbers).sort((a, b) => a - b);
}

export function fillCitationMapFromEvidenceOrder({
  citationMap,
  citationNumbers,
  evidenceIds,
}: {
  citationMap: Record<string, string>;
  citationNumbers: number[];
  evidenceIds: string[];
}) {
  const next = { ...citationMap };
  for (const n of citationNumbers) {
    const key = String(n);
    if (next[key]) continue;
    const evidenceId = evidenceIds[n - 1];
    if (evidenceId) next[key] = evidenceId;
  }
  return next;
}

export function resolveArtifactCitationMap({
  metadata,
  contentHtml,
  contentMd,
}: {
  metadata: unknown;
  contentHtml: string | null;
  contentMd: string | null;
}) {
  const meta = metadataObject(metadata);
  return fillCitationMapFromEvidenceOrder({
    citationMap: readCitationMap(meta),
    citationNumbers: parseRenderedCitationNumbers(contentHtml, contentMd),
    evidenceIds: readEvidenceIds(meta),
  });
}
