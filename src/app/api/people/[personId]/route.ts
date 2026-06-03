import { createClient } from "@/lib/supabase/server";
import { getActiveOrgId } from "@/lib/auth/org";
import type { PersonStatus } from "@/types/database";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const PERSON_STATUSES = [
  "prospect",
  "interviewed",
  "concept-shown",
  "demo-shown",
  "beta-candidate",
  "beta-participant",
  "customer",
] as const satisfies readonly PersonStatus[];

const PersonPatchSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  role: z.string().max(255).nullable().optional(),
  email: z.string().email().max(255).nullable().or(z.literal("")).optional(),
  status: z.enum(PERSON_STATUSES).optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: { personId: string } }
) {
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
    return NextResponse.json({ error: "Org not found" }, { status: 404 });
  }

  const parsed = PersonPatchSchema.safeParse(await req.json());

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const updates: Record<string, unknown> = {};

  if ("name" in parsed.data) updates.name = parsed.data.name?.trim();
  if ("role" in parsed.data) updates.role = parsed.data.role?.trim() || null;
  if ("email" in parsed.data) updates.email = parsed.data.email?.trim() || null;
  if ("status" in parsed.data) updates.status = parsed.data.status;

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No valid update fields provided" }, { status: 400 });
  }

  updates.updated_at = new Date().toISOString();

  const { data, error } = await supabase
    .from("people")
    .update(updates)
    .eq("org_id", orgId)
    .eq("id", params.personId)
    .select("id, name, role, email, status")
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!data) {
    return NextResponse.json({ error: "Person not found" }, { status: 404 });
  }

  return NextResponse.json({ person: data });
}
