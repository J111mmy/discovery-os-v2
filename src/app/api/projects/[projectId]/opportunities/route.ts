import { getProjectForUser } from "@/lib/auth/org";
import { getProjectOrgReadForUser } from "@/lib/auth/support-read";
import { requireActiveAccess } from "@/lib/auth/access";
import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

const visibleReviewStates = ["suggested", "accepted", "edited"] as const;
const visibleOpportunityStatuses = ["suggested", "accepted", "active"] as const;

type OpportunityRow = {
  id: string;
  title: string;
  description: string | null;
  how_might_we: string | null;
  status: string;
  confidence: string;
  source: string;
  review_state: string;
  agent_run_id: string | null;
  created_by: string | null;
  accepted_by: string | null;
  accepted_at: string | null;
  created_at: string;
  updated_at: string;
};

type ProblemOpportunityLinkRow = {
  problem_id: string;
  opportunity_id: string;
  relationship: string;
  source: string;
  review_state: string;
  rationale: string | null;
  created_at: string;
};

type OpportunityEvidenceLinkRow = {
  opportunity_id: string;
  evidence_id: string;
  relationship: string;
  rationale: string | null;
  created_at: string;
};

type OpportunityThemeLinkRow = {
  opportunity_id: string;
  theme_id: string;
  relationship: string;
  rationale: string | null;
  created_at: string;
};

type ProblemRow = {
  id: string;
  title: string;
  description: string | null;
  statement: string | null;
  status: string | null;
  severity: string | null;
  confidence: string | null;
  review_state: string | null;
  who_affected: string | null;
  what_is_hard: string | null;
  why_it_matters: string | null;
  current_workarounds: string[] | null;
  current_tools: string[] | null;
  created_at: string;
  updated_at: string | null;
};

type EvidenceRow = {
  id: string;
  source_id: string;
  segment_id: string | null;
  content: string;
  summary: string | null;
  trust_scope: string;
  classification: string | null;
  sentiment: string | null;
  metadata: unknown;
  created_at: string;
};

type ThemeRow = {
  id: string;
  label: string;
  description: string | null;
  evidence_count: number | null;
  central_concept: string | null;
  interpretation: string | null;
  status: string | null;
  review_state: string | null;
  confidence: string | null;
};

type SourceRow = {
  id: string;
  title: string | null;
  type: string | null;
};

type SegmentRow = {
  id: string;
  source_id: string;
  segment_index: number | null;
  speaker: string | null;
  redacted_content: string | null;
};

function parseLimit(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get("limit");
  if (!raw) return 50;

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return 50;
  return Math.min(parsed, 100);
}

function unique(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))));
}

function asRows<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function rowsForOpportunity<T extends { opportunity_id: string }>(rows: T[], opportunityId: string) {
  return rows.filter((row) => row.opportunity_id === opportunityId);
}

function metadataObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function anchorMethodForEvidence(evidence: EvidenceRow) {
  const metadata = metadataObject(evidence.metadata);
  return typeof metadata.anchor_method === "string" ? metadata.anchor_method : null;
}

