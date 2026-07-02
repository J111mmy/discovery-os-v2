import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireActiveAccess } from "@/lib/auth/access";
import { getProjectForUser } from "@/lib/auth/org";
import { PROCESSED_MARKER_ERROR, looksLikeProcessedMarker } from "@/lib/ingest/quality";
import { prescanSourceEntities } from "@/lib/ingest/prescan";

const PrescanSchema = z.object({
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
  ]).optional(),
  raw_text: z.string().min(20, "Text must be at least 20 characters"),
});

export async function POST(
  req: NextRequest,
  { params }: { params: { projectId: string } }
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

  const body = await req.json();
  const parsed = PrescanSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { type, raw_text } = parsed.data;
  if (looksLikeProcessedMarker(raw_text)) {
    return NextResponse.json({ error: PROCESSED_MARKER_ERROR }, { status: 422 });
  }

  const project = await getProjectForUser<{ id: string; org_id: string }>(
    user.id,
    params.projectId,
    "id, org_id"
  );

  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  try {
    const result = await prescanSourceEntities({
      supabase,
      org_id: project.org_id,
      type,
      raw_text,
    });
    return NextResponse.json(result);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not scan source";
    console.error("[ingest/prescan] failed:", message);
    return NextResponse.json(
      { error: "Could not scan source for speakers and organizations." },
      { status: 500 }
    );
  }
}
