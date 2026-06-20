import { getProjectForUser } from "@/lib/auth/org";
import {
  adjacentProjectHintedEvidenceIds,
  filterAdjacentProjectHintedEvidence,
} from "@/lib/evidence/adjacent-project";
import { createClient } from "@/lib/supabase/server";
import { notFound, redirect } from "next/navigation";
import { PipelineRail } from "../PipelineRail";
import { ProblemsList, type ProblemDetail, type ProblemRow } from "./problems-list";

interface Props {
  params: { projectId: string };
  searchParams?: { problem?: string };
}

const severityOrder: Record<ProblemRow["severity"], number> = {
  high: 0,
  medium: 1,
  low: 2,
};

function sortProblems(problems: ProblemRow[]) {
  return [...problems].sort((a, b) => {
    const severityDelta = severityOrder[a.severity] - severityOrder[b.severity];
    if (severityDelta !== 0) return severityDelta;
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });
}

function isUuid(value: string | undefined): value is string {
  return Boolean(
    value &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  );
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function metadataObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function unique(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))));
}

type ProblemEvidenceLink = {
  evidence_id: string;
  relationship: ProblemDetail["evidence"][number]["relationship"];
  rationale: string | null;
  review_state: ProblemDetail["evidence"][number]["review_state"];
  confidence: number | string | null;
  source: ProblemDetail["evidence"][number]["source"];
  agent_run_id: string | null;
  created_at: string;
};

type ProblemThemeLink = {
  theme_id: string;
  relationship: ProblemDetail["themes"][number]["relationship"];
  rationale: string | null;
  review_state: ProblemDetail["themes"][number]["review_state"];
  source: ProblemDetail["themes"][number]["source"];
  agent_run_id: string | null;
  created_at: string;
};

type ProblemTopicLink = {
  topic_id: string;
  relationship: ProblemDetail["topics"][number]["relationship"];
  rationale: string | null;
  review_state: ProblemDetail["topics"][number]["review_state"];
  source: ProblemDetail["topics"][number]["source"];
  agent_run_id: string | null;
  created_at: string;
};

type ProblemListRow = Omit<ProblemRow, "source_theme_ids" | "source_evidence_ids">;

type ProblemListEvidenceLink = {
  problem_id: string;
  evidence_id: string;
  review_state: string;
};

type ProblemListThemeLink = {
  problem_id: string;
  theme_id: string;
  review_state: string;
};

const visibleReviewStates = new Set(["suggested", "accepted", "edited"]);

const evidenceRelationshipOrder: Record<ProblemEvidenceLink["relationship"], number> = {
  supporting: 0,
  contradicting: 1,
  example: 2,
  edge_case: 3,
  provenance: 4,
};

const themeRelationshipOrder: Record<ProblemThemeLink["relationship"], number> = {
  primary: 0,
  contributing: 1,
  provenance: 2,
};

function isVisibleReviewState(value: string) {
  return visibleReviewStates.has(value);
}

