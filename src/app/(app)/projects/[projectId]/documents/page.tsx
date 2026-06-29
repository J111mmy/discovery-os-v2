import { getProjectForUser } from "@/lib/auth/org";
import { getProjectOrgReadForUser } from "@/lib/auth/support-read";
import { createClient } from "@/lib/supabase/server";
import type { ArtifactType, ArtifactVerificationStatus } from "@/types/database";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArtifactLibraryList, type ArtifactCardData } from "./artifact-library-list";

interface Props {
  params: { projectId: string };
}

type ArtifactRow = {
  id: string;
  type: ArtifactType;
  title: string;
  prompt: string;
  verification_status: ArtifactVerificationStatus;
  updated_at: string;
  metadata: Record<string, unknown> | null;
};

// citation_map is a { "1": evidence_id, "2": evidence_id, ... } map keyed by
// citation number as it appears in the artifact text. Same shape the
// /api/artifacts/[id]/citations route reads from metadata.
function citationMapEvidenceIds(metadata: Record<string, unknown> | null): string[] {
  const raw = metadata?.citation_map;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
  return Object.values(raw).filter((v): v is string => typeof v === "string" && v.trim().length > 0);
}

export default async function DocumentsPage({ params }: Props) {
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
  const read = await getProjectOrgReadForUser({
    userId: user.id,
    orgId: project.org_id,
    memberClient: supabase,
  });

  const { data } = await read
    .from("artifacts")
    .select("id, type, title, prompt, verification_status, updated_at, metadata")
    .eq("project_id", project.id)
    .order("updated_at", { ascending: false });

  const artifactRows = (data ?? []) as ArtifactRow[];

  // Bulk-resolve every cited evidence record's source_id in one query, so each
  // card can show a grounding count without an N+1 round trip.
  const evidenceIdsByArtifact = new Map(
    artifactRows.map((a) => [a.id, citationMapEvidenceIds(a.metadata)])
  );
  const allEvidenceIds = Array.from(new Set(Array.from(evidenceIdsByArtifact.values()).flat()));

  const sourceIdByEvidenceId = new Map<string, string>();
  if (allEvidenceIds.length > 0) {
    const { data } = await read.from("evidence").select("id, source_id").in("id", allEvidenceIds);
    const evidenceRows = (data ?? []) as Array<{ id: string; source_id: string | null }>;
    evidenceRows.forEach((row) => {
      if (row.source_id) sourceIdByEvidenceId.set(row.id, row.source_id);
    });
  }

  const artifacts: ArtifactCardData[] = artifactRows.map((a) => {
    const evidenceIds = evidenceIdsByArtifact.get(a.id) ?? [];
    const sourceIds = new Set(
      evidenceIds.map((id) => sourceIdByEvidenceId.get(id)).filter((id): id is string => Boolean(id))
    );
    return {
      id: a.id,
      type: a.type,
      title: a.title,
      prompt: a.prompt,
      verification_status: a.verification_status,
      updated_at: a.updated_at,
      citationCount: evidenceIds.length,
      sourceCount: sourceIds.size,
    };
  });

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="mb-2 text-xs font-medium uppercase tracking-wide text-[var(--ink-faint)]">
            Documents
          </div>
          <h1 className="text-2xl font-semibold text-[var(--ink)]">Artifact library</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--ink-2)]">
            Re-open generated drafts, continue editing, and keep the working document set tidy.
          </p>
        </div>
        <Link
          href={`/projects/${project.id}/compose`}
          className="inline-flex rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white transition-colors hover:opacity-90"
        >
          New draft
        </Link>
      </div>

      {artifacts.length === 0 ? (
        <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-12 text-center">
          <div className="text-sm font-medium text-[var(--ink)]">No documents yet</div>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[var(--ink-2)]">
            Draft from trusted evidence and saved artifacts will appear here.
          </p>
          <Link
            href={`/projects/${project.id}/compose`}
            className="mt-5 inline-flex rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white transition-colors hover:opacity-90"
          >
            Draft your first document →
          </Link>
        </div>
      ) : (
        <ArtifactLibraryList projectId={project.id} artifacts={artifacts} />
      )}
    </div>
  );
}
