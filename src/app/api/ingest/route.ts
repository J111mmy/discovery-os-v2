// POST /api/ingest
// Creates a source record and fires the ingest Inngest event
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getProjectForUser } from "@/lib/auth/org";
import { inngest } from "@/lib/inngest/client";
import { z } from "zod";

const IngestSchema = z.object({
  project_id: z.string().uuid(),
  type: z.enum(["transcript", "document", "note", "survey", "support_ticket", "other"]),
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

  // Create source record — raw_text stored in metadata for Phase 1
  const { data: source, error: sourceError } = await supabase
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
    return NextResponse.json({ error: "Failed to create source" }, { status: 500 });
  }

  // Create ingest job record
  const { data: job } = await supabase
    .from("ingest_jobs")
    .insert({ org_id, source_id: source.id, status: "pending" })
    .select("id")
    .single();

  if (!job) {
    return NextResponse.json({ error: "Failed to create job" }, { status: 500 });
  }

  // Fire Inngest event
  await inngest.send({
    name: "source/ingest.requested",
    data: { org_id, project_id, source_id: source.id, job_id: job.id },
  });

  return NextResponse.json({
    source_id: source.id,
    job_id: job.id,
    status: "queued",
  });
}
