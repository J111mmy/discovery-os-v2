import { isSuperAdmin } from "@/lib/auth/super-admin";
import { inngest } from "@/lib/inngest/client";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const BackfillSchema = z.object({
  org_id: z.string().uuid(),
});

type UngradedEvidence = {
  id: string;
  project_id: string;
  source_id: string | null;
};

const EVENT_BATCH_SIZE = 50;

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!(await isSuperAdmin(user.id))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const parsed = BackfillSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "org_id required" }, { status: 400 });
  }

  const { org_id } = parsed.data;
  const service = createServiceClient();

  const { data: org } = await service
    .from("orgs")
    .select("id")
    .eq("id", org_id)
    .single();

  if (!org) {
    return NextResponse.json({ error: "Org not found" }, { status: 404 });
  }

  const { data: evidence, error } = await service
    .from("evidence")
    .select("id, project_id, source_id")
    .eq("org_id", org_id)
    .is("ai_trust_grade", null);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const ungraded = (evidence ?? []) as UngradedEvidence[];
  if (ungraded.length === 0) {
    return NextResponse.json({ queued: 0, sources_queued: 0, skipped: 0 });
  }

  const sourceKeys = new Set<string>();
  let skipped = 0;

  for (const record of ungraded) {
    if (!record.source_id) {
      skipped += 1;
      continue;
    }
    sourceKeys.add(`${record.project_id}:${record.source_id}`);
  }

  const events = Array.from(sourceKeys).map((key) => {
    const [project_id, source_id] = key.split(":");
    return {
      name: "source/evidence.grading.requested" as const,
      data: { org_id, project_id, source_id },
    };
  });

  for (let i = 0; i < events.length; i += EVENT_BATCH_SIZE) {
    await inngest.send(events.slice(i, i + EVENT_BATCH_SIZE));
  }

  return NextResponse.json({
    queued: ungraded.length - skipped,
    sources_queued: events.length,
    skipped,
  });
}
