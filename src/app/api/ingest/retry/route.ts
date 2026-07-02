// POST /api/ingest/retry
// Re-fires ingest events for stuck jobs, or re-processes a specific source in place.
// Source-level calls clear derived evidence/segments before queuing a fresh ingest.
import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { requireActiveAccess } from "@/lib/auth/access";
import { getProjectForUser } from "@/lib/auth/org";
import { inngest } from "@/lib/inngest/client";
import { z } from "zod";

const RetrySchema = z.object({
  project_id: z.string().uuid(),
  source_id: z.string().uuid().optional(),
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

  const access = await requireActiveAccess({ id: user.id, email: user.email });
  if (!access.ok) {
    return NextResponse.json(
      { error: access.error, access_status: access.status },
      { status: 403 }
    );
  }

  const body = await req.json();
  const parsed = RetrySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { project_id, source_id } = parsed.data;

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
  let sourceIds: string[] = [];

  if (source_id) {
    const { data: source } = await service
      .from("sources")
      .select("id, org_id, project_id")
      .eq("org_id", org_id)
      .eq("project_id", project.id)
      .eq("id", source_id)
      .single();

    if (!source) {
      return NextResponse.json({ error: "Source not found" }, { status: 404 });
    }

    sourceIds = [source.id];

    const { error: evidenceDeleteError } = await service
      .from("evidence")
      .delete()
      .eq("org_id", org_id)
      .eq("project_id", project.id)
      .eq("source_id", source.id);

    if (evidenceDeleteError) {
      console.error("Failed to clear evidence before retry", evidenceDeleteError);
      return NextResponse.json(
        { error: evidenceDeleteError.message },
        { status: 500 }
      );
    }

    const { error: segmentDeleteError } = await service
      .from("source_segments")
      .delete()
      .eq("org_id", org_id)
      .eq("source_id", source.id);

    if (segmentDeleteError) {
      console.error("Failed to clear source segments before retry", segmentDeleteError);
      return NextResponse.json(
        { error: segmentDeleteError.message },
        { status: 500 }
      );
    }
  } else {
    const { data: sources, error: sourceError } = await service
      .from("sources")
      .select("id, org_id, project_id")
      .eq("org_id", org_id)
      .eq("project_id", project.id);

    if (sourceError) {
      return NextResponse.json({ error: "Failed to fetch sources" }, { status: 500 });
    }

    sourceIds = (sources ?? []).map((source: { id: string }) => source.id);
  }

  if (sourceIds.length === 0) {
    return NextResponse.json({ retried: 0, message: "No sources found" });
  }

  if (source_id) {
    const { data: job, error: jobError } = await service
      .from("ingest_jobs")
      .insert({ org_id, source_id: sourceIds[0], status: "pending" })
      .select("id, source_id")
      .single();

    if (jobError || !job) {
      console.error("Failed to create retry job", jobError);
      return NextResponse.json(
        { error: jobError?.message ?? "Failed to create retry job" },
        { status: 500 }
      );
    }

    await inngest.send({
      name: "source/ingest.requested",
      data: {
        org_id,
        project_id: project.id,
        source_id: job.source_id,
        job_id: job.id,
      },
    });

    return NextResponse.json({ retried: 1, job_ids: [job.id] });
  }

  // Find all pending jobs for this project
  const { data: stuckJobs, error } = await service
    .from("ingest_jobs")
    .select("id, source_id")
    .eq("org_id", org_id)
    .in("source_id", sourceIds)
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
