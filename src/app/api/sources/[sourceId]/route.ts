import { getProjectForUser } from "@/lib/auth/org";
import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const DeleteSourceSchema = z.object({
  project_id: z.string().uuid(),
});

interface Props {
  params: { sourceId: string };
}

export async function DELETE(req: NextRequest, { params }: Props) {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = DeleteSourceSchema.safeParse(
    Object.fromEntries(new URL(req.url).searchParams)
  );

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

  const { data: source } = await supabase
    .from("sources")
    .select("id, org_id, project_id")
    .eq("org_id", project.org_id)
    .eq("project_id", project.id)
    .eq("id", params.sourceId)
    .single();

  if (!source) {
    return NextResponse.json({ error: "Source not found" }, { status: 404 });
  }

  const { error } = await supabase
    .from("sources")
    .delete()
    .eq("org_id", project.org_id)
    .eq("project_id", project.id)
    .eq("id", source.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ deleted: true });
}
