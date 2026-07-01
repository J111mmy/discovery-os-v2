import { callLLM, type LLMTelemetryContext } from "@/lib/llm/client";
import { detectExpertPersona } from "@/lib/llm/persona";
import { NO_EM_DASH_OUTPUT_RULE } from "@/lib/llm/prompts/style";
import { neutralizeUntrustedSourceContentFence } from "@/lib/llm/prompts/untrusted-content";
import { createServiceClient } from "@/lib/supabase/server";
import { filterAdjacentProjectHintedEvidence } from "@/lib/evidence/adjacent-project";
import {
  filterInternalEvidence,
  loadInternalEvidenceGuardContext,
} from "@/lib/evidence/internal";
import type { ComposeDraftSection, TaskTier } from "@/types/database";

const VISIBLE_REVIEW_STATES = ["suggested", "accepted", "edited"] as const;
const VISIBLE_OPPORTUNITY_STATUSES = ["suggested", "accepted", "active"] as const;
const VISIBLE_PROBLEM_STATUSES = ["surfaced", "acknowledged", "active"] as const;
const MAX_OPPORTUNITIES_FOR_PROMPT = 8;
const MAX_PROBLEMS_FOR_PROMPT = 10;
const MAX_EVIDENCE_PER_OPPORTUNITY = 6;
export const COMPOSE_NEEDS_SYNTHESIS_CODE = "needs_synthesis";

export class ComposeNeedsSynthesisError extends Error {
  code = COMPOSE_NEEDS_SYNTHESIS_CODE;

  constructor() {
    super("Compose needs a synthesised project with traceable evidence before drafting.");
    this.name = "ComposeNeedsSynthesisError";
  }
}

const PROBLEM_SELECT = [
  "id",
  "title",
  "description",
  "statement",
  "status",
  "severity",
  "confidence",
  "who_affected",
  "what_is_hard",
  "why_it_matters",
  "current_workarounds",
  "current_tools",
].join(", ");

type SupabaseClient = ReturnType<typeof createServiceClient>;

type ProjectContext = {
  name: string;
  frame: string | null;
  gtm_context: string | null;
  operating_style: string | null;
};

type OpportunityRow = {
  id: string;
  title: string;
  description: string | null;
  how_might_we: string | null;
  status: string;
  confidence: string;
  review_state: string;
  updated_at: string;
};

type ProblemOpportunityLinkRow = {
  problem_id: string;
  opportunity_id: string;
  relationship: string;
  source: string;
  review_state: string;
  rationale: string | null;
};

type OpportunityEvidenceLinkRow = {
  opportunity_id: string;
  evidence_id: string;
  relationship: string;
  rationale: string | null;
};

type OpportunityThemeLinkRow = {
  opportunity_id: string;
  theme_id: string;
  relationship: string;
  rationale: string | null;
};

type ProblemEvidenceLinkRow = {
  problem_id: string;
  evidence_id: string;
  relationship: string;
  rationale: string | null;
  review_state: string;
};

type ProblemThemeLinkRow = {
  problem_id: string;
  theme_id: string;
  relationship: string;
  rationale: string | null;
  review_state: string;
};

type ThemeEvidenceLinkRow = {
  theme_id: string;
  evidence_id: string;
  relationship: string;
  rationale: string | null;
  review_state: string;
};

type ProblemRow = {
  id: string;
  title: string;
  description: string | null;
  statement: string | null;
  status: string | null;
  severity: string | null;
  confidence: string | null;
  who_affected: string | null;
  what_is_hard: string | null;
  why_it_matters: string | null;
  current_workarounds: string[] | null;
  current_tools: string[] | null;
};

type ThemeRow = {
  id: string;
  label: string;
  description: string | null;
  evidence_count: number | null;
  central_concept: string | null;
  interpretation: string | null;
  confidence: string | null;
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
  metadata: Record<string, unknown> | null;
  created_at: string;
  source_type?: string | null;
  segment_speaker?: string | null;
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
  raw_content: string;
};

type CitationTrace = {
  evidence_id: string;
  opportunity_ids: string[];
  problem_ids: string[];
  theme_ids: string[];
  source_id: string;
  source_title: string | null;
  segment_id: string | null;
  segment_speaker: string | null;
  segment_index: number | null;
  anchor_method: string | null;
};

type SelectedEvidence = EvidenceRow & {
  citation_number: number;
  opportunity_ids: string[];
  problem_ids: string[];
  theme_ids: string[];
  source: SourceRow | null;
  segment: SegmentRow | null;
  anchor_method: string | null;
};

type StructureContext = {
  project: ProjectContext;
  opportunities: OpportunityRow[];
  problems: ProblemRow[];
  themes: ThemeRow[];
  evidence: EvidenceRow[];
  sources: SourceRow[];
  segments: SegmentRow[];
  selectedEvidence: SelectedEvidence[];
  problemOpportunityLinks: ProblemOpportunityLinkRow[];
  opportunityEvidenceLinks: OpportunityEvidenceLinkRow[];
  opportunityThemeLinks: OpportunityThemeLinkRow[];
  problemEvidenceLinks: ProblemEvidenceLinkRow[];
  problemThemeLinks: ProblemThemeLinkRow[];
  themeEvidenceLinks: ThemeEvidenceLinkRow[];
};

export type ArtifactLinkPlan = {
  evidence: Array<{ evidence_id: string; relationship: "cites"; rationale: string }>;
  opportunities: Array<{ opportunity_id: string; relationship: "addresses"; rationale: string }>;
  problems: Array<{ problem_id: string; relationship: "addresses"; rationale: string }>;
  themes: Array<{ theme_id: string; relationship: "addresses"; rationale: string }>;
};

