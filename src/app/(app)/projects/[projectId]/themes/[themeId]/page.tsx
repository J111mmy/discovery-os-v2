import Link from "next/link";
import { getProjectForUser } from "@/lib/auth/org";
import { createClient } from "@/lib/supabase/server";
import { notFound, redirect } from "next/navigation";
import {
  SeverityPill,
  StatusPill,
  type ProblemSeverity,
  type ProblemStatus,
} from "../../problems/problems-list";
import {
  Chip,
  RelationshipEvidenceList,
  type AnalysisSource,
  type EvidenceItem,
  type EvidenceRelationship,
  type ProvenanceState,
  type ReviewState,
  type ThemeRelationship,
} from "../../shared-evidence";
import type { ThemeStatus } from "../themes-list";

interface Props {
  params: { projectId: string; themeId: string };
}

const themeStatusLabels: Record<ThemeStatus, string> = {
  draft: "Draft",
  reviewed: "Reviewed",
  accepted: "Accepted",
  archived: "Archived",
};

const themeStatusClasses: Record<ThemeStatus, string> = {
  draft: "border-[var(--line)] bg-[var(--surface-2)] text-[var(--ink-2)]",
  reviewed: "border-info/25 bg-info-bg text-info",
  accepted: "border-pos/25 bg-pos-bg text-pos",
  archived: "border-[var(--line)] bg-[var(--surface-2)] text-[var(--ink-faint)]",
};

const sourceLabels: Record<AnalysisSource, string> = {
  ai: "Identified by synthesis",
  human: "Identified by a teammate",
  imported: "Imported",
  system: "System-generated",
};

const themeRelationshipOrder: Record<ThemeRelationship, number> = {
  primary: 0,
  contributing: 1,
  provenance: 2,
};

const evidenceRelationshipOrder: Record<EvidenceRelationship, number> = {
  supporting: 0,
  contradicting: 1,
  example: 2,
  edge_case: 3,
  provenance: 4,
};

const visibleReviewStates = new Set<ReviewState>(["suggested", "accepted", "edited"]);

function isVisibleReviewState(value: ReviewState) {
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

function provenanceState(relationships: string[], provenanceRelationship = "provenance"): ProvenanceState {
  if (relationships.length === 0) return "empty";
  const hasProvenance = relationships.includes(provenanceRelationship);
  const hasAssessed = relationships.some((relationship) => relationship !== provenanceRelationship);
  if (hasProvenance && hasAssessed) return "mixed";
  if (hasProvenance) return "legacy_only";
  return "assessed";
}

function unique(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))));
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function metadataObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

type ThemeEvidenceLink = {
  evidence_id: string;
  relationship: EvidenceRelationship;
  rationale: string | null;
  review_state: ReviewState;
  confidence: number | string | null;
  source: AnalysisSource;
  agent_run_id: string | null;
  created_at: string;
};

type ThemeTopicLink = {
  topic_id: string;
  relationship: ThemeRelationship;
  rationale: string | null;
};

type ProblemThemeLink = {
  problem_id: string;
  relationship: ThemeRelationship;
};

