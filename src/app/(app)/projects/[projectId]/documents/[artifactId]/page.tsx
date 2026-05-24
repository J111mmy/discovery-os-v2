import { getProjectForUser } from "@/lib/auth/org";
import { createClient } from "@/lib/supabase/server";
import type { ArtifactType } from "@/types/database";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArtifactViewer } from "./ArtifactViewer";

interface Props {
  params: { projectId: string; artifactId: string };
}

type ArtifactRow = {
  id: string;
  title: string;
  type: ArtifactType;
  content_md: string;
  created_at: string;
  word_count: number | null;
  metadata: Record<string, unknown> | null;
};

function dateLabel(value: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

export default async function ArtifactDetailPage({ params }: Props) {
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

  const { data: artifact } = await supabase
    .from("artifacts")
    .select("id, title, type, content_md, created_at, word_count, metadata")
    .eq("org_id", project.org_id)
    .eq("project_id", project.id)
    .eq("id", params.artifactId)
    .single();

  if (!artifact) notFound();

  const artifactRow = artifact as ArtifactRow;
  const rawSourceId = artifactRow.metadata?.source_id;
  const sourceId = typeof rawSourceId === "string" ? rawSourceId : null;

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-8">
        {sourceId ? (
          <Link
            href={`/projects/${project.id}/sources/${sourceId}`}
            className="mb-4 inline-flex text-sm font-medium text-[var(--ink-muted)] transition-colors hover:text-[var(--ink)]"
          >
            Back to source
          </Link>
        ) : (
          <Link
            href={`/projects/${project.id}/documents`}
            className="mb-4 inline-flex text-sm font-medium text-[var(--ink-muted)] transition-colors hover:text-[var(--ink)]"
          >
            All documents
          </Link>
        )}
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <span className="rounded-full border border-[var(--border)] bg-[var(--surface-2)] px-2 py-0.5 text-xs font-medium capitalize text-[var(--ink-muted)]">
            {artifactRow.type}
          </span>
          <span className="text-xs text-[var(--ink-faint)]">
            {dateLabel(artifactRow.created_at)}
          </span>
          {artifactRow.word_count !== null && (
            <span className="text-xs text-[var(--ink-faint)]">
              {artifactRow.word_count} words
            </span>
          )}
        </div>
        <h1 className="text-2xl font-semibold text-[var(--ink)]">{artifactRow.title}</h1>
      </div>

      <article className="rounded-xl border border-[var(--border)] bg-[var(--surface-1)] p-6">
        <ArtifactViewer
          artifactId={artifactRow.id}
          projectId={project.id}
          contentMd={artifactRow.content_md}
        />
      </article>
    </div>
  );
}