export type StructureComposeReport = {
  dry_run: boolean;
  input: {
    org_id: string;
    project_id: string;
    prompt: string;
    limit: number;
    model_used: string | null;
  };
  context_counts: {
    available_opportunities: number;
    available_problems: number;
    available_themes: number;
    available_evidence: number;
    selected_opportunities: number;
    selected_problems: number;
    selected_themes: number;
    selected_evidence: number;
  };
  output_counts: {
    section_count: number;
    citation_marker_count: number;
    citation_map_count: number;
    cited_evidence_count: number;
  };
  planned_writes: {
    artifact_update: number;
    artifact_evidence: number;
    artifact_opportunities: number;
    artifact_problems: number;
    artifact_themes: number;
    verification_queued: boolean;
  };
  mechanical_gates: {
    unmapped_citation_markers: number;
    citation_map_entries_without_selected_evidence: number;
    planned_artifact_links_outside_org_project: number;
    cited_evidence_without_opportunity_problem_theme_trace: number;
  };
  sample_citation_traces: Array<{
    citation: string;
    evidence_id: string;
    evidence_snippet: string;
    opportunities: string[];
    problems: string[];
    themes: string[];
    source: string | null;
    segment: {
      id: string | null;
      speaker: string | null;
      index: number | null;
      anchor_method: string | null;
      snippet: string | null;
    };
  }>;
};

export type StructureComposeDraft = {
  title: string;
  sections: ComposeDraftSection[];
  evidence_ids: string[];
  citation_map: Record<string, string>;
  model_used: string;
  task_tier: TaskTier;
  structure_trace: Record<string, CitationTrace>;
  link_plan: ArtifactLinkPlan;
  report: StructureComposeReport;
};

function asRows<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function unique(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))));
}

