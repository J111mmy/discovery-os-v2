// GET /api/artifacts/[id]/trace
// Returns the typed structure links stamped by structure-driven compose.

import { requireActiveAccess } from "@/lib/auth/access";
import { getOrgScopedReadForUser } from "@/lib/auth/support-read";
import { createClient } from "@/lib/supabase/server";
import { VISIBLE_REVIEW_STATES } from "@/lib/research-ontology/review-states";
import { NextRequest, NextResponse } from "next/server";

type LinkRow<TId extends string> = {
  [K in TId]: string;
} & {
  relationship: string;
  review_state: string;
  rationale: string | null;
};

type ArtifactRow = {
  id: string;
  project_id: string;
};

type ProblemRow = {
  id: string;
  title: string;
  statement: string | null;
  status: string | null;
  severity: string | null;
  review_state: string | null;
};

type ThemeRow = {
  id: string;
  label: string;
  central_concept: string | null;
  status: string | null;
  review_state: string | null;
};

type OpportunityRow = {
  id: string;
  title: string;
  how_might_we: string | null;
  status: string | null;
  confidence: number | null;
  review_state: string | null;
};

type TraceLink = {
  relationship: string;
  review_state: string;
  rationale: string | null;
};

type ProblemTrace = ProblemRow & { link: TraceLink };
type ThemeTrace = ThemeRow & { link: TraceLink };
type OpportunityTrace = OpportunityRow & { link: TraceLink };

export type ArtifactTraceResponse = {
  artifact_id: string;
  counts: {
    opportunities: number;
    problems: number;
    themes: number;
    evidence: number;
  };
  opportunities: OpportunityTrace[];
  problems: ProblemTrace[];
  themes: ThemeTrace[];
};

function uniqueIds<TId extends string>(rows: LinkRow<TId>[], key: TId) {
  return Array.from(new Set(rows.map((row) => row[key]).filter(Boolean)));
}

function linkFor<TId extends string>(row: LinkRow<TId>): TraceLink {
  return {
    relationship: row.relationship,
    review_state: row.review_state,
    rationale: row.rationale ?? null,
  };
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
    .select("id, project_id")
    .eq("id", artifactId)
    .single();

  if (artifactError || !artifact) {
    return NextResponse.json({ error: "Artifact not found" }, { status: 404 });
  }

  const artifactRow = artifact as ArtifactRow;
  const visibleStates = [...VISIBLE_REVIEW_STATES];

  const [opportunityLinksResult, problemLinksResult, themeLinksResult, evidenceLinksResult] =
    await Promise.all([
      read
        .from("artifact_opportunities")
        .select("opportunity_id, relationship, review_state, rationale")
        .eq("project_id", artifactRow.project_id)
        .eq("artifact_id", artifactRow.id)
        .in("review_state", visibleStates),
      read
        .from("artifact_problems")
        .select("problem_id, relationship, review_state, rationale")
        .eq("project_id", artifactRow.project_id)
        .eq("artifact_id", artifactRow.id)
        .in("review_state", visibleStates),
      read
        .from("artifact_themes")
        .select("theme_id, relationship, review_state, rationale")
        .eq("project_id", artifactRow.project_id)
        .eq("artifact_id", artifactRow.id)
        .in("review_state", visibleStates),
      read
        .from("artifact_evidence")
        .select("evidence_id, relationship, review_state, rationale")
        .eq("project_id", artifactRow.project_id)
        .eq("artifact_id", artifactRow.id)
        .in("review_state", visibleStates),
    ]);

  if (
    opportunityLinksResult.error ||
    problemLinksResult.error ||
    themeLinksResult.error ||
    evidenceLinksResult.error
  ) {
    return NextResponse.json({ error: "Could not load artifact trace links" }, { status: 500 });
  }

  const opportunityLinks = (opportunityLinksResult.data ?? []) as LinkRow<"opportunity_id">[];
  const problemLinks = (problemLinksResult.data ?? []) as LinkRow<"problem_id">[];
  const themeLinks = (themeLinksResult.data ?? []) as LinkRow<"theme_id">[];
  const evidenceLinks = (evidenceLinksResult.data ?? []) as LinkRow<"evidence_id">[];

  const opportunityIds = uniqueIds(opportunityLinks, "opportunity_id");
  const problemIds = uniqueIds(problemLinks, "problem_id");
  const themeIds = uniqueIds(themeLinks, "theme_id");

  const [opportunitiesResult, problemsResult, themesResult] = await Promise.all([
    opportunityIds.length > 0
      ? read
          .from("opportunities")
          .select("id, title, how_might_we, status, confidence, review_state")
          .eq("project_id", artifactRow.project_id)
          .in("id", opportunityIds)
      : Promise.resolve({ data: [], error: null }),
    problemIds.length > 0
      ? read
          .from("problems")
          .select("id, title, statement, status, severity, review_state")
          .eq("project_id", artifactRow.project_id)
          .in("id", problemIds)
      : Promise.resolve({ data: [], error: null }),
    themeIds.length > 0
      ? read
          .from("themes")
          .select("id, label, central_concept, status, review_state")
          .eq("project_id", artifactRow.project_id)
          .in("id", themeIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (opportunitiesResult.error || problemsResult.error || themesResult.error) {
    return NextResponse.json({ error: "Could not load artifact trace records" }, { status: 500 });
  }

  const opportunitiesById = new Map(
    ((opportunitiesResult.data ?? []) as OpportunityRow[]).map((row) => [row.id, row])
  );
  const problemsById = new Map(
    ((problemsResult.data ?? []) as ProblemRow[]).map((row) => [row.id, row])
  );
  const themesById = new Map(
    ((themesResult.data ?? []) as ThemeRow[]).map((row) => [row.id, row])
  );

  const opportunities = opportunityLinks
    .map((link) => {
      const opportunity = opportunitiesById.get(link.opportunity_id);
      return opportunity ? { ...opportunity, link: linkFor(link) } : null;
    })
    .filter((row): row is OpportunityTrace => row !== null);

  const problems = problemLinks
    .map((link) => {
      const problem = problemsById.get(link.problem_id);
      return problem ? { ...problem, link: linkFor(link) } : null;
    })
    .filter((row): row is ProblemTrace => row !== null);

  const themes = themeLinks
    .map((link) => {
      const theme = themesById.get(link.theme_id);
      return theme ? { ...theme, link: linkFor(link) } : null;
    })
    .filter((row): row is ThemeTrace => row !== null);

  return NextResponse.json({
    artifact_id: artifactRow.id,
    counts: {
      opportunities: opportunities.length,
      problems: problems.length,
      themes: themes.length,
      evidence: uniqueIds(evidenceLinks, "evidence_id").length,
    },
    opportunities,
    problems,
    themes,
  } satisfies ArtifactTraceResponse);
}
