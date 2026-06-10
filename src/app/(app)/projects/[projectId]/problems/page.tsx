import { getProjectForUser } from "@/lib/auth/org";
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

function evidenceCountLabel(count: number) {
  return `${count} related evidence`;
}

async function getProblemDetail(input: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  orgId: string;
  projectId: string;
  problem: ProblemRow;
}): Promise<ProblemDetail> {
  const { supabase, orgId, projectId, problem } = input;
  const evidenceIds = asStringArray(problem.source_evidence_ids);
  const themeIds = asStringArray(problem.source_theme_ids);

  const [themesResult, evidenceResult] = await Promise.all([
    themeIds.length > 0
      ? supabase
          .from("themes")
          .select("id, label, description, evidence_count")
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
  ]);

  if (themesResult.error) throw new Error("Failed to load problem themes");
  if (evidenceResult.error) throw new Error("Failed to load problem evidence");

  const relatedEvidence = (evidenceResult.data ?? []) as Array<{
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
    evidenceIds.length > 0
      ? supabase
          .from("evidence_entities")
          .select("id, evidence_id, entity_type, label, relationship, person_id, company_id, competitor_id")
          .eq("org_id", orgId)
          .eq("project_id", projectId)
          .in("evidence_id", evidenceIds)
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
  const peopleById = new Map(((peopleResult.data ?? []) as Array<{ id: string; name: string }>).map((person) => [person.id, person.name]));
  const companiesById = new Map(((companiesResult.data ?? []) as Array<{ id: string; name: string }>).map((company) => [company.id, company.name]));
  const competitorsById = new Map(((competitorsResult.data ?? []) as Array<{ id: string; name: string }>).map((competitor) => [competitor.id, competitor.name]));
  const evidenceOrder = new Map(evidenceIds.map((id, index) => [id, index]));

  return {
    problem: {
      ...problem,
      source_evidence_ids: evidenceIds,
      source_theme_ids: themeIds,
    },
    themes: ((themesResult.data ?? []) as ProblemDetail["themes"]).sort(
      (a, b) => themeIds.indexOf(a.id) - themeIds.indexOf(b.id)
    ),
    evidence: relatedEvidence
      .map((row) => {
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
          created_at: row.created_at,
        };
      })
      .sort((a, b) => (evidenceOrder.get(a.id) ?? 0) - (evidenceOrder.get(b.id) ?? 0)),
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
    unavailable_evidence_count: Math.max(0, evidenceIds.length - relatedEvidence.length),
    related_evidence_label: evidenceCountLabel(evidenceIds.length),
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
      .select("id, title, description, severity, status, source_theme_ids, source_evidence_ids, created_at")
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

  const problems = sortProblems((data ?? []) as ProblemRow[]);
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