function truncate(value: string, max = 900) {
  const trimmed = value.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1)}…`;
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

function parseCitationNumbers(text: string) {
  const re = /\[(\d+)\]/g;
  const numbers: number[] = [];
  let match: RegExpExecArray | null;

  while ((match = re.exec(text)) !== null) {
    const n = Number.parseInt(match[1], 10);
    if (Number.isFinite(n)) numbers.push(n);
  }

  return numbers;
}

function parseCitationMap(text: string, evidence: SelectedEvidence[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const n of parseCitationNumbers(text)) {
    const record = evidence[n - 1];
    if (record && !map[String(n)]) map[String(n)] = record.id;
  }
  return map;
}

function stripNonNumericBracketRefs(text: string) {
  return text.replace(/\[(?!\d+\])([^\]\n]{1,120})\]/g, "").replace(/[ \t]{2,}/g, " ");
}

function parseMarkdownSections(markdown: string): {
  title: string;
  sections: ComposeDraftSection[];
} {
  const lines = markdown.split("\n");
  const titleLine = lines.find((line) => line.startsWith("# "));
  const title = titleLine ? titleLine.replace(/^#\s+/, "").trim() : "Untitled";
  const sections: ComposeDraftSection[] = [];
  let currentHeading = "";
  let currentContent: string[] = [];

  for (const line of lines) {
    if (line.startsWith("## ")) {
      if (currentHeading) {
        sections.push({ heading: currentHeading, content: currentContent.join("\n").trim() });
      }
      currentHeading = line.replace(/^##\s+/, "").trim();
      currentContent = [];
    } else if (!line.startsWith("# ")) {
      currentContent.push(line);
    }
  }

  if (currentHeading) {
    sections.push({ heading: currentHeading, content: currentContent.join("\n").trim() });
  }

  return { title, sections };
}

async function fetchStructureContext({
  supabase,
  org_id,
  project_id,
  limit,
}: {
  supabase: SupabaseClient;
  org_id: string;
  project_id: string;
  limit: number;
}): Promise<StructureContext> {
  const opportunityLimit = Math.min(MAX_OPPORTUNITIES_FOR_PROMPT, Math.max(1, limit));
  const [projectResult, opportunitiesResult] = await Promise.all([
    supabase
      .from("projects")
      .select("name, frame, gtm_context, operating_style")
      .eq("org_id", org_id)
      .eq("id", project_id)
      .single(),
    supabase
      .from("opportunities")
      .select("id, title, description, how_might_we, status, confidence, review_state, updated_at")
      .eq("org_id", org_id)
      .eq("project_id", project_id)
      .in("status", [...VISIBLE_OPPORTUNITY_STATUSES])
      .in("review_state", [...VISIBLE_REVIEW_STATES])
      .order("updated_at", { ascending: false })
      .limit(opportunityLimit),
  ]);

  if (projectResult.error || !projectResult.data) {
    throw new Error(`Failed to load project context: ${projectResult.error?.message ?? "missing project"}`);
  }
  if (opportunitiesResult.error) {
    throw new Error(`Failed to load opportunities: ${opportunitiesResult.error.message}`);
  }

  const opportunities = asRows<OpportunityRow>(opportunitiesResult.data);
  const opportunityIds = opportunities.map((opportunity) => opportunity.id);
  let problemOpportunityLinks: ProblemOpportunityLinkRow[] = [];
  let opportunityEvidenceLinks: OpportunityEvidenceLinkRow[] = [];
  let opportunityThemeLinks: OpportunityThemeLinkRow[] = [];
  let fallbackProblems: ProblemRow[] | null = null;
  let problemIds: string[] = [];

  if (opportunityIds.length > 0) {
    const [problemOpportunityResult, opportunityEvidenceResult, opportunityThemeResult] =
      await Promise.all([
        supabase
          .from("problem_opportunities")
          .select("problem_id, opportunity_id, relationship, source, review_state, rationale")
          .eq("org_id", org_id)
          .eq("project_id", project_id)
          .in("opportunity_id", opportunityIds)
          .in("review_state", [...VISIBLE_REVIEW_STATES]),
        supabase
          .from("opportunity_evidence")
          .select("opportunity_id, evidence_id, relationship, rationale")
          .eq("org_id", org_id)
          .eq("project_id", project_id)
          .in("opportunity_id", opportunityIds),
        supabase
          .from("opportunity_themes")
          .select("opportunity_id, theme_id, relationship, rationale")
          .eq("org_id", org_id)
          .eq("project_id", project_id)
          .in("opportunity_id", opportunityIds),
      ]);

    if (problemOpportunityResult.error) {
      throw new Error(`Failed to load opportunity problem links: ${problemOpportunityResult.error.message}`);
    }
    if (opportunityEvidenceResult.error) {
      throw new Error(`Failed to load opportunity evidence links: ${opportunityEvidenceResult.error.message}`);
    }
    if (opportunityThemeResult.error) {
      throw new Error(`Failed to load opportunity theme links: ${opportunityThemeResult.error.message}`);
    }

    problemOpportunityLinks = asRows<ProblemOpportunityLinkRow>(problemOpportunityResult.data);
    opportunityEvidenceLinks = asRows<OpportunityEvidenceLinkRow>(opportunityEvidenceResult.data);
    opportunityThemeLinks = asRows<OpportunityThemeLinkRow>(opportunityThemeResult.data);
    problemIds = unique(problemOpportunityLinks.map((link) => link.problem_id));
  } else {
    const fallbackProblemsResult = await supabase
      .from("problems")
      .select(PROBLEM_SELECT)
      .eq("org_id", org_id)
      .eq("project_id", project_id)
      .in("status", [...VISIBLE_PROBLEM_STATUSES])
      .order("updated_at", { ascending: false })
      .limit(Math.min(MAX_PROBLEMS_FOR_PROMPT, Math.max(1, limit)));

    if (fallbackProblemsResult.error) {
      throw new Error(`Failed to load problems for structure-driven compose: ${fallbackProblemsResult.error.message}`);
    }

    fallbackProblems = asRows<ProblemRow>(fallbackProblemsResult.data);
    problemIds = fallbackProblems.map((problem) => problem.id);
  }

  const [problemsResult, problemEvidenceResult, problemThemeResult] = await Promise.all([
    fallbackProblems
      ? Promise.resolve({ data: fallbackProblems, error: null })
      : problemIds.length > 0
      ? supabase
          .from("problems")
          .select(PROBLEM_SELECT)
          .eq("org_id", org_id)
          .eq("project_id", project_id)
          .in("id", problemIds)
      : Promise.resolve({ data: [], error: null }),
    problemIds.length > 0
      ? supabase
          .from("problem_evidence")
          .select("problem_id, evidence_id, relationship, rationale, review_state")
          .eq("org_id", org_id)
          .eq("project_id", project_id)
          .in("problem_id", problemIds)
          .in("review_state", [...VISIBLE_REVIEW_STATES])
      : Promise.resolve({ data: [], error: null }),
    problemIds.length > 0
      ? supabase
          .from("problem_themes")
          .select("problem_id, theme_id, relationship, rationale, review_state")
          .eq("org_id", org_id)
          .eq("project_id", project_id)
          .in("problem_id", problemIds)
          .in("review_state", [...VISIBLE_REVIEW_STATES])
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (problemsResult.error) {
    throw new Error(`Failed to load linked problems: ${problemsResult.error.message}`);
  }
  if (problemEvidenceResult.error) {
    throw new Error(`Failed to load problem evidence links: ${problemEvidenceResult.error.message}`);
  }
  if (problemThemeResult.error) {
    throw new Error(`Failed to load problem theme links: ${problemThemeResult.error.message}`);
  }

  const problems = asRows<ProblemRow>(problemsResult.data);
  const problemEvidenceLinks = asRows<ProblemEvidenceLinkRow>(problemEvidenceResult.data);
  const problemThemeLinks = asRows<ProblemThemeLinkRow>(problemThemeResult.data);
  const themeIds = unique([
    ...opportunityThemeLinks.map((link) => link.theme_id),
    ...problemThemeLinks.map((link) => link.theme_id),
  ]);

  const themeEvidenceResult =
    themeIds.length > 0
      ? await supabase
          .from("theme_evidence")
          .select("theme_id, evidence_id, relationship, rationale, review_state")
          .eq("org_id", org_id)
          .eq("project_id", project_id)
          .in("theme_id", themeIds)
          .in("review_state", [...VISIBLE_REVIEW_STATES])
      : { data: [], error: null };

  if (themeEvidenceResult.error) {
    throw new Error(`Failed to load theme evidence links: ${themeEvidenceResult.error.message}`);
  }

  const themeEvidenceLinks = asRows<ThemeEvidenceLinkRow>(themeEvidenceResult.data);
  const evidenceIds = unique([
    ...opportunityEvidenceLinks.map((link) => link.evidence_id),
    ...problemEvidenceLinks.map((link) => link.evidence_id),
    ...themeEvidenceLinks.map((link) => link.evidence_id),
  ]);

  const [themesResult, evidenceResult] = await Promise.all([
    themeIds.length > 0
      ? supabase
          .from("themes")
          .select("id, label, description, evidence_count, central_concept, interpretation, confidence")
          .eq("org_id", org_id)
          .eq("project_id", project_id)
          .in("id", themeIds)
      : Promise.resolve({ data: [], error: null }),
    evidenceIds.length > 0
      ? supabase
          .from("evidence")
          .select("id, source_id, segment_id, content, summary, trust_scope, classification, sentiment, metadata, created_at")
          .eq("org_id", org_id)
          .eq("project_id", project_id)
          .in("id", evidenceIds)
          .neq("trust_scope", "excluded")
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (themesResult.error) {
    throw new Error(`Failed to load linked themes: ${themesResult.error.message}`);
  }
  if (evidenceResult.error) {
    throw new Error(`Failed to load linked evidence: ${evidenceResult.error.message}`);
  }

  const themes = asRows<ThemeRow>(themesResult.data);
  const adjacentFilteredEvidence = filterAdjacentProjectHintedEvidence(
    asRows<EvidenceRow>(evidenceResult.data)
  );
  const sourceIds = unique(
    adjacentFilteredEvidence.map((row) => row.source_id).filter((id): id is string => Boolean(id))
  );
  const segmentIds = unique(
    adjacentFilteredEvidence.map((row) => row.segment_id).filter((id): id is string => Boolean(id))
  );
  const [sourcesResult, segmentsResult, internalGuardContext] = await Promise.all([
    sourceIds.length > 0
      ? supabase
          .from("sources")
          .select("id, title, type")
          .eq("org_id", org_id)
          .eq("project_id", project_id)
          .in("id", sourceIds)
      : Promise.resolve({ data: [], error: null }),
    segmentIds.length > 0
      ? supabase
          .from("source_segments")
          .select("id, source_id, segment_index, speaker, redacted_content, raw_content")
          .eq("org_id", org_id)
          .in("source_id", sourceIds)
          .in("id", segmentIds)
      : Promise.resolve({ data: [], error: null }),
    loadInternalEvidenceGuardContext({ supabase, org_id }),
  ]);

  if (sourcesResult.error) {
    throw new Error(`Failed to load sources: ${sourcesResult.error.message}`);
  }
  if (segmentsResult.error) {
    throw new Error(`Failed to load source segments: ${segmentsResult.error.message}`);
  }

  const sourceById = new Map(asRows<SourceRow>(sourcesResult.data).map((source) => [source.id, source]));
  const segmentById = new Map(asRows<SegmentRow>(segmentsResult.data).map((segment) => [segment.id, segment]));
  for (const row of adjacentFilteredEvidence) {
    row.source_type = sourceById.get(row.source_id)?.type ?? null;
    row.segment_speaker = row.segment_id ? segmentById.get(row.segment_id)?.speaker ?? null : null;
  }

  const evidence = filterInternalEvidence(adjacentFilteredEvidence, internalGuardContext);
  const visibleEvidenceIds = new Set(evidence.map((row) => row.id));
  const visibleOpportunityEvidenceLinks = opportunityEvidenceLinks.filter((link) =>
    visibleEvidenceIds.has(link.evidence_id)
  );
  const visibleProblemEvidenceLinks = problemEvidenceLinks.filter((link) =>
    visibleEvidenceIds.has(link.evidence_id)
  );
  const visibleThemeEvidenceLinks = themeEvidenceLinks.filter((link) =>
    visibleEvidenceIds.has(link.evidence_id)
  );
  const evidenceById = new Map(evidence.map((row) => [row.id, row]));
  const selectedEvidence = selectEvidenceForCompose({
    limit,
    opportunities,
    problemOpportunityLinks,
    opportunityEvidenceLinks: visibleOpportunityEvidenceLinks,
    opportunityThemeLinks,
    problemEvidenceLinks: visibleProblemEvidenceLinks,
    problemThemeLinks,
    themeEvidenceLinks: visibleThemeEvidenceLinks,
    evidenceById,
    sourceById,
    segmentById,
  });

  return {
    project: projectResult.data as ProjectContext,
    opportunities,
    problems,
    themes,
    evidence,
    sources: asRows<SourceRow>(sourcesResult.data),
    segments: asRows<SegmentRow>(segmentsResult.data),
    selectedEvidence,
    problemOpportunityLinks,
    opportunityEvidenceLinks: visibleOpportunityEvidenceLinks,
    opportunityThemeLinks,
    problemEvidenceLinks: visibleProblemEvidenceLinks,
    problemThemeLinks,
    themeEvidenceLinks: visibleThemeEvidenceLinks,
  };
}

function selectEvidenceForCompose({
  limit,
  opportunities,
  problemOpportunityLinks,
  opportunityEvidenceLinks,
  opportunityThemeLinks,
  problemEvidenceLinks,
  problemThemeLinks,
  themeEvidenceLinks,
  evidenceById,
  sourceById,
  segmentById,
}: {
  limit: number;
  opportunities: OpportunityRow[];
  problemOpportunityLinks: ProblemOpportunityLinkRow[];
  opportunityEvidenceLinks: OpportunityEvidenceLinkRow[];
  opportunityThemeLinks: OpportunityThemeLinkRow[];
  problemEvidenceLinks: ProblemEvidenceLinkRow[];
  problemThemeLinks: ProblemThemeLinkRow[];
  themeEvidenceLinks: ThemeEvidenceLinkRow[];
  evidenceById: Map<string, EvidenceRow>;
  sourceById: Map<string, SourceRow>;
  segmentById: Map<string, SegmentRow>;
}) {
  const maxEvidence = Math.max(1, Math.min(50, limit));
  const selected = new Map<string, Omit<SelectedEvidence, "citation_number">>();

  const addEvidence = (
    evidenceId: string,
    trace: { opportunityIds?: string[]; problemIds?: string[]; themeIds?: string[] }
  ) => {
    if (selected.size >= maxEvidence && !selected.has(evidenceId)) return;
    const evidence = evidenceById.get(evidenceId);
    if (!evidence) return;
    const existing = selected.get(evidence.id);
    const opportunity_ids = unique([
      ...(existing?.opportunity_ids ?? []),
      ...(trace.opportunityIds ?? []),
    ]);
    const problem_ids = unique([...(existing?.problem_ids ?? []), ...(trace.problemIds ?? [])]);
    const theme_ids = unique([...(existing?.theme_ids ?? []), ...(trace.themeIds ?? [])]);

    selected.set(evidence.id, {
      ...evidence,
      opportunity_ids,
      problem_ids,
      theme_ids,
      source: sourceById.get(evidence.source_id) ?? null,
      segment: evidence.segment_id ? segmentById.get(evidence.segment_id) ?? null : null,
      anchor_method: anchorMethodForEvidence(evidence),
    });
  };

  for (const opportunity of opportunities) {
    const problemIds = unique(
      problemOpportunityLinks
        .filter((link) => link.opportunity_id === opportunity.id)
        .map((link) => link.problem_id)
    );
    const directThemeIds = unique(
      opportunityThemeLinks
        .filter((link) => link.opportunity_id === opportunity.id)
        .map((link) => link.theme_id)
    );
    const problemThemeIds = unique(
      problemThemeLinks
        .filter((link) => problemIds.includes(link.problem_id))
        .map((link) => link.theme_id)
    );
    const themeIds = unique([...directThemeIds, ...problemThemeIds]);
    let perOpportunityCount = 0;

    const candidates = [
      ...opportunityEvidenceLinks
        .filter((link) => link.opportunity_id === opportunity.id)
        .map((link) => ({ evidenceId: link.evidence_id, problemIds, themeIds })),
      ...problemEvidenceLinks
        .filter((link) => problemIds.includes(link.problem_id))
        .map((link) => ({ evidenceId: link.evidence_id, problemIds: [link.problem_id], themeIds })),
      ...themeEvidenceLinks
        .filter((link) => themeIds.includes(link.theme_id))
        .map((link) => ({ evidenceId: link.evidence_id, problemIds, themeIds: [link.theme_id] })),
    ];

    for (const candidate of candidates) {
      if (perOpportunityCount >= MAX_EVIDENCE_PER_OPPORTUNITY) break;
      const before = selected.size;
      addEvidence(candidate.evidenceId, {
        opportunityIds: [opportunity.id],
        problemIds: candidate.problemIds,
        themeIds: candidate.themeIds,
      });
      if (selected.size > before || selected.has(candidate.evidenceId)) perOpportunityCount += 1;
      if (selected.size >= maxEvidence) break;
    }

    if (selected.size >= maxEvidence) break;
  }

  if (opportunities.length === 0) {
    for (const problemId of unique([
      ...problemEvidenceLinks.map((link) => link.problem_id),
      ...problemThemeLinks.map((link) => link.problem_id),
    ])) {
      const problemThemeIds = unique(
        problemThemeLinks
          .filter((link) => link.problem_id === problemId)
          .map((link) => link.theme_id)
      );
      let perProblemCount = 0;
      const candidates = [
        ...problemEvidenceLinks
          .filter((link) => link.problem_id === problemId)
          .map((link) => ({
            evidenceId: link.evidence_id,
            problemIds: [problemId],
            themeIds: problemThemeIds,
          })),
        ...themeEvidenceLinks
          .filter((link) => problemThemeIds.includes(link.theme_id))
          .map((link) => ({
            evidenceId: link.evidence_id,
            problemIds: [problemId],
            themeIds: [link.theme_id],
          })),
      ];

      for (const candidate of candidates) {
        if (perProblemCount >= MAX_EVIDENCE_PER_OPPORTUNITY) break;
        const before = selected.size;
        addEvidence(candidate.evidenceId, {
          problemIds: candidate.problemIds,
          themeIds: candidate.themeIds,
        });
        if (selected.size > before || selected.has(candidate.evidenceId)) perProblemCount += 1;
        if (selected.size >= maxEvidence) break;
      }

      if (selected.size >= maxEvidence) break;
    }
  }

  return Array.from(selected.values()).map((row, index) => ({
    ...row,
    citation_number: index + 1,
  }));
}

function idsToLabels<T extends { id: string }>(
  ids: string[],
  rows: T[],
  label: (row: T) => string
) {
  const byId = new Map(rows.map((row) => [row.id, row]));
  return ids.map((id) => byId.get(id)).filter((row): row is T => Boolean(row)).map(label);
}

function formatStructureGraph(context: StructureContext) {
  const problemById = new Map(context.problems.map((problem) => [problem.id, problem]));
  const themeById = new Map(context.themes.map((theme) => [theme.id, theme]));

  if (context.opportunities.length === 0) {
    const problemBlocks = context.problems.map((problem, problemIndex) => {
      const themeIds = unique(
        context.problemThemeLinks
          .filter((link) => link.problem_id === problem.id)
          .map((link) => link.theme_id)
      );
      const themeLines = themeIds
        .map((id) => themeById.get(id))
        .filter((theme): theme is ThemeRow => Boolean(theme))
        .map((theme, themeIndex) =>
          [
            `THEME_REF: T${themeIndex + 1}`,
            `LABEL: ${theme.label}`,
            theme.central_concept ? `CENTRAL_CONCEPT: ${theme.central_concept}` : null,
            theme.interpretation ? `INTERPRETATION: ${theme.interpretation}` : null,
            theme.description ? `DESCRIPTION: ${theme.description}` : null,
          ]
            .filter(Boolean)
            .join("\n")
        );

      return [
        `PROBLEM_REF: P${problemIndex + 1}`,
        `TITLE: ${problem.title}`,
        problem.statement ? `STATEMENT: ${problem.statement}` : null,
        problem.who_affected ? `WHO: ${problem.who_affected}` : null,
        problem.what_is_hard ? `WHAT_IS_HARD: ${problem.what_is_hard}` : null,
        problem.why_it_matters ? `WHY_IT_MATTERS: ${problem.why_it_matters}` : null,
        problem.current_tools?.length ? `CURRENT_TOOLS: ${problem.current_tools.join(", ")}` : null,
        problem.current_workarounds?.length
          ? `CURRENT_WORKAROUNDS: ${problem.current_workarounds.join(", ")}`
          : null,
        themeLines.length > 0 ? `LINKED_THEMES:\n${themeLines.join("\n\n")}` : null,
      ]
        .filter(Boolean)
        .join("\n");
    });

    return [
      "STRUCTURED DECISION GRAPH:",
      "No product opportunity records are available yet. Use this problem/theme/evidence graph to create a useful, evidence-cited artifact without pretending opportunity records exist.",
      problemBlocks.join("\n\n---\n\n"),
    ]
      .filter(Boolean)
      .join("\n");
  }

  const opportunityBlocks = context.opportunities.map((opportunity, opportunityIndex) => {
    const problemIds = unique(
      context.problemOpportunityLinks
        .filter((link) => link.opportunity_id === opportunity.id)
        .map((link) => link.problem_id)
    );
    const themeIds = unique(
      context.opportunityThemeLinks
        .filter((link) => link.opportunity_id === opportunity.id)
        .map((link) => link.theme_id)
    );
    const problemLines = problemIds
      .map((id) => problemById.get(id))
      .filter((problem): problem is ProblemRow => Boolean(problem))
      .map((problem, problemIndex) =>
        [
          `PROBLEM_REF: P${problemIndex + 1}`,
          `TITLE: ${problem.title}`,
          problem.statement ? `STATEMENT: ${problem.statement}` : null,
          problem.who_affected ? `WHO: ${problem.who_affected}` : null,
          problem.what_is_hard ? `WHAT_IS_HARD: ${problem.what_is_hard}` : null,
          problem.why_it_matters ? `WHY_IT_MATTERS: ${problem.why_it_matters}` : null,
          problem.current_tools?.length ? `CURRENT_TOOLS: ${problem.current_tools.join(", ")}` : null,
          problem.current_workarounds?.length
            ? `CURRENT_WORKAROUNDS: ${problem.current_workarounds.join(", ")}`
            : null,
        ]
          .filter(Boolean)
          .join("\n")
      );
    const themeLines = themeIds
      .map((id) => themeById.get(id))
      .filter((theme): theme is ThemeRow => Boolean(theme))
      .map((theme, themeIndex) =>
        [
          `THEME_REF: T${themeIndex + 1}`,
          `LABEL: ${theme.label}`,
          theme.central_concept ? `CENTRAL_CONCEPT: ${theme.central_concept}` : null,
          theme.interpretation ? `INTERPRETATION: ${theme.interpretation}` : null,
          theme.description ? `DESCRIPTION: ${theme.description}` : null,
        ]
          .filter(Boolean)
          .join("\n")
      );

    return [
      `OPPORTUNITY_REF: O${opportunityIndex + 1}`,
      `TITLE: ${opportunity.title}`,
      opportunity.how_might_we ? `HOW_MIGHT_WE: ${opportunity.how_might_we}` : null,
      opportunity.description ? `DESCRIPTION: ${opportunity.description}` : null,
      `CONFIDENCE: ${opportunity.confidence}`,
      problemLines.length > 0 ? `LINKED_PROBLEMS:\n${problemLines.join("\n\n")}` : null,
      themeLines.length > 0 ? `LINKED_THEMES:\n${themeLines.join("\n\n")}` : null,
    ]
      .filter(Boolean)
      .join("\n");
  });

  return `STRUCTURED DECISION GRAPH:\n${opportunityBlocks.join("\n\n---\n\n")}`;
}

function formatEvidenceBlock(context: StructureContext) {
  const opportunityLabels = (ids: string[]) =>
    idsToLabels(ids, context.opportunities, (row) => row.title);
  const problemLabels = (ids: string[]) =>
    idsToLabels(ids, context.problems, (row) => row.title);
  const themeLabels = (ids: string[]) =>
    idsToLabels(ids, context.themes, (row) => row.label);

  return context.selectedEvidence
    .map((evidence) => {
      const meta: string[] = [];
      if (evidence.classification) meta.push(evidence.classification);
      if (evidence.sentiment) meta.push(evidence.sentiment);
      if (evidence.source?.title) meta.push(`source: ${evidence.source.title}`);
      if (evidence.segment?.speaker) meta.push(`speaker: ${evidence.segment.speaker}`);
      if (evidence.anchor_method) meta.push(`anchor: ${evidence.anchor_method}`);
      const chain = [
        `Opportunities: ${opportunityLabels(evidence.opportunity_ids).join("; ") || "none"}`,
        `Problems: ${problemLabels(evidence.problem_ids).join("; ") || "none"}`,
        `Themes: ${themeLabels(evidence.theme_ids).join("; ") || "none"}`,
      ].join("\n");
      const content = neutralizeUntrustedSourceContentFence(evidence.content);
      return [
        `[${evidence.citation_number}]${meta.length > 0 ? ` [${meta.join(" | ")}]` : ""}`,
        chain,
        evidence.summary ? `Summary: ${truncate(evidence.summary, 260)}` : null,
        `Content:\n<untrusted_source_content>\n${truncate(content, 900)}\n</untrusted_source_content>`,
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n");
}

function buildSystemPrompt(
  persona: string,
  project: ProjectContext,
  evidenceCount: number,
  hasOpportunities: boolean
) {
  const parts = [
    `You are ${persona}.`,
    `You are creating a working GTM or strategy artifact for the "${project.name}" project.`,
  ];

  if (project.frame?.trim()) parts.push(`\n\nPROJECT FRAME:\n${project.frame.slice(0, 1200)}`);
  if (project.gtm_context?.trim()) {
    parts.push(`\n\nGO-TO-MARKET CONTEXT:\n${project.gtm_context.slice(0, 2000)}`);
  }
  if (project.operating_style?.trim()) {
    parts.push(`\n\nVOICE & OPERATING STYLE:\n${project.operating_style.slice(0, 1500)}`);
  }

  parts.push(`\n\nSTRUCTURE-GROUNDED COMPOSE RULES:
