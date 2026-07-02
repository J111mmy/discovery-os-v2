import { getProjectForUser } from "@/lib/auth/org";
import { getProjectOrgReadForUser, type OrgScopedRead } from "@/lib/auth/support-read";
import {
  hydrateEvidenceRecordsWithTypedTopics,
  loadVisibleProjectTopicGraph,
  VISIBLE_REVIEW_STATES,
} from "@/lib/research-ontology/evidence-topics";
import { createClient } from "@/lib/supabase/server";
import type { EvidenceRecord } from "@/types/database";
import { notFound, redirect } from "next/navigation";
import { EvidenceBrowser, type EvidenceLensData, type LensEvidencePreview, type LensTrustMix } from "./evidence-browser";

interface Props {
  params: { projectId: string };
  searchParams?: { theme?: string; theme_id?: string; topic_id?: string };
}

type EvidenceResult = {
  records: EvidenceRecord[];
  appliedFilterLabel?: string;
};

type ProjectReadClient = Awaited<ReturnType<typeof createClient>> | OrgScopedRead;

type LensEvidenceRow = Pick<
  EvidenceRecord,
  | "id"
  | "source_id"
  | "content"
  | "trust_scope"
  | "summary"
  | "themes"
  | "created_at"
>;

type LensSourceRow = {
  id: string;
  title: string | null;
  type: string | null;
};

type LensThemeRow = {
  id: string;
  label: string;
  description: string | null;
  evidence_count: number | null;
};

type LensEvidenceThemeRow = {
  evidence_id: string;
  theme_id: string;
};

type LensEvidenceTopicFilterRow = {
  evidence_id: string;
};

type LensProblemRow = {
  id: string;
  title: string;
  description: string | null;
  severity: string | null;
  status: string | null;
  source_evidence_ids: string[] | null;
  source_theme_ids: string[] | null;
  created_at: string;
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(value: string | undefined) {
  return Boolean(value && UUID_RE.test(value));
}

function emptyTrustMix(): LensTrustMix {
  return { pending: 0, trusted: 0, excluded: 0 };
}

function addToTrustMix(mix: LensTrustMix, trustScope: EvidenceRecord["trust_scope"]) {
  if (trustScope === "trusted" || trustScope === "pending" || trustScope === "excluded") {
    mix[trustScope] += 1;
  }
}

function previewForEvidence(
  evidence: LensEvidenceRow | undefined,
  sourceById: Map<string, LensSourceRow>
): LensEvidencePreview | null {
  if (!evidence) return null;
  const source = sourceById.get(evidence.source_id);

  return {
    id: evidence.id,
    content: evidence.content,
    summary: evidence.summary,
    trust_scope: evidence.trust_scope,
    source_title: source?.title ?? null,
    source_type: source?.type ?? null,
  };
}

function uniqueStrings(values: Array<string | null | undefined>) {
  return Array.from(
    new Set(
      values
        .map((value) => value?.trim())
        .filter((value): value is string => Boolean(value))
    )
  );
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.length > 0);
}

async function resolveThemeEvidenceFilter(
  supabase: ProjectReadClient,
  orgId: string,
  projectId: string,
  themeId: string | undefined
): Promise<{ label: string; evidenceIds: string[] } | null> {
  if (!isUuid(themeId)) return null;

  const { data: theme, error: themeError } = await supabase
    .from("themes")
    .select("id, label")
    .eq("org_id", orgId)
    .eq("project_id", projectId)
    .eq("id", themeId)
    .maybeSingle();

  if (themeError || !theme) return null;

  const { data: links, error: linksError } = await supabase
    .from("evidence_themes")
    .select("evidence_id")
    .eq("org_id", orgId)
    .eq("theme_id", theme.id);

  if (linksError) return null;

  return {
    label: theme.label as string,
    evidenceIds: Array.from(
      new Set(((links ?? []) as Array<{ evidence_id: string }>).map((link) => link.evidence_id))
    ),
  };
}

