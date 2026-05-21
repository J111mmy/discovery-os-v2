import { getProjectForUser } from "@/lib/auth/org";
import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const UpdateProjectSchema = z.object({
  frame: z.string().max(8000).optional().nullable(),
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

  const project = await getProjectForUser<{ id: string; org_id: string }>(
    user.id,
    params.projectId,
    "id, org_id"
  );

  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const { data, error } = await supabase
    .from("projects")
    .update({
      frame: parsed.data.frame?.trim() || null,
      operating_style: parsed.data.operating_style?.trim() || null,
      gtm_context: parsed.data.gtm_context?.trim() || null,
    })
    .eq("org_id", project.org_id)
    .eq("id", project.id)
    .select("id, org_id, frame, operating_style, gtm_context, updated_at")
    .single();

  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? "Failed to update project" }, { status: 500 });
  }

  return NextResponse.json({ project: data });
}