- You are writing from a structured decision graph, not a loose evidence search.
- ${hasOpportunities ? "Opportunities are the strategic recommendations and should shape what the artifact says to do next." : "No product opportunity records are available. Structure the artifact from problems, themes, and evidence, and recommend next steps from that evidence without inventing opportunity records."}
- Problems are the diagnosed pains. Themes are the synthesis layer. Evidence records are the only citeable factual source.
- You have ${evidenceCount} evidence records labelled [1], [2], [3] and so on.
- Every factual claim, customer observation, or specific finding must include an inline evidence citation like [3] or [1][4].
- Use the ${hasOpportunities ? "opportunity/problem/theme" : "problem/theme"} chain to decide structure, prioritisation, and implications.
- Never invent participants, quotes, numbers, competitors, tools, or outcomes.
- If evidence is thin, say so as an evidence gap.
- Paraphrase evidence. Do not copy long verbatim passages from source content.
- ${NO_EM_DASH_OUTPUT_RULE}`);

  parts.push(`\n\nOUTPUT FORMAT:
- Start immediately with # Title on line 1. No preamble.
- Use ## Section Heading for each section.
- Write focused, substantive prose. Short bullets are allowed only when they improve scanability.
- Land clearly on what should happen next${hasOpportunities ? ", using the opportunities as the recommendation layer" : ""}.
- End with a ## Open Questions section listing the top assumptions or evidence gaps.`);

  return parts.join(" ");
}