async function resolveTopicEvidenceFilter(
  supabase: ProjectReadClient,
  orgId: string,
  projectId: string,
  topicId: string | undefined
): Promise<{ label: string; evidenceIds: string[] } | null> {
  if (!isUuid(topicId)) return null;

  const { data: topic, error: topicError } = await supabase
    .from("topics")
    .select("id, label")
    .eq("org_id", orgId)
    .eq("project_id", projectId)
    .eq("id", topicId)
    .in("review_state", [...VISIBLE_REVIEW_STATES])
    .maybeSingle();

  if (topicError || !topic) return null;

  const { data: links, error: linksError } = await supabase
    .from("evidence_topics")
    .select("evidence_id")
    .eq("org_id", orgId)
    .eq("project_id", projectId)
    .eq("topic_id", topic.id)
    .in("review_state", [...VISIBLE_REVIEW_STATES]);

  if (linksError) return null;

  return {
    label: topic.label as string,
    evidenceIds: Array.from(
      new Set(((links ?? []) as LensEvidenceTopicFilterRow[]).map((link) => link.evidence_id))
    ),
  };
}

async function getEvidenceLensData(
  supabase: ProjectReadClient,
  orgId: string,
  projectId: string
): Promise<EvidenceLensData> {
  const { data: evidenceData } = await supabase
    .from("evidence")
    .select("id, source_id, content, trust_scope, summary, themes, created_at")
    .eq("org_id", orgId)
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(5000);

  const evidence: LensEvidenceRow[] = ((evidenceData ?? []) as LensEvidenceRow[]).map((row) => ({
    ...row,
    themes: [],
  }));
  const topicGraph = await loadVisibleProjectTopicGraph({ supabase, orgId, projectId });
  for (const row of evidence) {
    row.themes = topicGraph.labelsByEvidenceId.get(row.id) ?? [];
  }
  const evidenceById = new Map(evidence.map((row) => [row.id, row]));
  const sourceIds = Array.from(new Set(evidence.map((row) => row.source_id).filter(Boolean)));

  let sourceById = new Map<string, LensSourceRow>();
  if (sourceIds.length > 0) {
    const { data: sourcesData } = await supabase
      .from("sources")
      .select("id, title, type")
      .eq("org_id", orgId)
      .eq("project_id", projectId)
      .in("id", sourceIds);

    sourceById = new Map(((sourcesData ?? []) as LensSourceRow[]).map((source) => [source.id, source]));
  }

  const { data: themesData } = await supabase
    .from("themes")
    .select("id, label, description, evidence_count")
    .eq("org_id", orgId)
    .eq("project_id", projectId)
    .order("evidence_count", { ascending: false });

  const themes = (themesData ?? []) as LensThemeRow[];
  const themeIds = themes.map((theme) => theme.id);
  const themeById = new Map(themes.map((theme) => [theme.id, theme]));

  let evidenceThemes: LensEvidenceThemeRow[] = [];
  if (themeIds.length > 0) {
    const { data: evidenceThemesData } = await supabase
      .from("evidence_themes")
      .select("evidence_id, theme_id")
      .eq("org_id", orgId)
      .in("theme_id", themeIds);

    evidenceThemes = ((evidenceThemesData ?? []) as LensEvidenceThemeRow[]).filter((link) =>
      evidenceById.has(link.evidence_id)
    );
  }

  const { data: problemsData } = await supabase
    .from("problems")
    .select("id, title, description, severity, status, source_evidence_ids, source_theme_ids, created_at")
    .eq("org_id", orgId)
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });

  const problems = ((problemsData ?? []) as LensProblemRow[]).map((problem) => ({
    ...problem,
    source_evidence_ids: stringArray(problem.source_evidence_ids),
    source_theme_ids: stringArray(problem.source_theme_ids),
  }));

  const themeLinksByEvidence = new Map<string, Set<string>>();
  const evidenceIdsByTheme = new Map<string, Set<string>>();

  for (const link of evidenceThemes) {
    if (!themeLinksByEvidence.has(link.evidence_id)) {
      themeLinksByEvidence.set(link.evidence_id, new Set());
    }
    themeLinksByEvidence.get(link.evidence_id)!.add(link.theme_id);

    if (!evidenceIdsByTheme.has(link.theme_id)) {
      evidenceIdsByTheme.set(link.theme_id, new Set());
    }
    evidenceIdsByTheme.get(link.theme_id)!.add(link.evidence_id);
  }

  const problemEvidenceIds = new Map(
    problems.map((problem) => [problem.id, new Set(problem.source_evidence_ids ?? [])])
  );
  const problemThemeIds = new Map(
    problems.map((problem) => [problem.id, new Set(problem.source_theme_ids ?? [])])
  );

  const topicRows = topicGraph.topics
    .map((topic) => {
      const rows = Array.from(topicGraph.evidenceIdsByTopicId.get(topic.id) ?? [])
        .map((id) => evidenceById.get(id))
        .filter((row): row is LensEvidenceRow => Boolean(row))
        .filter((row) => row.trust_scope !== "excluded")
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      if (rows.length === 0) return null;

      const trustMix = emptyTrustMix();
      const sourceTypes = new Set<string>();
      const linkedThemes = new Set<string>();
      const linkedProblems = new Set<string>();

      for (const row of rows) {
        addToTrustMix(trustMix, row.trust_scope);

        const sourceType = sourceById.get(row.source_id)?.type;
        if (sourceType) sourceTypes.add(sourceType);

        for (const themeId of Array.from(themeLinksByEvidence.get(row.id) ?? [])) {
          linkedThemes.add(themeId);
        }

        for (const problem of problems) {
          if (problemEvidenceIds.get(problem.id)?.has(row.id)) {
            linkedProblems.add(problem.id);
          }
        }
      }

      return {
        id: topic.id,
        label: topic.label,
        support_count: rows.length,
        trust_mix: trustMix,
        source_types: Array.from(sourceTypes).sort(),
        linked_theme_count: linkedThemes.size,
        linked_problem_count: linkedProblems.size,
        recent_evidence: previewForEvidence(rows[0], sourceById),
      };
    })
    .filter((row): row is NonNullable<typeof row> => Boolean(row))
    .sort((a, b) => b.support_count - a.support_count || a.label.localeCompare(b.label))
    .slice(0, 80);

  const themeRows = themes
    .map((theme) => {
      const linkedEvidence = Array.from(evidenceIdsByTheme.get(theme.id) ?? [])
        .map((id) => evidenceById.get(id))
        .filter((row): row is LensEvidenceRow => Boolean(row));
      const relatedProblems = problems.filter((problem) => {
        if (problemThemeIds.get(problem.id)?.has(theme.id)) return true;
        return linkedEvidence.some((row) => problemEvidenceIds.get(problem.id)?.has(row.id));
      });

      return {
        id: theme.id,
        label: theme.label,
        description: theme.description,
        support_count: linkedEvidence.length || theme.evidence_count || 0,
        supporting_topic_count: new Set(linkedEvidence.flatMap((row) => uniqueStrings(row.themes))).size,
        related_problem_count: relatedProblems.length,
        recent_evidence: previewForEvidence(linkedEvidence[0], sourceById),
      };
    })
    .sort((a, b) => b.support_count - a.support_count || a.label.localeCompare(b.label))
    .slice(0, 80);

  const problemRows = problems
    .map((problem) => {
      const linkedEvidence = Array.from(problemEvidenceIds.get(problem.id) ?? [])
        .map((id) => evidenceById.get(id))
        .filter((row): row is LensEvidenceRow => Boolean(row));
      const linkedThemeIds = problemThemeIds.get(problem.id) ?? new Set<string>();

      return {
        id: problem.id,
        title: problem.title,
        description: problem.description,
        status: problem.status,
        severity: problem.severity,
        evidence_count: linkedEvidence.length,
        related_topic_count: new Set(linkedEvidence.flatMap((row) => uniqueStrings(row.themes))).size,
        related_theme_count: Array.from(linkedThemeIds).filter((id) => themeById.has(id)).length,
        recent_evidence: previewForEvidence(linkedEvidence[0], sourceById),
      };
    })
    .sort((a, b) => b.evidence_count - a.evidence_count || a.title.localeCompare(b.title))
    .slice(0, 80);

  const sourceRows = Array.from(
    evidence.reduce((acc, row) => {
      if (!acc.has(row.source_id)) {
        acc.set(row.source_id, {
          rows: [] as LensEvidenceRow[],
          trust_mix: emptyTrustMix(),
          topics: new Set<string>(),
        });
      }
      const entry = acc.get(row.source_id)!;
      entry.rows.push(row);
      addToTrustMix(entry.trust_mix, row.trust_scope);
      uniqueStrings(row.themes).forEach((label) => entry.topics.add(label));
      return acc;
    }, new Map<string, { rows: LensEvidenceRow[]; trust_mix: LensTrustMix; topics: Set<string> }>())
  )
    .map(([sourceId, entry]) => {
      const source = sourceById.get(sourceId);
      return {
        id: sourceId,
        title: source?.title ?? "Unknown source",
        type: source?.type ?? null,
        evidence_count: entry.rows.length,
        trust_mix: entry.trust_mix,
        topic_count: entry.topics.size,
        recent_evidence: previewForEvidence(entry.rows[0], sourceById),
      };
    })
    .sort((a, b) => b.evidence_count - a.evidence_count || a.title.localeCompare(b.title))
    .slice(0, 80);

  return {
    topics: topicRows,
    themes: themeRows,
    problems: problemRows,
    sources: sourceRows,
  };
}

