import { getUserOrgIds } from "@/lib/auth/org";
import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const StatusSchema = z.object({
  job_id: z.string().uuid(),
});

type IngestResult = {
  segments_created: number;
  evidence_created: number;
};

function normalizeResult(value: unknown): IngestResult | null {
  if (!value || typeof value !== "object") return null;

  const result = value as Partial<Record<keyof IngestResult, unknown>>;
  return {
    segments_created:
      typeof result.segments_created === "number" ? result.segments_created : 0,
    evidence_created:
      typeof result.evidence_created === "number" ? result.evidence_created : 0,
  };
}

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = StatusSchema.safeParse({
    job_id: req.nextUrl.searchParams.get("job_id"),
  });

  if (!parsed.success) {
    return NextResponse.json({ error: "Missing or invalid job_id" }, { status: 400 });
  }

  const orgIds = await getUserOrgIds(user.id);
  if (orgIds.length === 0) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  const { data: job, error } = await supabase
    .from("ingest_jobs")
    .select("id, org_id, source_id, status, result, error, started_at, completed_at, created_at")
    .eq("id", parsed.data.job_id)
    .in("org_id", orgIds)
    .single();

  if (error || !job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  return NextResponse.json({
    id: job.id,
    status: job.status,
    result: normalizeResult(job.result),
    error: job.error,
    source_id: job.source_id,
    started_at: job.started_at,
    completed_at: job.completed_at,
    created_at: job.created_at,
  });
}