function numericConfidence(value: number | string | null) {
  if (value === null) return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function confidenceRank(value: number | string | null) {
  const parsed = numericConfidence(value);
  return parsed === null ? -1 : parsed;
}

function provenanceState(
  relationships: string[],
  provenanceRelationship = "provenance"
): ProblemDetail["evidence_provenance_state"] {
  if (relationships.length === 0) return "empty";
  const hasProvenance = relationships.includes(provenanceRelationship);
  const hasAssessed = relationships.some((relationship) => relationship !== provenanceRelationship);
  if (hasProvenance && hasAssessed) return "mixed";
  if (hasProvenance) return "legacy_only";
  return "assessed";
}

function addProblemLink(
  linksByProblem: Map<string, Set<string>>,
  problemId: string,
  linkedId: string
) {
  const links = linksByProblem.get(problemId) ?? new Set<string>();
  links.add(linkedId);
  linksByProblem.set(problemId, links);
}

async function hydrateProblemRowsWithTypedLinks(input: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  orgId: string;
  projectId: string;
  rows: ProblemListRow[];
}): Promise<ProblemRow[]> {
  const { supabase, orgId, projectId, rows } = input;
  const problemIds = rows.map((problem) => problem.id);

  if (problemIds.length === 0) return [];

  const [problemEvidenceResult, problemThemesResult] = await Promise.all([
    supabase
      .from("problem_evidence")
      .select("problem_id, evidence_id, review_state")
      .eq("org_id", orgId)
      .eq("project_id", projectId)
      .in("problem_id", problemIds),
    supabase
      .from("problem_themes")
      .select("problem_id, theme_id, review_state")
      .eq("org_id", orgId)
      .eq("project_id", projectId)
      .in("problem_id", problemIds),
  ]);

  if (problemEvidenceResult.error) throw new Error("Failed to load typed problem evidence links");
  if (problemThemesResult.error) throw new Error("Failed to load typed problem theme links");

  let visibleEvidenceLinks = ((problemEvidenceResult.data ?? []) as ProblemListEvidenceLink[])
    .filter((link) => isVisibleReviewState(link.review_state));
  const visibleThemeLinks = ((problemThemesResult.data ?? []) as ProblemListThemeLink[])
    .filter((link) => isVisibleReviewState(link.review_state));

  const evidenceIds = unique(visibleEvidenceLinks.map((link) => link.evidence_id));
  if (evidenceIds.length > 0) {
    const { data, error } = await supabase
      .from("evidence")
      .select("id, metadata")
      .eq("org_id", orgId)
      .eq("project_id", projectId)
      .in("id", evidenceIds);

    if (error) throw new Error("Failed to load typed problem evidence metadata");

    const adjacentEvidenceIds = adjacentProjectHintedEvidenceIds(
      (data ?? []) as Array<{ id: string; metadata: unknown }>
    );
    visibleEvidenceLinks = visibleEvidenceLinks.filter(
      (link) => !adjacentEvidenceIds.has(link.evidence_id)
    );
  }

  const evidenceIdsByProblem = new Map<string, Set<string>>();
  const themeIdsByProblem = new Map<string, Set<string>>();

  for (const link of visibleEvidenceLinks) {
    addProblemLink(evidenceIdsByProblem, link.problem_id, link.evidence_id);
  }

  for (const link of visibleThemeLinks) {
    addProblemLink(themeIdsByProblem, link.problem_id, link.theme_id);
  }

  return rows.map((problem) => ({
    ...problem,
    source_evidence_ids: Array.from(evidenceIdsByProblem.get(problem.id) ?? []),
    source_theme_ids: Array.from(themeIdsByProblem.get(problem.id) ?? []),
  }));
}