async function getRecentEvidence(
  supabase: ProjectReadClient,
  orgId: string,
  projectId: string,
  trustScope: EvidenceRecord["trust_scope"] | "all" = "all",
  themeFilter?: string,
  themeIdFilter?: string,
  topicIdFilter?: string
): Promise<EvidenceResult> {
  const topicEvidenceFilter = await resolveTopicEvidenceFilter(
    supabase,
    orgId,
    projectId,
    topicIdFilter
  );
  const themeEvidenceFilter = await resolveThemeEvidenceFilter(
    supabase,
    orgId,
    projectId,
    themeIdFilter
  );

  let evidenceQuery = supabase
    .from("evidence")
    .select("id, org_id, project_id, source_id, segment_id, content, trust_scope, summary, classification, sentiment, themes, metadata, ai_trust_grade, ai_trust_reason, ai_graded_at, created_at")
    .eq("org_id", orgId)
    .eq("project_id", projectId);

  if (topicEvidenceFilter) {
    if (topicEvidenceFilter.evidenceIds.length === 0) {
      return { records: [], appliedFilterLabel: topicEvidenceFilter.label };
    }
    evidenceQuery = evidenceQuery.in("id", topicEvidenceFilter.evidenceIds);
  } else if (themeEvidenceFilter) {
    if (themeEvidenceFilter.evidenceIds.length === 0) {
      return { records: [], appliedFilterLabel: themeEvidenceFilter.label };
    }
    evidenceQuery = evidenceQuery.in("id", themeEvidenceFilter.evidenceIds);
  } else if (themeFilter) {
    // Deprecated compatibility path for old topic-label URLs. New Topic lens
    // links use typed topic IDs through evidence_topics.
    evidenceQuery = evidenceQuery.contains("themes", [themeFilter]);
  } else if (themeIdFilter || topicIdFilter) {
    evidenceQuery = evidenceQuery.eq("trust_scope", "pending");
  } else if (trustScope !== "all") {
    evidenceQuery = evidenceQuery.eq("trust_scope", trustScope);
  }

  const { data: evidence } = await evidenceQuery
    .order("created_at", { ascending: false })
    .limit(50);

  const records = await hydrateEvidenceRecordsWithTypedTopics({
    supabase,
    orgId,
    projectId,
    records: (evidence ?? []) as EvidenceRecord[],
  });
  const sourceIds = Array.from(new Set(records.map((record) => record.source_id)));
  const segmentIds = Array.from(
    new Set(records.map((record) => record.segment_id).filter(Boolean))
  ) as string[];

  if (sourceIds.length > 0) {
    const { data: sources } = await supabase
      .from("sources")
      .select("id, org_id, title, type")
      .eq("org_id", orgId)
      .eq("project_id", projectId)
      .in("id", sourceIds);

    const sourceById = new Map(
      ((sources ?? []) as Array<{ id: string; title: string; type: string }>).map((source) => [
        source.id,
        source,
      ])
    );

    records.forEach((record) => {
      const source = sourceById.get(record.source_id);
      if (source) {
        record.source_title = source.title;
        record.source_type = source.type as EvidenceRecord["source_type"];
      }
    });
  }

  if (segmentIds.length > 0) {
    const { data: segments } = await supabase
      .from("source_segments")
      .select("id, org_id, speaker, segment_index")
      .eq("org_id", orgId)
      .in("source_id", sourceIds)
      .in("id", segmentIds);

    const segmentById = new Map(
      ((segments ?? []) as Array<{
        id: string;
        speaker: string | null;
        segment_index: number;
      }>).map((segment) => [
        segment.id,
        segment,
      ])
    );

    records.forEach((record) => {
      const segment = record.segment_id ? segmentById.get(record.segment_id) : null;
      if (segment) {
        record.segment_speaker = segment.speaker;
        record.segment_index = segment.segment_index;
      }
    });
  }

  return {
    records,
    appliedFilterLabel: topicEvidenceFilter?.label ?? themeEvidenceFilter?.label,
  };
}

