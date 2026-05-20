// POST /api/ingest/retry
// Re-fires ingest events for jobs stuck in 'pending' status.
// Useful when sources were submitted before Inngest was connected.
import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { getProjectForUser } from "@/lib/auth/org";
import { inngest } from "@/lib/inngest/client";
import { z } from "zod";

const RetrySchema = z.object({
  project_id: z.string().uuid(),
});

type RetryJob = {
  id: string;
  source_id: string;
};

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const parsed = RetrySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { project_id } = parsed.data;

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

  // Find all pending jobs for this project
  const { data: stuckJobs, error } = await service
    .from("ingest_jobs")
    .select("id, source_id")
    .eq("org_id", org_id)
    .eq("status", "pending");

  if (error) {
    return NextResponse.json({ error: "Failed to fetch stuck jobs" }, { status: 500 });
  }

  if (!stuckJobs || stuckJobs.length === 0) {
    return NextResponse.json({ retried: 0, message: "No stuck jobs found" });
  }

  // Re-fire ingest event for each stuck job
  const jobs = (stuckJobs ?? []) as RetryJob[];

  const events = jobs.map((job) => ({
    name: "source/ingest.requested" as const,
    data: {
      org_id,
      project_id,
      source_id: job.source_id,
      job_id: job.id,
    },
  }));

  await inngest.send(events);

  return NextResponse.json({
    retried: jobs.length,
    job_ids: jobs.map((job) => job.id),
  });
}
