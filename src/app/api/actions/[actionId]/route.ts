import { createClient } from "@/lib/supabase/server";
import { getActiveOrgId } from "@/lib/auth/org";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const UpdateActionSchema = z.object({
  status: z.enum(["open", "done", "dismissed"]),
});

interface Props {
  params: { actionId: string };
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

  const orgId = await getActiveOrgId(user.id);

  if (!orgId) {
    return NextResponse.json({ error: "No org" }, { status: 403 });
  }

  const parsed = UpdateActionSchema.safeParse(await req.json());

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { data: updatedAction, error } = await supabase
    .from("actions")
    .update({ status: parsed.data.status, updated_at: new Date().toISOString() })
    .eq("org_id", orgId)
    .eq("id", params.actionId)
    .select("id")
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!updatedAction) {
    return NextResponse.json({ error: "Action not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