function researchContextIsEmpty(context: Record<string, unknown> | null) {
  if (!context) return true;

  return !Object.values(context).some((value) => {
    if (typeof value === "string") return value.trim().length > 0;
    if (Array.isArray(value)) {
      return value.some((item) => typeof item === "string" && item.trim().length > 0);
    }
    return false;
  });
}

export default async function EvidencePage({ params, searchParams }: Props) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const project = await getProjectForUser<{
    id: string;
    org_id: string;
    name: string;
    research_context: Record<string, unknown> | null;
  }>(
    user.id,
    params.projectId,
    "id, org_id, name, research_context"
  );

  if (!project) notFound();
  const read = await getProjectOrgReadForUser({
    userId: user.id,
    orgId: project.org_id,
    memberClient: supabase,
  });

  const themeFilter = searchParams?.theme ?? undefined;
  const themeIdFilter = searchParams?.theme_id ?? undefined;
  const topicIdFilter = searchParams?.topic_id ?? undefined;

  const [
    { count: pendingCount },
    { count: trustedCount },
    { count: excludedCount },
    evidenceResult,
    lensData,
    { data: internalPeople },
  ] = await Promise.all([
    read
      .from("evidence")
      .select("*", { count: "exact", head: true })
      .eq("project_id", project.id)
      .eq("trust_scope", "pending"),
    read
      .from("evidence")
      .select("*", { count: "exact", head: true })
      .eq("project_id", project.id)
      .eq("trust_scope", "trusted"),
    read
      .from("evidence")
      .select("*", { count: "exact", head: true })
      .eq("project_id", project.id)
      .eq("trust_scope", "excluded"),
    themeFilter || themeIdFilter || topicIdFilter
      ? getRecentEvidence(read, project.org_id, project.id, "all", themeFilter, themeIdFilter, topicIdFilter)
      : getRecentEvidence(read, project.org_id, project.id, "pending"),
    getEvidenceLensData(read, project.org_id, project.id),
    read
      .from("people")
      .select("name")
      .eq("affiliation", "internal"),
  ]);

  const evidenceCount = (pendingCount ?? 0) + (trustedCount ?? 0) + (excludedCount ?? 0);
  const records = evidenceResult.records;
  const appliedThemeFilter = evidenceResult.appliedFilterLabel ?? themeFilter;
  const filterKind = topicIdFilter || themeFilter ? "topic" : evidenceResult.appliedFilterLabel ? "theme" : undefined;

  const internalSpeakerNames = (internalPeople ?? [])
    .map((p: { name: string | null }) => (p.name ?? "").trim().toLowerCase())
    .filter(Boolean);

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="mb-2 text-xs font-medium uppercase tracking-wide text-[var(--ink-faint)]">
            Evidence
          </div>
          <h1 className="text-2xl font-semibold text-[var(--ink)]">Review evidence</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--ink-2)]">
            Search across the latest evidence, promote strong evidence to trusted, and keep weak evidence out of drafts.
          </p>
        </div>
      </div>

      <EvidenceBrowser
        projectId={project.id}
        initialRecords={records}
        pendingCount={pendingCount ?? 0}
        trustedCount={trustedCount ?? 0}
        excludedCount={excludedCount ?? 0}
        themeFilter={appliedThemeFilter}
        filterKind={filterKind}
        lensData={lensData}
        researchContextEmpty={researchContextIsEmpty(project.research_context)}
        internalSpeakerNames={internalSpeakerNames}
      />
    </div>
  );
}
