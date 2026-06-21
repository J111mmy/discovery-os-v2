import { getProjectForUser } from "@/lib/auth/org";
import { getProjectOrgReadForUser } from "@/lib/auth/support-read";
import { ArtifactHtmlValidationError, sanitizeArtifactHtml } from "@/lib/sanitize/artifact-html";
import { markdownToSanitizedArtifactHtml } from "@/lib/sanitize/artifact-markdown";
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
  content_html: string | null;
  created_at: string;
  word_count: number | null;
  metadata: Record<string, unknown> | null;
};

function toSafeContentHtml(rawContentHtml: string | null, contentMd: string): string | null {
  const trimmedHtml = rawContentHtml?.trim();

  if (trimmedHtml) {
    try {
      return sanitizeArtifactHtml(trimmedHtml);
    } catch (error) {
      if (!(error instanceof ArtifactHtmlValidationError)) throw error;
      return null;
    }
  }

  try {
    return markdownToSanitizedArtifactHtml(contentMd);
  } catch (error) {
    if (!(error instanceof ArtifactHtmlValidationError)) throw error;
    return null;
  }
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
  const read = await getProjectOrgReadForUser({
    userId: user.id,
    orgId: project.org_id,
    memberClient: supabase,
  });

  const { data: artifact } = await read
    .from("artifacts")
    .select("id, title, type, content_md, content_html, created_at, word_count, metadata")
    .eq("project_id", project.id)
    .eq("id", params.artifactId)
    .single();

  if (!artifact) notFound();

  const artifactRow = artifact as ArtifactRow;
  // Always navigate back to Documents — source provenance lives in metadata but
  // the user may have come from anywhere; "All documents" is always correct.
  const backHref = `/projects/${project.id}/documents`;
  const backLabel = "All documents";
  const contentHtml = toSafeContentHtml(artifactRow.content_html, artifactRow.content_md);

  return (
    <>
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
    </>
  );
}
