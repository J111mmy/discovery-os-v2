// POST /api/compose/draft
// Creates an artifact stub and fires the Inngest compose event.
// Returns immediately — client polls /api/artifacts/[id]/status for completion.
import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { requireActiveAccess } from "@/lib/auth/access";
import { getProjectForUser } from "@/lib/auth/org";
import { inngest } from "@/lib/inngest/client";
import { z } from "zod";

const DraftSchema = z.object({
  project_id: z.string().uuid(),
  prompt: z.string().min(5, "Prompt must be at least 5 characters"),
  limit: z.number().int().min(1).max(50).optional().default(18),
});

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const access = await requireActiveAccess({ id: user.id, email: user.email });
  if (!access.ok) {
    return NextResponse.json(
      { error: access.error, access_status: access.status },
      { status: 403 }
    );
  }

  const body = await req.json();
  const parsed = DraftSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { project_id, prompt, limit } = parsed.data;

  const project = await getProjectForUser<{ id: string; org_id: string; name: string }>(
    user.id,
    project_id,
    "id, org_id, name"
  );

  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const service = createServiceClient();

  // Create an artifact stub so the client has an ID to poll against immediately
  const { data: artifact, error: artifactError } = await service
    .from("artifacts")
    .insert({
      org_id: project.org_id,
      project_id,
      type: "other",
      title: "Drafting…",
      prompt,
      content_md: "",
      content_html: "",
      metadata: {
        compose_status: "pending",
        prompt,
      },
      created_by: user.id,
    })
    .select("id")
    .single();

  if (artifactError || !artifact) {
    return NextResponse.json(
      { error: artifactError?.message ?? "Failed to create artifact" },
      { status: 500 }
    );
  }

  // Fire the Inngest event — compose runs as a durable background function
  try {
    await inngest.send({
      name: "artifact/compose.requested",
      data: {
        org_id: project.org_id,
        project_id,
        artifact_id: artifact.id,
        prompt,
        limit,
        user_id: user.id,
      },
    });
  } catch (inngestError) {
    const message = inngestError instanceof Error ? inngestError.message : String(inngestError);
    // Clean up the stub so the user can try again
    await service.from("artifacts").delete().eq("org_id", project.org_id).eq("id", artifact.id);
    return NextResponse.json(
      { error: `Could not queue compose job: ${message}` },
      { status: 503 }
    );
  }

  return NextResponse.json({ artifact_id: artifact.id, status: "pending" });
}