function buildStructureTrace(
  citationMap: Record<string, string>,
  selectedEvidence: SelectedEvidence[]
) {
  const byEvidenceId = new Map(selectedEvidence.map((row) => [row.id, row]));
  const trace: Record<string, CitationTrace> = {};
  for (const [citation, evidenceId] of Object.entries(citationMap)) {
    const evidence = byEvidenceId.get(evidenceId);
    if (!evidence) continue;
    trace[citation] = {
      evidence_id: evidence.id,
      opportunity_ids: evidence.opportunity_ids,
      problem_ids: evidence.problem_ids,
      theme_ids: evidence.theme_ids,
      source_id: evidence.source_id,
      source_title: evidence.source?.title ?? null,
      segment_id: evidence.segment_id,
      segment_speaker: evidence.segment?.speaker ?? null,
      segment_index: evidence.segment?.segment_index ?? null,
      anchor_method: evidence.anchor_method,
    };
  }
  return trace;
}

function buildLinkPlan(structureTrace: Record<string, CitationTrace>): ArtifactLinkPlan {
  const evidenceIds = unique(Object.values(structureTrace).map((trace) => trace.evidence_id));
  const opportunityIds = unique(Object.values(structureTrace).flatMap((trace) => trace.opportunity_ids));
  const problemIds = unique(Object.values(structureTrace).flatMap((trace) => trace.problem_ids));
  const themeIds = unique(Object.values(structureTrace).flatMap((trace) => trace.theme_ids));

  return {
    evidence: evidenceIds.map((evidence_id) => ({
      evidence_id,
      relationship: "cites",
      rationale: "Cited by a structure-driven composed artifact.",
    })),
    opportunities: opportunityIds.map((opportunity_id) => ({
      opportunity_id,
      relationship: "addresses",
      rationale: "Artifact recommendation is generated from this opportunity.",
    })),
    problems: problemIds.map((problem_id) => ({
      problem_id,
      relationship: "addresses",
      rationale: "Artifact addresses a problem linked through the selected opportunity/evidence chain.",
    })),
    themes: themeIds.map((theme_id) => ({
      theme_id,
      relationship: "addresses",
      rationale: "Artifact addresses a theme linked through the selected opportunity/problem/evidence chain.",
    })),
  };
}

