import { getProjectForUser } from "@/lib/auth/org";
import { createClient } from "@/lib/supabase/server";
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

  let initialDraft = null;

  if (searchParams?.artifactId) {
    const { data: artifact } = await supabase
      .from("artifacts")
      .select("id, org_id, project_id, type, title, prompt, content_md, model_used, task_tier, metadata, verification_status, verification_run_at, verification_summary")
      .eq("org_id", project.org_id)
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
      <div className="mb-8">
        <div className="mb-2 text-xs font-medium uppercase tracking-wide text-[var(--ink-faint)]">
          Compose
        </div>
        <h1 className="text-2xl font-semibold text-[var(--ink)]">Draft from trusted evidence</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--ink-muted)]">
          Ask for a persona, PRD, opportunity brief, or GTM draft. The editor keeps the generated sections editable before you save.
        </p>
      </div>

      <ComposeEditor projectId={project.id} initialDraft={initialDraft} />
    </div>
  );
}
