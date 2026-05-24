import { getProjectForUser } from "@/lib/auth/org";
import { createClient } from "@/lib/supabase/server";
import type { EvidenceRecord } from "@/types/database";
import { notFound, redirect } from "next/navigation";
import { EvidenceBrowser } from "./evidence-browser";

interface Props {
  params: { projectId: string };
}

async function getRecentEvidence(orgId: string, projectId: string): Promise<EvidenceRecord[]> {
  const supabase = await createClient();
  const { data: evidence } = await supabase
    .from("evidence")
    .select("id, org_id, project_id, source_id, segment_id, content, trust_scope, summary, classification, sentiment, themes, metadata, ai_trust_grade, ai_trust_reason, ai_graded_at, created_at")
    .eq("org_id", orgId)
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(20);

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

  return records;
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

export default async function EvidencePage({ params }: Props) {
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

  const [{ count: pendingCount }, { count: trustedCount }, { count: uncertainCount }, records] = await Promise.all([
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
      .eq("ai_trust_grade", "uncertain"),
    getRecentEvidence(project.org_id, project.id),
  ]);

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="mb-2 text-xs font-medium uppercase tracking-wide text-[var(--ink-faint)]">
            Evidence
          </div>
          <h1 className="text-2xl font-semibold text-[var(--ink)]">Review source-backed records</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--ink-muted)]">
            Search across the latest evidence, promote strong records to trusted, and keep weak claims out of drafts.
          </p>
        </div>
      </div>

      <EvidenceBrowser
        projectId={project.id}
        initialRecords={records}
        pendingCount={pendingCount ?? 0}
        trustedCount={trustedCount ?? 0}
        uncertainCount={uncertainCount ?? 0}
        researchContextEmpty={researchContextIsEmpty(project.research_context)}
      />
    </div>
  );
}
