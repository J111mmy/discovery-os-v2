import { getProjectForUser } from "@/lib/auth/org";
import { requireActiveAccess } from "@/lib/auth/access";
import { inngest } from "@/lib/inngest/client";
import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const VerifyArtifactSchema = z.object({
  project_id: z.string().uuid(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

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

  const parsed = VerifyArtifactSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const project = await getProjectForUser<{ id: string; org_id: string }>(
    user.id,
    parsed.data.project_id,
    "id, org_id"
  );

  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const { data: artifact, error: artifactError } = await supabase
    .from("artifacts")
    .update({
      verification_status: "unverified",
      verification_run_at: null,
      verification_summary: null,
      updated_at: new Date().toISOString(),
    })
    .eq("org_id", project.org_id)
    .eq("project_id", project.id)
    .eq("id", params.id)
    .select("id")
    .single();

  if (artifactError || !artifact) {
    return NextResponse.json({ error: "Artifact not found" }, { status: 404 });
  }

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
    const message = error instanceof Error ? error.message : "Unknown queue error";
    return NextResponse.json(
      { error: `Could not queue claim verification: ${message}` },
      { status: 503 }
    );
  }

  return NextResponse.json({ queued: true });
}
