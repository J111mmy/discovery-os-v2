import { getProjectForUser } from "@/lib/auth/org";
import { createClient } from "@/lib/supabase/server";
import type { ArtifactType } from "@/types/database";
import { notFound, redirect } from "next/navigation";
import { ArtifactReader } from "./ArtifactReader";

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

  // Try to fetch content_html — only available after the content_html migration.
  // Graceful degradation: if the column doesn't exist yet, contentHtml stays null
  // and ArtifactReader falls back to the markdown viewer.
  let contentHtml: string | null = null;
  const { data: htmlRow, error: htmlError } = await supabase
    .from("artifacts")
    .select("content_html")
    .eq("id", params.artifactId)
    .maybeSingle();
  if (!htmlError && htmlRow) {
    const raw = (htmlRow as Record<string, unknown>).content_html;
    if (typeof raw === "string" && raw.length > 0) contentHtml = raw;
  }

  const backHref = sourceId
    ? `/projects/${project.id}/sources/${sourceId}`
    : `/projects/${project.id}/documents`;
  const backLabel = sourceId ? "Back to source" : "All documents";

  return (
    <ArtifactReader
      artifactId={artifactRow.id}
      projectId={project.id}
      contentHtml={contentHtml}
      contentMd={artifactRow.content_md}
      title={artifactRow.title}
      type={artifactRow.type}
      createdAt={artifactRow.created_at}
      wordCount={artifactRow.word_count}
      backHref={backHref}
      backLabel={backLabel}
    />
  );
}
