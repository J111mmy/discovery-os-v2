import { getProjectForUser } from "@/lib/auth/org";
import { inngest } from "@/lib/inngest/client";
import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const FrameDraftSchema = z.object({
  problem: z.string(),
  hypothesis: z.string(),
  buyers: z.string(),
  research_areas: z.array(z.string()),
});

const ResearchContextSchema = z.object({
  goals: z.string().max(4000).optional(),
  outcomes: z.string().max(4000).optional(),
  buyers: z.string().max(4000).optional(),
  scope_in: z.string().max(4000).optional(),
  scope_out: z.string().max(4000).optional(),
  research_questions: z.array(z.string().max(1000)).optional(),
});

const UpdateProjectSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().max(4000).optional().nullable(),
  frame: z.string().max(8000).optional().nullable(),
  frame_data: z.record(z.unknown()).optional().nullable(),
  frame_draft: FrameDraftSchema.optional().nullable(),
  research_context: ResearchContextSchema.optional().nullable(),
  operating_style: z.string().max(8000).optional().nullable(),
  gtm_context: z.string().max(12000).optional().nullable(),
});

interface Props {
  params: { projectId: string };
}

export async function PATCH(req: NextRequest, { params }: Props) {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = UpdateProjectSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const researchContextChanging = "research_context" in parsed.data;

  const project = await getProjectForUser<{
    id: string;
    org_id: string;
    research_context: Record<string, unknown> | null;
  }>(
    user.id,
    params.projectId,
    researchContextChanging ? "id, org_id, research_context" : "id, org_id"
  );

  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const updates: Record<string, unknown> = {};
  if ("name" in parsed.data) updates.name = parsed.data.name?.trim();
  if ("description" in parsed.data) {
    updates.description = parsed.data.description?.trim() || null;
  }
  if ("frame" in parsed.data) {
    updates.frame = parsed.data.frame?.trim() || null;
  }
  if ("frame_data" in parsed.data) {
    updates.frame_data = parsed.data.frame_data ?? null;
  }
  if ("frame_draft" in parsed.data) {
    updates.frame_draft = parsed.data.frame_draft ?? null;
    if (parsed.data.frame_draft === null) {
      updates.frame_draft_generated_at = null;
    }
  }
  if ("research_context" in parsed.data) {
    updates.research_context = parsed.data.research_context ?? null;
  }
  if ("operating_style" in parsed.data) {
    updates.operating_style = parsed.data.operating_style?.trim() || null;
  }
  if ("gtm_context" in parsed.data) {
    updates.gtm_context = parsed.data.gtm_context?.trim() || null;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No valid update fields provided" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("projects")
    .update(updates)
    .eq("org_id", project.org_id)
    .eq("id", project.id)
    .select("id, org_id, name, description, frame, frame_data, frame_draft, frame_draft_generated_at, research_context, operating_style, gtm_context, updated_at")
    .single();

  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? "Failed to update project" }, { status: 500 });
  }

  // When research_context is saved and has meaningfully changed, re-grade all existing
  // evidence for the project so the queue reflects the new scope without manual effort.
  if (researchContextChanging) {
    const newContext = parsed.data.research_context ?? null;
    const hasContent = newContext !== null && Object.values(newContext).some(
      (v) => typeof v === "string" ? v.trim().length > 0 : Array.isArray(v) && v.length > 0
    );
    const contextChanged =
      JSON.stringify(newContext ?? null) !== JSON.stringify(project.research_context ?? null);

    if (hasContent && contextChanged) {
      const { data: sources } = await supabase
        .from("sources")
        .select("id")
        .eq("org_id", project.org_id)
        .eq("project_id", project.id);

      const events = (sources ?? []).map((source) => ({
        name: "source/evidence.grading.requested" as const,
        data: { org_id: project.org_id, project_id: project.id, source_id: source.id },
      }));

      if (events.length > 0) {
        await inngest.send(events);
      }
    }
  }

  return NextResponse.json({ project: data });
}
