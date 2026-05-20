// POST /api/compose/draft
// Generates an evidence-grounded document draft
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getProjectForUser } from "@/lib/auth/org";
import { composeDraft } from "@/lib/compose/draft";
import { z } from "zod";

const DraftSchema = z.object({
  project_id: z.string().uuid(),
  prompt: z.string().min(5, "Prompt must be at least 5 characters"),
  limit: z.number().int().min(1).max(50).optional().default(18),
});

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const parsed = DraftSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { project_id, prompt, limit } = parsed.data;

  const project = await getProjectForUser<{ id: string; org_id: string; name: string }>(
    user.id,
    project_id,
    "id, org_id, name"
  );

  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const draft = await composeDraft({
    org_id: project.org_id,
    project_id,
    prompt,
    limit,
  });

  // Persist as artifact
  const { data: artifact } = await supabase
    .from("artifacts")
    .insert({
      org_id: project.org_id,
      project_id,
      type: "other",
      title: draft.title,
      prompt,
      content_md: [
        `# ${draft.title}`,
        "",
        ...draft.sections.map((s) => `## ${s.heading}\n\n${s.content}`),
      ].join("\n\n"),
      model_used: draft.model_used,
      task_tier: draft.task_tier,
      created_by: user.id,
    })
    .select("id")
    .single();

  return NextResponse.json({
    ...draft,
    artifact_id: artifact?.id ?? null,
  });
}