export async function GET(
  req: NextRequest,
  { params }: { params: { projectId: string } }
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

  const project = await getProjectForUser<{ id: string; org_id: string }>(
    user.id,
    params.projectId,
    "id, org_id"
  );
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }
  const read = await getProjectOrgReadForUser({
    userId: user.id,
    orgId: project.org_id,
    memberClient: supabase,
  });

  const limit = parseLimit(req);
  const opportunitiesResult = await read
    .from("opportunities")
    .select(
      [
        "id",
        "title",
        "description",
        "how_might_we",
        "status",
        "confidence",
        "source",
        "review_state",
        "agent_run_id",
        "created_by",
        "accepted_by",
        "accepted_at",
        "created_at",
        "updated_at",
      ].join(", ")
    )
    .eq("project_id", project.id)
    .in("status", [...visibleOpportunityStatuses])
    .in("review_state", [...visibleReviewStates])
    .order("updated_at", { ascending: false })
    .limit(limit);

  if (opportunitiesResult.error) {
    return NextResponse.json(
      { error: `Failed to load opportunities: ${opportunitiesResult.error.message}` },
      { status: 500 }
    );
  }

  const opportunities = asRows<OpportunityRow>(opportunitiesResult.data);
  const opportunityIds = opportunities.map((opportunity) => opportunity.id);

  if (opportunityIds.length === 0) {
    return NextResponse.json({ opportunities: [], total: 0 });
  }

  const [problemLinksResult, evidenceLinksResult, themeLinksResult] = await Promise.all([
    read
      .from("problem_opportunities")
      .select("problem_id, opportunity_id, relationship, source, review_state, rationale, created_at")
      .eq("project_id", project.id)
      .in("opportunity_id", opportunityIds)
      .in("review_state", [...visibleReviewStates]),
    read
      .from("opportunity_evidence")
      .select("opportunity_id, evidence_id, relationship, rationale, created_at")
      .eq("project_id", project.id)
      .in("opportunity_id", opportunityIds),
    read
      .from("opportunity_themes")
      .select("opportunity_id, theme_id, relationship, rationale, created_at")
      .eq("project_id", project.id)
      .in("opportunity_id", opportunityIds),
  ]);

  if (problemLinksResult.error) {
    return NextResponse.json(
      { error: `Failed to load opportunity problem links: ${problemLinksResult.error.message}` },
      { status: 500 }
    );
  }
  if (evidenceLinksResult.error) {
    return NextResponse.json(
      { error: `Failed to load opportunity evidence links: ${evidenceLinksResult.error.message}` },
      { status: 500 }
    );
  }
  if (themeLinksResult.error) {
    return NextResponse.json(
      { error: `Failed to load opportunity theme links: ${themeLinksResult.error.message}` },
      { status: 500 }
    );
  }

  const problemLinks = asRows<ProblemOpportunityLinkRow>(problemLinksResult.data);
  const evidenceLinks = asRows<OpportunityEvidenceLinkRow>(evidenceLinksResult.data);
  const themeLinks = asRows<OpportunityThemeLinkRow>(themeLinksResult.data);

  const problemIds = unique(problemLinks.map((link) => link.problem_id));
  const evidenceIds = unique(evidenceLinks.map((link) => link.evidence_id));
  const themeIds = unique(themeLinks.map((link) => link.theme_id));

  const [problemsResult, evidenceResult, themesResult] = await Promise.all([
    problemIds.length > 0
      ? read
          .from("problems")
          .select(
            [
              "id",
              "title",
              "description",
              "statement",
              "status",
              "severity",
              "confidence",
              "review_state",
              "who_affected",
              "what_is_hard",
              "why_it_matters",
              "current_workarounds",
              "current_tools",
              "created_at",
              "updated_at",
            ].join(", ")
          )
          .eq("project_id", project.id)
          .in("id", problemIds)
      : Promise.resolve({ data: [], error: null }),
    evidenceIds.length > 0
      ? read
          .from("evidence")
          .select(
            "id, source_id, segment_id, content, summary, trust_scope, classification, sentiment, metadata, created_at"
          )
          .eq("project_id", project.id)
          .in("id", evidenceIds)
      : Promise.resolve({ data: [], error: null }),
    themeIds.length > 0
      ? read
          .from("themes")
          .select(
            "id, label, description, evidence_count, central_concept, interpretation, status, review_state, confidence"
          )
          .eq("project_id", project.id)
          .in("id", themeIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (problemsResult.error) {
    return NextResponse.json(
      { error: `Failed to load linked problems: ${problemsResult.error.message}` },
      { status: 500 }
    );
  }
  if (evidenceResult.error) {
    return NextResponse.json(
      { error: `Failed to load linked evidence: ${evidenceResult.error.message}` },
      { status: 500 }
    );
  }
  if (themesResult.error) {
    return NextResponse.json(
      { error: `Failed to load linked themes: ${themesResult.error.message}` },
      { status: 500 }
    );
  }

  const problems = asRows<ProblemRow>(problemsResult.data);
  const evidence = asRows<EvidenceRow>(evidenceResult.data);
  const themes = asRows<ThemeRow>(themesResult.data);
  const sourceIds = unique(evidence.map((row) => row.source_id));
  const segmentIds = unique(evidence.map((row) => row.segment_id));

  const [sourcesResult, segmentsResult] = await Promise.all([
    sourceIds.length > 0
      ? read
          .from("sources")
          .select("id, title, type")
          .eq("project_id", project.id)
          .in("id", sourceIds)
      : Promise.resolve({ data: [], error: null }),
    segmentIds.length > 0
      ? read
          .from("source_segments")
          .select("id, source_id, segment_index, speaker, redacted_content")
          .in("source_id", sourceIds)
          .in("id", segmentIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (sourcesResult.error) {
    return NextResponse.json(
      { error: `Failed to load linked sources: ${sourcesResult.error.message}` },
      { status: 500 }
    );
  }
  if (segmentsResult.error) {
    return NextResponse.json(
      { error: `Failed to load linked segments: ${segmentsResult.error.message}` },
      { status: 500 }
    );
  }

  const sourceById = new Map(
    asRows<SourceRow>(sourcesResult.data).map((source) => [source.id, source])
  );
  const segmentById = new Map(
    asRows<SegmentRow>(segmentsResult.data).map((segment) => [segment.id, segment])
  );
  const problemById = new Map(problems.map((problem) => [problem.id, problem]));
  const evidenceById = new Map(evidence.map((row) => [row.id, row]));
  const themeById = new Map(themes.map((theme) => [theme.id, theme]));

  const response = opportunities.map((opportunity) => {
    const linksToProblems = rowsForOpportunity(problemLinks, opportunity.id);
    const linksToEvidence = rowsForOpportunity(evidenceLinks, opportunity.id);
    const linksToThemes = rowsForOpportunity(themeLinks, opportunity.id);

    return {
      ...opportunity,
      link_counts: {
        problems: linksToProblems.length,
        evidence: linksToEvidence.length,
        themes: linksToThemes.length,
      },
      problem_links: linksToProblems.map((link) => ({
        ...link,
        problem: problemById.get(link.problem_id) ?? null,
      })),
      evidence_links: linksToEvidence.map((link) => {
        const linkedEvidence = evidenceById.get(link.evidence_id) ?? null;
        const source = linkedEvidence ? sourceById.get(linkedEvidence.source_id) ?? null : null;
        const segment = linkedEvidence?.segment_id
          ? segmentById.get(linkedEvidence.segment_id) ?? null
          : null;

        return {
          ...link,
          evidence: linkedEvidence
            ? {
                ...linkedEvidence,
                source_title: source?.title ?? null,
                source_type: source?.type ?? null,
                segment_speaker: segment?.speaker ?? null,
                segment_index: segment?.segment_index ?? null,
                segment_redacted_content: segment?.redacted_content ?? null,
                anchor_method: anchorMethodForEvidence(linkedEvidence),
              }
            : null,
        };
      }),
      theme_links: linksToThemes.map((link) => ({
        ...link,
        theme: themeById.get(link.theme_id) ?? null,
      })),
    };
  });

  return NextResponse.json({ opportunities: response, total: response.length });
}
