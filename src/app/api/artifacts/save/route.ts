import { getProjectForUser } from "@/lib/auth/org";
import { inngest } from "@/lib/inngest/client";
import { ArtifactHtmlValidationError } from "@/lib/sanitize/artifact-html";
import { markdownToSanitizedArtifactHtml } from "@/lib/sanitize/artifact-markdown";
import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const SaveArtifactSchema = z.object({
  artifact_id: z.string().uuid().optional().nullable(),
  project_id: z.string().uuid(),
  title: z.string().min(1).max(255),
  prompt: z.string().min(1),
  content_md: z.string().min(1),
  type: z
    .enum(["prd", "brief", "persona", "opportunity", "gtm", "interview_guide", "report", "other"])
    .optional()
    .default("other"),
  model_used: z.string().optional().nullable(),
  task_tier: z.enum(["cheap", "standard", "premium", "eval"]).optional().nullable(),
  metadata: z.record(z.unknown()).optional(),
});

function wordCount(markdown: string) {
  return markdown.trim().split(/\s+/).filter(Boolean).length;
}

function safeHtmlConversionError() {
  return NextResponse.json(
    { error: "Artifact content could not be converted to safe HTML." },
    { status: 422 }
  );
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = SaveArtifactSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const body = parsed.data;
  const project = await getProjectForUser<{ id: string; org_id: string }>(
    user.id,
    body.project_id,
    "id, org_id"
  );

  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  let version = 1;

  if (body.artifact_id) {
    const { data: existing } = await supabase
      .from("artifacts")
      .select("id, org_id, project_id, version")
      .eq("org_id", project.org_id)
      .eq("project_id", project.id)
      .eq("id", body.artifact_id)
      .single();

    if (!existing) {
      return NextResponse.json({ error: "Artifact not found" }, { status: 404 });
    }

    version = existing.version + 1;
  }

  let contentHtml: string;
  try {
    contentHtml = markdownToSanitizedArtifactHtml(body.content_md);
  } catch (error) {
    if (error instanceof ArtifactHtmlValidationError) {
      return safeHtmlConversionError();
    }
    throw error;
  }

  const payload = {
    ...(body.artifact_id ? { id: body.artifact_id } : {}),
    org_id: project.org_id,
    project_id: project.id,
    type: body.type,
    title: body.title,
    prompt: body.prompt,
    content_md: body.content_md,
    content_html: contentHtml,
    version,
    word_count: wordCount(body.content_md),
    model_used: body.model_used ?? null,
    task_tier: body.task_tier ?? null,
    metadata: body.metadata ?? {},
    verification_status: "unverified",
    verification_run_at: null,
    verification_summary: null,
    created_by: user.id,
  };

  const { data: artifact, error } = await supabase
    .from("artifacts")
    .upsert(payload, { onConflict: "id" })
    .select("id, org_id, project_id, title, version, updated_at")
    .eq("org_id", project.org_id)
    .eq("project_id", project.id)
    .single();

  if (error || !artifact) {
    return NextResponse.json({ error: error?.message ?? "Failed to save artifact" }, { status: 500 });
  }

  await supabase.from("artifact_versions").insert({
    artifact_id: artifact.id,
    org_id: project.org_id,
    version,
    content_md: body.content_md,
    content_html: contentHtml,
    saved_by: user.id,
  });

  let verificationQueued = true;

  try {
    await inngest.send({
      name: "artifact/claim.verification.requested",
      data: {
        org_id: project.org_id,
        project_id: project.id,
        artifact_id: artifact.id,
      },
    });
  } catch (error) {
    verificationQueued = false;
    console.error("Failed to queue claim verification", error);
  }

  return NextResponse.json({ artifact, verification_queued: verificationQueued });
}
