// GET /api/artifacts/[id]/claims
// Returns verified claim rows plus their linked evidence previews for the artifact reader.

import { requireActiveAccess } from "@/lib/auth/access";
import { getOrgScopedReadForUser } from "@/lib/auth/support-read";
import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import type { ArtifactVerificationStatus, VerificationStatus } from "@/types/database";

type ClaimEvidencePreview = {
  evidence_id: string;
  quote: string;
  snippet: string;
  person: string | null;
  speaker: string | null;
  source_title: string | null;
  source_type: string | null;
};

type ClaimResponse = {
  claim_id: string;
  claim_text: string;
  section_heading: string | null;
  verification_status: VerificationStatus;
  evidence_count: number;
  evidence: ClaimEvidencePreview[];
};

type ArtifactClaimsResponse = {
  artifact_id: string;
  verification_status: ArtifactVerificationStatus;
  verification_run_at: string | null;
  claims: ClaimResponse[];
};

type ArtifactRow = {
  id: string;
  org_id: string;
  project_id: string;
  verification_status: ArtifactVerificationStatus;
  verification_run_at: string | null;
};

type ClaimRow = {
  id: string;
  claim_text: string;
  section_heading: string | null;
  verification_status: VerificationStatus;
};

type ClaimEvidenceRow = {
  claim_id: string;
  evidence_id: string;
};

type EvidenceRow = {
  id: string;
  content: string;
  summary: string | null;
  source_id: string | null;
  segment_id: string | null;
};

type SourceRow = {
  id: string;
  title: string;
  type: string;
};

type SegmentRow = {
  id: string;
  speaker: string | null;
};

function snippetFor(content: string) {
  const trimmed = content.trim();
  return trimmed.length > 220 ? `${trimmed.slice(0, 217)}...` : trimmed;
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

  const access = await requireActiveAccess({ id: user.id, email: user.email });
  if (!access.ok) {
    return NextResponse.json(
      { error: access.error, access_status: access.status },
      { status: 403 }
    );
  }

  const read = await getOrgScopedReadForUser(user.id, supabase);
  if (!read) {
    return NextResponse.json({ error: "Not a member of any organisation" }, { status: 403 });
  }

  const artifactId = params.id;
  const { data: artifact, error: artifactError } = await read
    .from("artifacts")
    .select("id, org_id, project_id, verification_status, verification_run_at")
    .eq("id", artifactId)
    .single();

  if (artifactError || !artifact) {
    return NextResponse.json({ error: "Artifact not found" }, { status: 404 });
  }

  const artifactRow = artifact as ArtifactRow;

  const { data: claimsData, error: claimsError } = await read
    .from("artifact_claims")
    .select("id, claim_text, section_heading, verification_status")
    .eq("artifact_id", artifactRow.id);

  if (claimsError) {
    return NextResponse.json({ error: "Could not load artifact claims" }, { status: 500 });
  }

  const claimRows = (claimsData ?? []) as ClaimRow[];
  if (claimRows.length === 0) {
    return NextResponse.json({
      artifact_id: artifactRow.id,
      verification_status: artifactRow.verification_status,
      verification_run_at: artifactRow.verification_run_at,
      claims: [],
    } satisfies ArtifactClaimsResponse);
  }

  const claimIds = claimRows.map((claim) => claim.id);
  const { data: linksData, error: linksError } = await read
    .from("artifact_claim_evidence")
    .select("claim_id, evidence_id")
    .in("claim_id", claimIds);

  if (linksError) {
    return NextResponse.json({ error: "Could not load claim evidence links" }, { status: 500 });
  }

  const links = (linksData ?? []) as ClaimEvidenceRow[];
  const evidenceIds = Array.from(new Set(links.map((link) => link.evidence_id)));

  const { data: evidenceData, error: evidenceError } =
    evidenceIds.length > 0
      ? await read
          .from("evidence")
          .select("id, content, summary, source_id, segment_id")
          .in("id", evidenceIds)
      : { data: [], error: null };

  if (evidenceError) {
    return NextResponse.json({ error: "Could not load supporting evidence" }, { status: 500 });
  }

  const evidenceRows = (evidenceData ?? []) as EvidenceRow[];
  const sourceIds = Array.from(
    new Set(evidenceRows.map((row) => row.source_id).filter(Boolean))
  ) as string[];
  const segmentIds = Array.from(
    new Set(evidenceRows.map((row) => row.segment_id).filter(Boolean))
  ) as string[];

  const [sourcesResult, segmentsResult] = await Promise.all([
    sourceIds.length > 0
      ? read.from("sources").select("id, title, type").in("id", sourceIds)
      : Promise.resolve({ data: [], error: null }),
    segmentIds.length > 0
      ? read.from("source_segments").select("id, speaker").in("id", segmentIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (sourcesResult.error) {
    return NextResponse.json({ error: "Could not load evidence sources" }, { status: 500 });
  }
  if (segmentsResult.error) {
    return NextResponse.json({ error: "Could not load evidence speakers" }, { status: 500 });
  }

  const evidenceById = new Map(evidenceRows.map((row) => [row.id, row]));
  const sourceById = new Map(
    ((sourcesResult.data ?? []) as SourceRow[]).map((source) => [source.id, source])
  );
  const segmentById = new Map(
    ((segmentsResult.data ?? []) as SegmentRow[]).map((segment) => [segment.id, segment])
  );
  const linksByClaimId = new Map<string, string[]>();

  for (const link of links) {
    const existing = linksByClaimId.get(link.claim_id) ?? [];
    existing.push(link.evidence_id);
    linksByClaimId.set(link.claim_id, existing);
  }

  const claims = claimRows.map((claim) => {
    const previews = Array.from(new Set(linksByClaimId.get(claim.id) ?? []))
      .map((evidenceId) => {
        const evidence = evidenceById.get(evidenceId);
        if (!evidence) return null;

        const source = evidence.source_id ? sourceById.get(evidence.source_id) : null;
        const segment = evidence.segment_id ? segmentById.get(evidence.segment_id) : null;
        const quote = evidence.summary?.trim() || evidence.content;

        return {
          evidence_id: evidence.id,
          quote,
          snippet: snippetFor(evidence.content),
          person: segment?.speaker ?? null,
          speaker: segment?.speaker ?? null,
          source_title: source?.title ?? null,
          source_type: source?.type ?? null,
        } satisfies ClaimEvidencePreview;
      })
      .filter((preview): preview is ClaimEvidencePreview => preview !== null);

    return {
      claim_id: claim.id,
      claim_text: claim.claim_text,
      section_heading: claim.section_heading,
      verification_status: claim.verification_status,
      evidence_count: previews.length,
      evidence: previews,
    } satisfies ClaimResponse;
  });

  return NextResponse.json({
    artifact_id: artifactRow.id,
    verification_status: artifactRow.verification_status,
    verification_run_at: artifactRow.verification_run_at,
    claims,
  } satisfies ArtifactClaimsResponse);
}
