// POST /api/query
// Semantic evidence search — always scoped to org_id
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getProjectForUser } from "@/lib/auth/org";
import { queryEvidence } from "@/lib/query/evidence";
import { z } from "zod";

const QuerySchema = z.object({
  project_id: z.string().uuid(),
  q: z.string().min(1),
  limit: z.number().int().min(1).max(50).optional().default(18),
  trust_scope: z
    .enum(["trusted", "pending", "disputed", "excluded", "include_pending"])
    .optional()
    .default("include_pending"),
});

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const parsed = QuerySchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { project_id, q, limit, trust_scope } = parsed.data;

  const project = await getProjectForUser<{ id: string; org_id: string }>(
    user.id,
    project_id,
    "id, org_id"
  );

  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const result = await queryEvidence({
    org_id: project.org_id,
    project_id,
    q,
    limit,
    trust_scope,
  });

  return NextResponse.json(result);
}
