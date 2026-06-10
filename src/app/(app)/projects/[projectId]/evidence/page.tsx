import { getProjectForUser } from "@/lib/auth/org";
import { createClient } from "@/lib/supabase/server";
import type { EvidenceRecord } from "@/types/database";
import { notFound, redirect } from "next/navigation";
import { PipelineRail } from "../PipelineRail";
import { EvidenceBrowser } from "./evidence-browser";

interface Props {
  params: { projectId: string };
  searchParams?: { theme?: string; theme_id?: string };
}

type EvidenceResult = {
  records: EvidenceRecord[];
  appliedThemeLabel?: string;
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(value: string | undefined) {
  return Boolean(value && UUID_RE.test(value));
}

async function resolveThemeEvidenceFilter(
  supabase: Awaited<ReturnType<typeof createClient>>,
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
    evidenceIds: Array.from(new Set((links ?? []).map((link) => link.evidence_id as string))),
  };
}

async function getRecentEvidence(
  orgId: string,
  projectId: string,
  trustScope: EvidenceRecord["trust_scope"] | "all" = "all",
  themeFilter?: string,
  themeIdFilter?: string
): Promise<EvidenceResult> {
  const supabase = await createClient();
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

  if (themeEvidenceFilter) {
    if (themeEvidenceFilter.evidenceIds.length === 0) {
      return { records: [], appliedThemeLabel: themeEvidenceFilter.label };
    }
    evidenceQuery = evidenceQuery.in("id", themeEvidenceFilter.evidenceIds);
  } else if (themeFilter) {
    // Legacy topic/code filter — themes is a text[] column; contains = @> (subset)
    evidenceQuery = evidenceQuery.contains("themes", [themeFilter]);
  } else if (themeIdFilter) {
    evidenceQuery = evidenceQuery.eq("trust_scope", "pending");
  } else if (trustScope !== "all") {
    evidenceQuery = evidenceQuery.eq("trust_scope", trustScope);
  }

  const { data: evidence } = await evidenceQuery
    .order("created_at", { ascending: false })
    .limit(50);

  const records = (evidence ?? []) as EvidenceRecord[];
  const sourceIds = Array.from(new Set(records.map((record) => record.source_id)));
  const segmentIds = Array.from(
    new Set(records.map((record) => record.segment_id).filter(Boolean))
  ) as string[];

  if (sourceIds.length > 0) {
    const { data: sources } = await supabase
      .from("sources")
      .select("id, org_id, title, type")
      .eq("org_id", orgId)
      .in("id", sourceIds);

    const sourceById = new Map(
      (sources ?? []).map((source: { id: string; title: string; type: string }) => [
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
      .in("id", segmentIds);

    const segmentById = new Map(
      (segments ?? []).map((segment: { id: string; speaker: string | null; segment_index: number }) => [
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
    appliedThemeLabel: themeEvidenceFilter?.label,
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

  const themeFilter = searchParams?.theme ?? undefined;
  const themeIdFilter = searchParams?.theme_id ?? undefined;

  const [
    { count: pendingCount },
    { count: trustedCount },
    { count: excludedCount },
    evidenceResult,
    { count: sourcesCount },
    { count: problemCount },
    { data: internalPeople },
  ] = await Promise.all([
    supabase
      .from("evidence")
      .select("*", { count: "exact", head: true })
      .eq("org_id", project.org_id)
      .eq("project_id", project.id)
      .eq("trust_scope", "pending"),
    supabase
      .from("evidence")
      .select("*", { count: "exact", head: true })
      .eq("org_id", project.org_id)
      .eq("project_id", project.id)
      .eq("trust_scope", "trusted"),
    supabase
      .from("evidence")
      .select("*", { count: "exact", head: true })
      .eq("org_id", project.org_id)
      .eq("project_id", project.id)
      .eq("trust_scope", "excluded"),
    themeFilter || themeIdFilter
      ? getRecentEvidence(project.org_id, project.id, "all", themeFilter, themeIdFilter)
      : getRecentEvidence(project.org_id, project.id, "pending"),
    supabase
      .from("sources")
      .select("*", { count: "exact", head: true })
      .eq("org_id", project.org_id)
      .eq("project_id", project.id),
    supabase
      .from("problems")
      .select("*", { count: "exact", head: true })
      .eq("org_id", project.org_id)
      .eq("project_id", project.id),
    supabase
      .from("people")
      .select("display_name")
      .eq("org_id", project.org_id)
      .eq("affiliation", "internal"),
  ]);

  const evidenceCount = (pendingCount ?? 0) + (trustedCount ?? 0) + (excludedCount ?? 0);
  const records = evidenceResult.records;
  const appliedThemeFilter = evidenceResult.appliedThemeLabel ?? themeFilter;

  const internalSpeakerNames = (internalPeople ?? [])
    .map((p: { display_name: string | null }) => (p.display_name ?? "").trim().toLowerCase())
    .filter(Boolean);

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="mb-2 text-xs font-medium uppercase tracking-wide text-[var(--ink-faint)]">
            Evidence
          </div>
          <h1 className="text-2xl font-semibold text-[var(--ink)]">Review source-backed records</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--ink-2)]">
            Search across the latest evidence, promote strong records to trusted, and keep weak claims out of drafts.
          </p>
        </div>
      </div>

      <PipelineRail
        projectId={project.id}
        sourcesCount={sourcesCount ?? 0}
        evidenceCount={evidenceCount}
        problemCount={problemCount ?? 0}
      />

      <EvidenceBrowser
        projectId={project.id}
        initialRecords={records}
        pendingCount={pendingCount ?? 0}
        trustedCount={trustedCount ?? 0}
        excludedCount={excludedCount ?? 0}
        themeFilter={appliedThemeFilter}
        researchContextEmpty={researchContextIsEmpty(project.research_context)}
        internalSpeakerNames={internalSpeakerNames}
      />
    </div>
  );
}