async function getProblemDetail(input: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  orgId: string;
  projectId: string;
  problem: ProblemRow;
}): Promise<ProblemDetail> {
  const { supabase, orgId, projectId, problem } = input;

  const [problemEvidenceResult, problemThemesResult, problemTopicsResult] = await Promise.all([
    supabase
      .from("problem_evidence")
      .select("evidence_id, relationship, rationale, review_state, confidence, source, agent_run_id, created_at")
      .eq("org_id", orgId)
      .eq("project_id", projectId)
      .eq("problem_id", problem.id),
    supabase
      .from("problem_themes")
      .select("theme_id, relationship, rationale, review_state, source, agent_run_id, created_at")
      .eq("org_id", orgId)
      .eq("project_id", projectId)
      .eq("problem_id", problem.id),
    supabase
      .from("problem_topics")
      .select("topic_id, relationship, rationale, review_state, source, agent_run_id, created_at")
      .eq("org_id", orgId)
      .eq("project_id", projectId)
      .eq("problem_id", problem.id),
  ]);

  if (problemEvidenceResult.error) throw new Error("Failed to load problem evidence links");
  if (problemThemesResult.error) throw new Error("Failed to load problem theme links");
  if (problemTopicsResult.error) throw new Error("Failed to load problem topic links");

  const allEvidenceLinks = (problemEvidenceResult.data ?? []) as ProblemEvidenceLink[];
  const allThemeLinks = (problemThemesResult.data ?? []) as ProblemThemeLink[];
  const allTopicLinks = (problemTopicsResult.data ?? []) as ProblemTopicLink[];
  const visibleEvidenceLinks = allEvidenceLinks
    .filter((link) => isVisibleReviewState(link.review_state))
    .sort((a, b) => {
      const relationshipDelta =
        evidenceRelationshipOrder[a.relationship] - evidenceRelationshipOrder[b.relationship];
      if (relationshipDelta !== 0) return relationshipDelta;
      const confidenceDelta = confidenceRank(b.confidence) - confidenceRank(a.confidence);
      if (confidenceDelta !== 0) return confidenceDelta;
      return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    });
  const visibleThemeLinks = allThemeLinks
    .filter((link) => isVisibleReviewState(link.review_state))
    .sort((a, b) => {
      const relationshipDelta =
        themeRelationshipOrder[a.relationship] - themeRelationshipOrder[b.relationship];
      if (relationshipDelta !== 0) return relationshipDelta;
      return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    });
  const visibleTopicLinks = allTopicLinks
    .filter((link) => isVisibleReviewState(link.review_state))
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

  const evidenceIds = unique(visibleEvidenceLinks.map((link) => link.evidence_id));
  const themeIds = unique(visibleThemeLinks.map((link) => link.theme_id));
  const topicIds = unique(visibleTopicLinks.map((link) => link.topic_id));

  const [themesResult, evidenceResult, topicsResult] = await Promise.all([
    themeIds.length > 0
      ? supabase
          .from("themes")
          .select("id, label, description, evidence_count, central_concept, interpretation")
          .eq("org_id", orgId)
          .eq("project_id", projectId)
          .in("id", themeIds)
      : Promise.resolve({ data: [], error: null }),
    evidenceIds.length > 0
      ? supabase
          .from("evidence")
          .select(
            "id, source_id, segment_id, content, summary, trust_scope, themes, metadata, created_at, classification, sentiment"
          )
          .eq("org_id", orgId)
          .eq("project_id", projectId)
          .in("id", evidenceIds)
      : Promise.resolve({ data: [], error: null }),
    topicIds.length > 0
      ? supabase
          .from("topics")
          .select("id, label")
          .eq("org_id", orgId)
          .eq("project_id", projectId)
          .in("id", topicIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (themesResult.error) throw new Error("Failed to load problem themes");
  if (evidenceResult.error) throw new Error("Failed to load problem evidence");
  if (topicsResult.error) throw new Error("Failed to load problem topics");

  const fetchedEvidence = (evidenceResult.data ?? []) as Array<{
    id: string;
    source_id: string;
    segment_id: string | null;
    content: string;
    summary: string | null;
    trust_scope: string;
    themes: string[] | null;
    metadata: unknown;
    created_at: string;
    classification: string | null;
    sentiment: string | null;
  }>;
  const adjacentEvidenceIds = adjacentProjectHintedEvidenceIds(fetchedEvidence);
  const visibleEvidenceLinksForDisplay = visibleEvidenceLinks.filter(
    (link) => !adjacentEvidenceIds.has(link.evidence_id)
  );
  const relatedEvidence = filterAdjacentProjectHintedEvidence(fetchedEvidence);
  const visibleEvidenceIds = unique(visibleEvidenceLinksForDisplay.map((link) => link.evidence_id));
  const themes = (themesResult.data ?? []) as Array<{
    id: string;
    label: string;
    description: string | null;
    evidence_count: number;
    central_concept: string | null;
    interpretation: string | null;
  }>;
  const topics = (topicsResult.data ?? []) as Array<{
    id: string;
    label: string;
  }>;
  const sourceIds = unique(relatedEvidence.map((row) => row.source_id));
  const segmentIds = unique(relatedEvidence.map((row) => row.segment_id));

  const [sourcesResult, segmentsResult, entitiesResult] = await Promise.all([
    sourceIds.length > 0
      ? supabase
          .from("sources")
          .select("id, title, type")
          .eq("org_id", orgId)
          .eq("project_id", projectId)
          .in("id", sourceIds)
      : Promise.resolve({ data: [], error: null }),
    segmentIds.length > 0
      ? supabase
          .from("source_segments")
          .select("id, source_id, segment_index, speaker, redacted_content")
          .eq("org_id", orgId)
          .in("source_id", sourceIds)
          .in("id", segmentIds)
      : Promise.resolve({ data: [], error: null }),
    visibleEvidenceIds.length > 0
      ? supabase
          .from("evidence_entities")
          .select("id, evidence_id, entity_type, label, relationship, person_id, company_id, competitor_id")
          .eq("org_id", orgId)
          .eq("project_id", projectId)
          .in("evidence_id", visibleEvidenceIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (sourcesResult.error) throw new Error("Failed to load problem sources");
  if (segmentsResult.error) throw new Error("Failed to load problem segments");
  if (entitiesResult.error) throw new Error("Failed to load problem entities");

  const sources = (sourcesResult.data ?? []) as Array<{
    id: string;
    title: string;
    type: string;
  }>;
  const segments = (segmentsResult.data ?? []) as Array<{
    id: string;
    source_id: string;
    segment_index: number | null;
    speaker: string | null;
    redacted_content: string | null;
  }>;
  const entities = (entitiesResult.data ?? []) as Array<{
    id: string;
    evidence_id: string;
    entity_type: string;
    label: string;
    relationship: string | null;
    person_id: string | null;
    company_id: string | null;
    competitor_id: string | null;
  }>;
  const personIds = unique(entities.map((entity) => entity.person_id));
  const companyIds = unique(entities.map((entity) => entity.company_id));
  const competitorIds = unique(entities.map((entity) => entity.competitor_id));

  const [peopleResult, companiesResult, competitorsResult] = await Promise.all([
    personIds.length > 0
      ? supabase.from("people").select("id, name").eq("org_id", orgId).in("id", personIds)
      : Promise.resolve({ data: [], error: null }),
    companyIds.length > 0
      ? supabase.from("companies").select("id, name").eq("org_id", orgId).in("id", companyIds)
      : Promise.resolve({ data: [], error: null }),
    competitorIds.length > 0
      ? supabase.from("competitors").select("id, name").eq("org_id", orgId).in("id", competitorIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (peopleResult.error) throw new Error("Failed to load people context");
  if (companiesResult.error) throw new Error("Failed to load company context");
  if (competitorsResult.error) throw new Error("Failed to load competitor context");

  const sourceById = new Map(sources.map((source) => [source.id, source]));
  const segmentById = new Map(segments.map((segment) => [segment.id, segment]));
  const evidenceById = new Map(relatedEvidence.map((row) => [row.id, row]));
  const themeById = new Map(themes.map((theme) => [theme.id, theme]));
  const topicById = new Map(topics.map((topic) => [topic.id, topic]));
  const peopleById = new Map(((peopleResult.data ?? []) as Array<{ id: string; name: string }>).map((person) => [person.id, person.name]));
  const companiesById = new Map(((companiesResult.data ?? []) as Array<{ id: string; name: string }>).map((company) => [company.id, company.name]));
  const competitorsById = new Map(((competitorsResult.data ?? []) as Array<{ id: string; name: string }>).map((competitor) => [competitor.id, competitor.name]));

  return {
    problem: {
      ...problem,
      source_evidence_ids: visibleEvidenceIds,
      source_theme_ids: themeIds,
    },
    themes: visibleThemeLinks
      .map((link) => {
        const theme = themeById.get(link.theme_id);
        if (!theme) return null;
        return {
          id: theme.id,
          label: theme.label,
          description: theme.description,
          evidence_count: theme.evidence_count,
          central_concept: theme.central_concept,
          interpretation: theme.interpretation,
          relationship: link.relationship,
          rationale: link.rationale,
          review_state: link.review_state,
          source: link.source,
          agent_run_id: link.agent_run_id,
        };
      })
      .filter((theme): theme is ProblemDetail["themes"][number] => Boolean(theme)),
    evidence: visibleEvidenceLinksForDisplay
      .map((link) => {
        const row = evidenceById.get(link.evidence_id);
        if (!row) return null;
        const source = sourceById.get(row.source_id) ?? null;
        const segment = row.segment_id ? segmentById.get(row.segment_id) ?? null : null;
        const metadata = metadataObject(row.metadata);
        return {
          id: row.id,
          source_id: row.source_id,
          segment_id: row.segment_id,
          content: row.content,
          summary: row.summary,
          trust_scope: row.trust_scope,
          classification: row.classification,
          sentiment: row.sentiment,
          topics: asStringArray(row.themes),
          source_title: source?.title ?? null,
          source_type: source?.type ?? null,
          segment_speaker: segment?.speaker ?? null,
          segment_index: segment?.segment_index ?? null,
          anchor_method: typeof metadata.anchor_method === "string" ? metadata.anchor_method : null,
          relationship: link.relationship,
          rationale: link.rationale,
          review_state: link.review_state,
          confidence: numericConfidence(link.confidence),
          source: link.source,
          agent_run_id: link.agent_run_id,
          created_at: row.created_at,
        };
      })
      .filter((row): row is ProblemDetail["evidence"][number] => Boolean(row)),
    topics: visibleTopicLinks
      .map((link) => {
        const topic = topicById.get(link.topic_id);
        if (!topic) return null;
        return {
          id: topic.id,
          label: topic.label,
          relationship: link.relationship,
          rationale: link.rationale,
          review_state: link.review_state,
          source: link.source,
          agent_run_id: link.agent_run_id,
        };
      })
      .filter((topic): topic is ProblemDetail["topics"][number] => Boolean(topic)),
    entities: entities.map((entity) => ({
      evidence_id: entity.evidence_id,
      entity_type: entity.entity_type,
      label:
        (entity.person_id && peopleById.get(entity.person_id)) ||
        (entity.company_id && companiesById.get(entity.company_id)) ||
        (entity.competitor_id && competitorsById.get(entity.competitor_id)) ||
        entity.label,
      relationship: entity.relationship,
    })),
    removed_evidence_count: allEvidenceLinks.length - visibleEvidenceLinksForDisplay.length,
    evidence_provenance_state: provenanceState(
      visibleEvidenceLinksForDisplay.map((link) => link.relationship)
    ),
    theme_provenance_state: provenanceState(visibleThemeLinks.map((link) => link.relationship)),
  };
}

export default async function ProblemsPage({ params, searchParams }: Props) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const project = await getProjectForUser<{
    id: string;
    org_id: string;
    name: string;
    problems_discovered_at: string | null;
  }>(
    user.id,
    params.projectId,
    "id, org_id, name, problems_discovered_at"
  );

  if (!project) notFound();

  const [{ data }, { count: sourcesCount }, { count: evidenceCount }] = await Promise.all([
    supabase
      .from("problems")
      .select("id, title, description, severity, status, created_at")
      .eq("org_id", project.org_id)
      .eq("project_id", project.id)
      .order("severity", { ascending: true })
      .order("created_at", { ascending: false }),
    supabase
      .from("sources")
      .select("*", { count: "exact", head: true })
      .eq("org_id", project.org_id)
      .eq("project_id", project.id),
    supabase
      .from("evidence")
      .select("*", { count: "exact", head: true })
      .eq("org_id", project.org_id)
      .eq("project_id", project.id),
  ]);

  const problems = sortProblems(
    await hydrateProblemRowsWithTypedLinks({
      supabase,
      orgId: project.org_id,
      projectId: project.id,
      rows: (data ?? []) as ProblemListRow[],
    })
  );
  const selectedProblemId = isUuid(searchParams?.problem) ? searchParams?.problem : null;
  const selectedProblem = selectedProblemId
    ? problems.find((problem) => problem.id === selectedProblemId) ?? null
    : null;
  let selectedProblemDetail: ProblemDetail | null = null;
  let selectedProblemError: string | null = null;

  if (selectedProblemId) {
    if (selectedProblem) {
      try {
        selectedProblemDetail = await getProblemDetail({
          supabase,
          orgId: project.org_id,
          projectId: project.id,
          problem: selectedProblem,
        });
      } catch {
        selectedProblemError = "We could not load this problem. Try again.";
      }
    } else {
      selectedProblemError = "We could not load this problem. Try again.";
    }
  }

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-6">
        <div className="mb-2 text-xs font-medium uppercase tracking-wide text-[var(--ink-faint)]">
          {project.name}
        </div>
        <h1 className="text-2xl font-semibold text-[var(--ink)]">Problems</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--ink-2)]">
          Surfaced from synthesised evidence.
        </p>
      </div>

      <PipelineRail
        projectId={project.id}
        sourcesCount={sourcesCount ?? 0}
        evidenceCount={evidenceCount ?? 0}
        problemCount={problems.length}
      />

      {!project.problems_discovered_at ? (
        <div className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-12 text-center text-sm text-[var(--ink-2)]">
          No problems discovered yet. Add sources, trust evidence, and run synthesis to surface problems automatically.
        </div>
      ) : (
        <ProblemsList
          problems={problems}
          projectId={project.id}
          selectedProblemId={selectedProblemId}
          selectedProblemDetail={selectedProblemDetail}
          selectedProblemError={selectedProblemError}
        />
      )}
    </div>
  );
}
