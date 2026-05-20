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
    .select("id, org_id, project_id, source_id, segment_id, content, trust_scope, summary, themes, metadata, created_at")
    .eq("org_id", orgId)
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(20);

  const records = (evidence ?? []) as EvidenceRecord[];
  const sourceIds = Array.from(new Set(records.map((record) => record.source_id)));

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

  return records;
}

export default async function EvidencePage({ params }: Props) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const project = await getProjectForUser<{ id: string; org_id: string; name: string }>(
    user.id,
    params.projectId,
    "id, org_id, name"
  );

  if (!project) notFound();

  const records = await getRecentEvidence(project.org_id, project.id);

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

      <EvidenceBrowser projectId={project.id} initialRecords={records} />
    </div>
  );
}
