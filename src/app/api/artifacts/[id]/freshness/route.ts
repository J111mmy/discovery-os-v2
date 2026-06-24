// GET /api/artifacts/[id]/freshness
// Answers "how far behind is this document": counts evidence that arrived after the
// artifact's baseline (latest version save, else creation) and is linked to the
// artifact's problems/themes/opportunities. Counts only — no LLM, no classification.

import { requireActiveAccess } from "@/lib/auth/access";
import { getOrgScopedReadForUser } from "@/lib/auth/support-read";
import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

type FreshnessByProblem = {
  problem_id: string;
  title: string;
  new_count: number;
};

type ArtifactFreshnessResponse = {
  artifact_id: string;
  baseline_at: string;
  new_evidence_count: number;
  by_problem: FreshnessByProblem[];
};

type ArtifactRow = {
  id: string;
  created_at: string;
};

// Rows from the *_evidence link tables, with the linked evidence's arrival time
// embedded via an inner join so we can filter on evidence.created_at > baseline.
type ProblemEvidenceRow = {
  problem_id: string;
  evidence_id: string;
};

type ThemeEvidenceRow = {
  evidence_id: string;
};

type OpportunityEvidenceRow = {
  evidence_id: string;
};

type ProblemRow = {
  id: string;
  title: string;
};

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
    .select("id, created_at")
    .eq("id", artifactId)
    .single();

  if (artifactError || !artifact) {
    return NextResponse.json({ error: "Artifact not found" }, { status: 404 });
  }

  const artifactRow = artifact as ArtifactRow;

  // Baseline = latest version save, falling back to artifact creation.
  const { data: versionData, error: versionError } = await read
    .from("artifact_versions")
    .select("saved_at")
    .eq("artifact_id", artifactRow.id)
    .order("saved_at", { ascending: false })
    .limit(1);

  if (versionError) {
    return NextResponse.json({ error: "Could not load artifact versions" }, { status: 500 });
  }

  const baselineAt =
    ((versionData ?? [])[0] as { saved_at: string } | undefined)?.saved_at ??
    artifactRow.created_at;

  // The artifact's linked problems / themes / opportunities.
  const [problemLinks, themeLinks, opportunityLinks] = await Promise.all([
    read.from("artifact_problems").select("problem_id").eq("artifact_id", artifactRow.id),
    read.from("artifact_themes").select("theme_id").eq("artifact_id", artifactRow.id),
    read.from("artifact_opportunities").select("opportunity_id").eq("artifact_id", artifactRow.id),
  ]);

  if (problemLinks.error || themeLinks.error || opportunityLinks.error) {
    return NextResponse.json({ error: "Could not load artifact links" }, { status: 500 });
  }

  const problemIds = Array.from(
    new Set(((problemLinks.data ?? []) as { problem_id: string }[]).map((r) => r.problem_id))
  );
  const themeIds = Array.from(
    new Set(((themeLinks.data ?? []) as { theme_id: string }[]).map((r) => r.theme_id))
  );
  const opportunityIds = Array.from(
    new Set(
      ((opportunityLinks.data ?? []) as { opportunity_id: string }[]).map((r) => r.opportunity_id)
    )
  );

  // Nothing linked → nothing to be behind on.
  if (problemIds.length === 0 && themeIds.length === 0 && opportunityIds.length === 0) {
    return NextResponse.json({
      artifact_id: artifactRow.id,
      baseline_at: baselineAt,
      new_evidence_count: 0,
      by_problem: [],
    } satisfies ArtifactFreshnessResponse);
  }

  // New evidence linked through each entity type. `evidence!inner(...)` filters to
  // evidence whose own created_at is after the baseline. Relationship type is ignored
  // (support/contradict classification is deliberately out of scope — counts only).
  const [problemEvidence, themeEvidence, opportunityEvidence] = await Promise.all([
    problemIds.length > 0
      ? read
          .from("problem_evidence")
          .select("problem_id, evidence_id, evidence!inner(created_at)")
          .in("problem_id", problemIds)
          .gt("evidence.created_at", baselineAt)
      : Promise.resolve({ data: [], error: null }),
    themeIds.length > 0
      ? read
          .from("theme_evidence")
          .select("evidence_id, evidence!inner(created_at)")
          .in("theme_id", themeIds)
          .gt("evidence.created_at", baselineAt)
      : Promise.resolve({ data: [], error: null }),
    opportunityIds.length > 0
      ? read
          .from("opportunity_evidence")
          .select("evidence_id, evidence!inner(created_at)")
          .in("opportunity_id", opportunityIds)
          .gt("evidence.created_at", baselineAt)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (problemEvidence.error) {
    return NextResponse.json({ error: "Could not load problem evidence" }, { status: 500 });
  }
  if (themeEvidence.error) {
    return NextResponse.json({ error: "Could not load theme evidence" }, { status: 500 });
  }
  if (opportunityEvidence.error) {
    return NextResponse.json({ error: "Could not load opportunity evidence" }, { status: 500 });
  }

  const problemEvidenceRows = (problemEvidence.data ?? []) as ProblemEvidenceRow[];
  const themeEvidenceRows = (themeEvidence.data ?? []) as ThemeEvidenceRow[];
  const opportunityEvidenceRows = (opportunityEvidence.data ?? []) as OpportunityEvidenceRow[];

  // De-dupe evidence ids across every link type for the headline count.
  const newEvidenceIds = new Set<string>();
  for (const row of problemEvidenceRows) newEvidenceIds.add(row.evidence_id);
  for (const row of themeEvidenceRows) newEvidenceIds.add(row.evidence_id);
  for (const row of opportunityEvidenceRows) newEvidenceIds.add(row.evidence_id);

  // Per-problem breakdown: distinct new evidence per problem.
  const evidenceByProblem = new Map<string, Set<string>>();
  for (const row of problemEvidenceRows) {
    const set = evidenceByProblem.get(row.problem_id) ?? new Set<string>();
    set.add(row.evidence_id);
    evidenceByProblem.set(row.problem_id, set);
  }

  const problemsWithNew = Array.from(evidenceByProblem.keys());
  let titleById = new Map<string, string>();
  if (problemsWithNew.length > 0) {
    const { data: problemRows, error: problemsError } = await read
      .from("problems")
      .select("id, title")
      .in("id", problemsWithNew);

    if (problemsError) {
      return NextResponse.json({ error: "Could not load problem titles" }, { status: 500 });
    }

    titleById = new Map(
      ((problemRows ?? []) as ProblemRow[]).map((p) => [p.id, p.title])
    );
  }

  const byProblem: FreshnessByProblem[] = problemsWithNew
    .map((problemId) => ({
      problem_id: problemId,
      title: titleById.get(problemId) ?? "",
      new_count: evidenceByProblem.get(problemId)?.size ?? 0,
    }))
    .sort((a, b) => b.new_count - a.new_count || a.title.localeCompare(b.title));

  return NextResponse.json({
    artifact_id: artifactRow.id,
    baseline_at: baselineAt,
    new_evidence_count: newEvidenceIds.size,
    by_problem: byProblem,
  } satisfies ArtifactFreshnessResponse);
}
