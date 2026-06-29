// GET /api/artifacts/[id]/citations
// Returns the evidence records cited in a composed artifact, keyed by citation number.
// Reads citation_map from artifact.metadata and fetches the linked evidence records.

import { NextRequest, NextResponse } from "next/server";
import { getOrgScopedReadForUser } from "@/lib/auth/support-read";
import { createClient } from "@/lib/supabase/server";
import type { EvidenceRecord } from "@/types/database";

export interface CitationRecord {
  n: number;          // 1-based citation number as it appears in the artifact text
  evidence_id: string;
  content: string;
  summary: string | null;
  source_id: string | null;
  source_title: string | null;
  source_type: string | null;
  segment_speaker: string | null;
  classification: EvidenceRecord["classification"];
  sentiment: EvidenceRecord["sentiment"];
}

export interface CitationsResponse {
  citations: CitationRecord[];
  artifact_id: string;
}

function metadataObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readCitationMap(metadata: Record<string, unknown>) {
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

function readEvidenceIds(metadata: Record<string, unknown>) {
  const raw = metadata.evidence_ids;
  return Array.isArray(raw)
    ? raw.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    : [];
}

function parseRenderedCitationNumbers(contentHtml: string | null, contentMd: string | null) {
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

function fillCitationMapFromEvidenceOrder({
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

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const artifactId = params.id;

  const read = await getOrgScopedReadForUser(user.id, supabase);

  if (!read) {
    return NextResponse.json({ error: "Not a member of any organisation" }, { status: 403 });
  }

  // Fetch the artifact — must belong to this org
  const { data: artifact, error: artifactError } = await read
    .from("artifacts")
    .select("id, org_id, project_id, metadata, content_html, content_md")
    .eq("id", artifactId)
    .single();

  if (artifactError || !artifact) {
    return NextResponse.json({ error: "Artifact not found" }, { status: 404 });
  }

  // Pull citation_map from metadata. If older/degraded compose left the map
  // incomplete, fill missing visible citation numbers from metadata.evidence_ids,
  // which preserves the selected evidence order used in the compose prompt.
  const meta = metadataObject(artifact.metadata);
  const citationMap = fillCitationMapFromEvidenceOrder({
    citationMap: readCitationMap(meta),
    citationNumbers: parseRenderedCitationNumbers(
      artifact.content_html as string | null,
      artifact.content_md as string | null
    ),
    evidenceIds: readEvidenceIds(meta),
  });

  const entries = Object.entries(citationMap);
  if (entries.length === 0) {
    return NextResponse.json({ citations: [], artifact_id: artifactId } satisfies CitationsResponse);
  }

  type EvidenceRow = {
    id: string;
    content: string;
    summary: string | null;
    source_id: string | null;
    segment_id: string | null;
    classification: EvidenceRecord["classification"];
    sentiment: EvidenceRecord["sentiment"];
  };

  // Fetch all cited evidence records in one query
  const evidenceIds = entries.map(([, id]) => id);
  const { data: evidenceRows } = await read
    .from("evidence")
    .select("id, content, summary, source_id, segment_id, classification, sentiment")
    .eq("project_id", artifact.project_id)
    .in("id", evidenceIds);

  const typedEvidenceRows = (evidenceRows ?? []) as EvidenceRow[];

  const evidenceById = new Map(
    typedEvidenceRows.map((r) => [r.id, r])
  );

  // Fetch source titles for cited records
  const sourceIds = Array.from(
    new Set(typedEvidenceRows.map((r) => r.source_id).filter(Boolean))
  ) as string[];

  const segmentIds = Array.from(
    new Set(typedEvidenceRows.map((r) => r.segment_id).filter(Boolean))
  ) as string[];

  const [sourcesResult, segmentsResult] = await Promise.all([
    sourceIds.length > 0
      ? read
          .from("sources")
          .select("id, title, type")
          .eq("project_id", artifact.project_id)
          .in("id", sourceIds)
      : Promise.resolve({ data: [] }),
    segmentIds.length > 0
      ? read
          .from("source_segments")
          .select("id, speaker")
          .in("id", segmentIds)
      : Promise.resolve({ data: [] }),
  ]);

  const sourceById = new Map(
    ((sourcesResult.data ?? []) as Array<{ id: string; title: string; type: string }>).map(
      (s) => [s.id, s]
    )
  );
  const segmentById = new Map(
    ((segmentsResult.data ?? []) as Array<{ id: string; speaker: string | null }>).map(
      (s) => [s.id, s]
    )
  );

  // Build response — sorted by citation number
  const citations: CitationRecord[] = entries
    .map(([nStr, evidenceId]) => {
      const n = parseInt(nStr, 10);
      const ev = evidenceById.get(evidenceId);
      if (!ev) return null;

      const source = ev.source_id ? sourceById.get(ev.source_id) : null;
      const segment = ev.segment_id ? segmentById.get(ev.segment_id) : null;

      return {
        n,
        evidence_id: evidenceId,
        content: ev.content,
        summary: ev.summary ?? null,
        source_id: ev.source_id,
        source_title: source?.title ?? null,
        source_type: source?.type ?? null,
        segment_speaker: segment?.speaker ?? null,
        classification: ev.classification ?? null,
        sentiment: ev.sentiment ?? null,
      } satisfies CitationRecord;
    })
    .filter((c): c is CitationRecord => c !== null)
    .sort((a, b) => a.n - b.n);

  return NextResponse.json({ citations, artifact_id: artifactId } satisfies CitationsResponse);
}
