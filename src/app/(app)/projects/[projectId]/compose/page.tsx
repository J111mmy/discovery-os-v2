import { getProjectForUser } from "@/lib/auth/org";
import { getProjectOrgReadForUser } from "@/lib/auth/support-read";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ComposeEditor } from "./compose-editor";

interface Props {
  params: { projectId: string };
  searchParams?: { artifactId?: string };
}

function parseMarkdownArtifact(markdown: string) {
  const lines = markdown.split("\n");
  const titleLine = lines.find((line) => line.startsWith("# "));
  const title = titleLine ? titleLine.replace(/^#\s+/, "").trim() : "Untitled";
  const sections: Array<{ heading: string; content: string }> = [];
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

export default async function ComposePage({ params, searchParams }: Props) {
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

  let initialDraft = null;

  if (searchParams?.artifactId) {
    const { data: artifact } = await read
      .from("artifacts")
      .select("id, org_id, project_id, type, title, prompt, content_md, model_used, task_tier, metadata, verification_status, verification_run_at, verification_summary")
      .eq("project_id", project.id)
      .eq("id", searchParams.artifactId)
      .single();

    if (artifact) {
      const parsed = parseMarkdownArtifact(artifact.content_md ?? "");
      const metadata = (artifact.metadata ?? {}) as { evidence_ids?: string[] };
      initialDraft = {
        artifactId: artifact.id,
        title: parsed.title || artifact.title,
        prompt: artifact.prompt,
        sections: parsed.sections,
        modelUsed: artifact.model_used,
        taskTier: artifact.task_tier,
        artifactType: artifact.type,
        evidenceIds: Array.isArray(metadata.evidence_ids) ? metadata.evidence_ids : [],
        verificationStatus: artifact.verification_status,
        verificationRunAt: artifact.verification_run_at,
        verificationSummary: artifact.verification_summary,
      };
    }
  }

  return (
    <div className="mx-auto max-w-6xl">
      {/* Studio chrome header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          marginBottom: 24,
          paddingBottom: 16,
          borderBottom: "1px solid var(--line)",
        }}
      >
        <Link
          href={`/projects/${project.id}/documents`}
          className="inline-flex items-center gap-1 text-xs font-medium text-[var(--ink-2)] no-underline transition-colors hover:text-[var(--ink)]"
        >
          <svg
            width="13"
            height="13"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M10 4L6 8l4 4" />
          </svg>
          Artifact library
        </Link>
        <span style={{ color: "var(--line)", userSelect: "none" }}>·</span>
        <span style={{ fontSize: 12, color: "var(--ink-faint)" }}>{project.name}</span>
        <div style={{ flex: 1 }} />
        <span
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: "var(--ink)",
            letterSpacing: "0.02em",
            textTransform: "uppercase",
          }}
        >
          Compose
        </span>
      </div>

      <ComposeEditor projectId={project.id} initialDraft={initialDraft} />
    </div>
  );
}