function buildReport({
  dryRun,
  org_id,
  project_id,
  prompt,
  limit,
  modelUsed,
  context,
  sections,
  citationNumbers,
  citationMap,
  structureTrace,
  linkPlan,
}: {
  dryRun: boolean;
  org_id: string;
  project_id: string;
  prompt: string;
  limit: number;
  modelUsed: string | null;
  context: StructureContext;
  sections: ComposeDraftSection[];
  citationNumbers: number[];
  citationMap: Record<string, string>;
  structureTrace: Record<string, CitationTrace>;
  linkPlan: ArtifactLinkPlan;
}): StructureComposeReport {
  const selectedEvidenceIds = new Set(context.selectedEvidence.map((row) => row.id));
  const unmapped = citationNumbers.filter((n) => !context.selectedEvidence[n - 1]).length;
  const citationMapWithoutEvidence = Object.values(citationMap).filter(
    (evidenceId) => !selectedEvidenceIds.has(evidenceId)
  ).length;
  const untracedEvidence = Object.values(structureTrace).filter(
    (trace) =>
      trace.opportunity_ids.length === 0 &&
      trace.problem_ids.length === 0 &&
      trace.theme_ids.length === 0
  ).length;
  const selectedOpportunityIds = unique(
    Object.values(structureTrace).flatMap((trace) => trace.opportunity_ids)
  );
  const selectedProblemIds = unique(Object.values(structureTrace).flatMap((trace) => trace.problem_ids));
  const selectedThemeIds = unique(Object.values(structureTrace).flatMap((trace) => trace.theme_ids));
  const byEvidenceId = new Map(context.selectedEvidence.map((row) => [row.id, row]));
  const traceEntries = Object.entries(structureTrace);
  const sampleEntries: Array<[string, CitationTrace]> = [];
  const sampledOpportunityIds = new Set<string>();

  for (const entry of traceEntries) {
    const [, trace] = entry;
    const newOpportunityId = trace.opportunity_ids.find((id) => !sampledOpportunityIds.has(id));
    if (!newOpportunityId) continue;
    sampleEntries.push(entry);
    sampledOpportunityIds.add(newOpportunityId);
    if (sampleEntries.length >= 5) break;
  }

  for (const entry of traceEntries) {
    if (sampleEntries.length >= 5) break;
    if (sampleEntries.some(([citation]) => citation === entry[0])) continue;
    sampleEntries.push(entry);
  }

  return {
    dry_run: dryRun,
    input: {
      org_id,
      project_id,
      prompt,
      limit,
      model_used: modelUsed,
    },
    context_counts: {
      available_opportunities: context.opportunities.length,
      available_problems: context.problems.length,
      available_themes: context.themes.length,
      available_evidence: context.evidence.length,
      selected_opportunities: selectedOpportunityIds.length,
      selected_problems: selectedProblemIds.length,
      selected_themes: selectedThemeIds.length,
      selected_evidence: context.selectedEvidence.length,
    },
    output_counts: {
      section_count: sections.length,
      citation_marker_count: citationNumbers.length,
      citation_map_count: Object.keys(citationMap).length,
      cited_evidence_count: unique(Object.values(citationMap)).length,
    },
    planned_writes: {
      artifact_update: 1,
      artifact_evidence: linkPlan.evidence.length,
      artifact_opportunities: linkPlan.opportunities.length,
      artifact_problems: linkPlan.problems.length,
      artifact_themes: linkPlan.themes.length,
      verification_queued: false,
    },
    mechanical_gates: {
      unmapped_citation_markers: unmapped,
      citation_map_entries_without_selected_evidence: citationMapWithoutEvidence,
      planned_artifact_links_outside_org_project: 0,
      cited_evidence_without_opportunity_problem_theme_trace: untracedEvidence,
    },
    sample_citation_traces: sampleEntries.map(([citation, trace]) => {
        const evidence = byEvidenceId.get(trace.evidence_id);
        const segmentSnippet = evidence?.segment?.redacted_content ?? evidence?.segment?.raw_content ?? null;
        return {
          citation: `[${citation}]`,
          evidence_id: trace.evidence_id,
          evidence_snippet: evidence ? truncate(evidence.content, 220) : "",
          opportunities: idsToLabels(trace.opportunity_ids, context.opportunities, (row) => row.title),
          problems: idsToLabels(trace.problem_ids, context.problems, (row) => row.title),
          themes: idsToLabels(trace.theme_ids, context.themes, (row) => row.label),
          source: trace.source_title,
          segment: {
            id: trace.segment_id,
            speaker: trace.segment_speaker,
            index: trace.segment_index,
            anchor_method: trace.anchor_method,
            snippet: segmentSnippet ? truncate(segmentSnippet, 220) : null,
          },
        };
      }),
  };
}