export default async function ThemeDetailPage({ params }: Props) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const project = await getProjectForUser<{
    id: string;
    org_id: string;
    name: string;
  }>(user.id, params.projectId, "id, org_id, name");

  if (!project) notFound();

  const themeResult = await supabase
    .from("themes")
    .select("id, label, description, central_concept, interpretation, status, source, review_state, confidence, evidence_count, updated_at")
    .eq("org_id", project.org_id)
    .eq("project_id", project.id)
    .eq("id", params.themeId)
    .maybeSingle();

  if (themeResult.error) {
    return (
      <div className="mx-auto max-w-6xl">
        <div className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-12 text-center text-sm text-[var(--ink-2)]">
          We could not load this theme. Try again.{" "}
          <Link href={`/projects/${project.id}/themes`} className="text-[var(--accent)]">
            Back to themes
          </Link>
        </div>
      </div>
    );
  }

  const theme = themeResult.data as {
    id: string;
    label: string;
    description: string | null;
    central_concept: string | null;
    interpretation: string | null;
    status: ThemeStatus;
    source: AnalysisSource;
    review_state: ReviewState;
    confidence: "low" | "medium" | "high" | null;
    evidence_count: number;
    updated_at: string;
  } | null;

  if (!theme) notFound();

  const [themeEvidenceResult, themeTopicsResult, problemThemesResult] = await Promise.all([
    supabase
      .from("theme_evidence")
      .select("evidence_id, relationship, rationale, review_state, confidence, source, agent_run_id, created_at")
      .eq("org_id", project.org_id)
      .eq("project_id", project.id)
      .eq("theme_id", theme.id),
    supabase
      .from("theme_topics")
      .select("topic_id, relationship, rationale")
      .eq("org_id", project.org_id)
      .eq("project_id", project.id)
      .eq("theme_id", theme.id),
    supabase
      .from("problem_themes")
      .select("problem_id, relationship")
      .eq("org_id", project.org_id)
      .eq("project_id", project.id)
      .eq("theme_id", theme.id),
  ]);

  if (themeEvidenceResult.error || themeTopicsResult.error || problemThemesResult.error) {
    return (
      <div className="mx-auto max-w-6xl">
        <div className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-12 text-center text-sm text-[var(--ink-2)]">
          We could not load this theme. Try again.{" "}
          <Link href={`/projects/${project.id}/themes`} className="text-[var(--accent)]">
            Back to themes
          </Link>
        </div>
      </div>
    );
  }

  const allEvidenceLinks = (themeEvidenceResult.data ?? []) as ThemeEvidenceLink[];
  const topicLinks = (themeTopicsResult.data ?? []) as ThemeTopicLink[];
  const problemLinks = (problemThemesResult.data ?? []) as ProblemThemeLink[];

  const visibleEvidenceLinks = allEvidenceLinks
    .filter((link) => isVisibleReviewState(link.review_state))
    .sort((a, b) => {
      const relationshipDelta = evidenceRelationshipOrder[a.relationship] - evidenceRelationshipOrder[b.relationship];
      if (relationshipDelta !== 0) return relationshipDelta;
      const confidenceDelta = confidenceRank(b.confidence) - confidenceRank(a.confidence);
      if (confidenceDelta !== 0) return confidenceDelta;
      return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    });

  const sortedTopicLinks = [...topicLinks].sort(
    (a, b) => themeRelationshipOrder[a.relationship] - themeRelationshipOrder[b.relationship]
  );

  const evidenceIds = unique(visibleEvidenceLinks.map((link) => link.evidence_id));
  const topicIds = unique(topicLinks.map((link) => link.topic_id));
  const problemIds = unique(problemLinks.map((link) => link.problem_id));

  const [evidenceResult, topicsResult, problemsResult] = await Promise.all([
    evidenceIds.length > 0
      ? supabase
          .from("evidence")
          .select("id, source_id, segment_id, content, summary, trust_scope, themes, metadata, created_at, classification, sentiment")
          .eq("org_id", project.org_id)
          .eq("project_id", project.id)
          .in("id", evidenceIds)
      : Promise.resolve({ data: [], error: null }),
    topicIds.length > 0
      ? supabase.from("topics").select("id, label").eq("org_id", project.org_id).eq("project_id", project.id).in("id", topicIds)
      : Promise.resolve({ data: [], error: null }),
    problemIds.length > 0
      ? supabase
          .from("problems")
          .select("id, title, severity, status")
          .eq("org_id", project.org_id)
          .eq("project_id", project.id)
          .in("id", problemIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

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
  const topics = (topicsResult.data ?? []) as Array<{ id: string; label: string }>;
  const problems = (problemsResult.data ?? []) as Array<{
    id: string;
    title: string;
    severity: ProblemSeverity;
    status: ProblemStatus;
  }>;

  const sourceIds = unique(relatedEvidence.map((row) => row.source_id));
  const segmentIds = unique(relatedEvidence.map((row) => row.segment_id));

  const [sourcesResult, segmentsResult] = await Promise.all([
    sourceIds.length > 0
      ? supabase.from("sources").select("id, title, type").eq("org_id", project.org_id).eq("project_id", project.id).in("id", sourceIds)
      : Promise.resolve({ data: [], error: null }),
    segmentIds.length > 0
      ? supabase
          .from("source_segments")
          .select("id, source_id, segment_index, speaker, redacted_content")
          .eq("org_id", project.org_id)
          .in("source_id", sourceIds)
          .in("id", segmentIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  const sources = (sourcesResult.data ?? []) as Array<{ id: string; title: string; type: string }>;
  const segments = (segmentsResult.data ?? []) as Array<{
    id: string;
    source_id: string;
    segment_index: number | null;
    speaker: string | null;
    redacted_content: string | null;
  }>;

  const sourceById = new Map(sources.map((source) => [source.id, source]));
  const segmentById = new Map(segments.map((segment) => [segment.id, segment]));
  const evidenceById = new Map(relatedEvidence.map((row) => [row.id, row]));
  const topicById = new Map(topics.map((topic) => [topic.id, topic]));
  const problemById = new Map(problems.map((problem) => [problem.id, problem]));

  const evidence: EvidenceItem[] = visibleEvidenceLinks
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
    .filter((row): row is EvidenceItem => Boolean(row));

  const evidenceProvenanceState = provenanceState(visibleEvidenceLinks.map((link) => link.relationship));

  const themeTopics = sortedTopicLinks
    .map((link) => topicById.get(link.topic_id))
    .filter((topic): topic is { id: string; label: string } => Boolean(topic));

  const feedingProblems = problemLinks
    .map((link) => {
      const problem = problemById.get(link.problem_id);
      if (!problem) return null;
      return { ...problem, relationship: link.relationship };
    })
    .filter((row): row is { id: string; title: string; severity: ProblemSeverity; status: ProblemStatus; relationship: ThemeRelationship } => Boolean(row));

  const hasInterpretation = Boolean(theme.central_concept || theme.interpretation || theme.description);

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-6">
        <Link
          href={`/projects/${project.id}/themes`}
          className="mb-2 inline-block text-xs font-medium text-[var(--ink-2)] transition-colors hover:text-[var(--ink)]"
        >
          ← All themes
        </Link>
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold text-[var(--ink)]">{theme.label}</h1>
          <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${themeStatusClasses[theme.status]}`}>
            {themeStatusLabels[theme.status]}
          </span>
        </div>
        <p className="text-sm text-[var(--ink-2)]">
          {sourceLabels[theme.source]}
          {theme.confidence && ` · ${theme.confidence} confidence`}
        </p>
      </div>

      <div className="grid gap-6">
        <section>
          <h2 className="mb-3 text-sm font-semibold text-[var(--ink)]">Interpretation</h2>
          {hasInterpretation ? (
            <div className="grid gap-2">
              {theme.central_concept && (
                <p className="text-base font-medium leading-7 text-[var(--ink)]">{theme.central_concept}</p>
              )}
              {theme.interpretation && (
                <p className="text-sm leading-6 text-[var(--ink-2)]">{theme.interpretation}</p>
              )}
              {theme.description && (
                <p className="text-sm leading-6 text-[var(--ink-2)]">{theme.description}</p>
              )}
            </div>
          ) : (
            <p className="text-sm text-[var(--ink-2)]">No interpretation recorded for this theme yet.</p>
          )}
        </section>

        <section>
          <h2 className="mb-3 text-sm font-semibold text-[var(--ink)]">Evidence</h2>
          <RelationshipEvidenceList
            evidence={evidence}
            evidenceProvenanceState={evidenceProvenanceState}
            projectId={project.id}
            emptyLabel="No evidence linked to this theme yet."
            contradictingCopy="The agent also found evidence that complicates or pushes back on this theme, shown here for your review, not hidden."
          />
        </section>

        <section>
          <h2 className="mb-3 text-sm font-semibold text-[var(--ink)]">Topics</h2>
          {themeTopics.length === 0 ? (
            <p className="text-sm text-[var(--ink-2)]">No topics linked yet.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {themeTopics.map((topic) => (
                <Chip key={topic.id}>{topic.label}</Chip>
              ))}
            </div>
          )}
        </section>

        <section>
          <h2 className="mb-3 text-sm font-semibold text-[var(--ink)]">Problems this theme feeds</h2>
          {feedingProblems.length === 0 ? (
            <p className="text-sm text-[var(--ink-2)]">No problems reference this theme yet.</p>
          ) : (
            <div className="grid gap-2">
              {feedingProblems.map((problem) => (
                <Link
                  key={`${problem.id}:${problem.relationship}`}
                  href={`/projects/${project.id}/problems?problem=${problem.id}`}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--line)] bg-[var(--surface)] p-3 transition-colors hover:border-[var(--accent)]/40"
                >
                  <div className="min-w-0">
                    <div className="text-[11px] font-medium uppercase tracking-wide text-[var(--ink-faint)]">
                      {problem.relationship === "primary" ? "Primary theme" : "Contributing theme"}
                    </div>
                    <div className="mt-1 text-sm font-medium text-[var(--ink)]">{problem.title}</div>
                  </div>
                  <div className="flex flex-shrink-0 items-center gap-2">
                    <StatusPill status={problem.status} />
                    <SeverityPill severity={problem.severity} />
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
