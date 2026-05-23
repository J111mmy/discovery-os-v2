// POST /api/ingest
// Creates a source record and fires the ingest Inngest event
import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { getProjectForUser } from "@/lib/auth/org";
import { inngest } from "@/lib/inngest/client";
import { z } from "zod";

const IngestSchema = z.object({
  project_id: z.string().uuid(),
  type: z.enum([
    "transcript",
    "document",
    "note",
    "survey",
    "support_ticket",
    "other",
    "customer_interview",
    "sales_call",
    "usability_study",
    "internal_meeting",
  ]),
  title: z.string().min(1).max(255),
  description: z.string().optional(),
  raw_text: z.string().min(20, "Text must be at least 20 characters"),
  metadata: z.record(z.unknown()).optional(),
});

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const parsed = IngestSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { project_id, type, title, description, raw_text, metadata } = parsed.data;

  const project = await getProjectForUser<{ id: string; org_id: string }>(
    user.id,
    project_id,
    "id, org_id"
  );

  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const org_id = project.org_id;
  const service = createServiceClient();

  // Create source record — raw_text stored in metadata for Phase 1
  const { data: source, error: sourceError } = await service
    .from("sources")
    .insert({
      org_id,
      project_id,
      type,
      title,
      description,
      metadata: { ...(metadata ?? {}), raw_text },
      ingested_by: user.id,
      trust_scope: "pending",
    })
    .select("id")
    .single();

  if (sourceError || !source) {
    console.error("Failed to create source", sourceError);
    return NextResponse.json(
      { error: sourceError?.message ?? "Failed to create source" },
      { status: 500 }
    );
  }

  // Create ingest job record
  const { data: job, error: jobError } = await service
    .from("ingest_jobs")
    .insert({ org_id, source_id: source.id, status: "pending" })
    .select("id")
    .single();

  if (jobError || !job) {
    console.error("Failed to create ingest job", jobError);
    await service
      .from("sources")
      .delete()
      .eq("org_id", org_id)
      .eq("project_id", project_id)
      .eq("id", source.id);
    return NextResponse.json(
      { error: jobError?.message ?? "Failed to create job" },
      { status: 500 }
    );
  }

  // Fire Inngest event
  try {
    await inngest.send({
      name: "source/ingest.requested",
      data: { org_id, project_id, source_id: source.id, job_id: job.id },
    });
  } catch (inngestError) {
    const message = inngestError instanceof Error ? inngestError.message : String(inngestError);
    console.error("Inngest send failed:", message);
    // Clean up the orphaned records so the user can try again
    await service.from("ingest_jobs").delete().eq("org_id", org_id).eq("id", job.id);
    await service.from("sources").delete().eq("org_id", org_id).eq("id", source.id);
    return NextResponse.json(
      { error: `Ingest queuing failed: ${message}. Check that INNGEST_EVENT_KEY is set and Inngest is reachable.` },
      { status: 503 }
    );
  }

  return NextResponse.json({
    source_id: source.id,
    job_id: job.id,
    status: "queued",
  });
}