export async function composeStructureDraft({
  org_id,
  project_id,
  prompt,
  limit = 18,
  dry_run = false,
  telemetry,
}: {
  org_id: string;
  project_id: string;
  prompt: string;
  limit?: number;
  dry_run?: boolean;
  telemetry?: LLMTelemetryContext;
}): Promise<StructureComposeDraft> {
  const supabase = createServiceClient();
  const context = await fetchStructureContext({ supabase, org_id, project_id, limit });
  if (context.selectedEvidence.length === 0) {
    throw new ComposeNeedsSynthesisError();
  }

  const persona = detectExpertPersona(prompt);
  const system = buildSystemPrompt(
    persona,
    context.project,
    context.selectedEvidence.length,
    context.opportunities.length > 0
  );
  const graphBlock = formatStructureGraph(context);
  const evidenceBlock = formatEvidenceBlock(context);
  const userMessage = `${prompt}\n\n---\n${graphBlock}\n\n---\nCITEABLE EVIDENCE RECORDS:\n\n${evidenceBlock}`;

  const result = await callLLM({
    tier: "premium",
    system,
    messages: [{ role: "user", content: userMessage }],
    timeoutMs: 240_000,
    telemetry,
  });

  const content = stripNonNumericBracketRefs(result.content);
  const { title, sections } = parseMarkdownSections(content);
  const citationNumbers = parseCitationNumbers(content);
  const citation_map = parseCitationMap(content, context.selectedEvidence);
  const structure_trace = buildStructureTrace(citation_map, context.selectedEvidence);
  const link_plan = buildLinkPlan(structure_trace);
  const report = buildReport({
    dryRun: dry_run,
    org_id,
    project_id,
    prompt,
    limit,
    modelUsed: result.model,
    context,
    sections,
    citationNumbers,
    citationMap: citation_map,
    structureTrace: structure_trace,
    linkPlan: link_plan,
  });

  return {
    title,
    sections,
    evidence_ids: context.selectedEvidence.map((row) => row.id),
    citation_map,
    model_used: result.model,
    task_tier: "premium",
    structure_trace,
    link_plan,
    report,
  };
}
