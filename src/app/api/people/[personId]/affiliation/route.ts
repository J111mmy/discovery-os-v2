import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrgId } from "@/lib/auth/org";
import type { Affiliation } from "@/types/database";

const AFFILIATIONS = ["internal", "external", "unknown"] as const;

function isAffiliation(value: unknown): value is Affiliation {
  return typeof value === "string" && AFFILIATIONS.includes(value as Affiliation);
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { personId: string } }
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const orgId = await getActiveOrgId(user.id);

  if (!orgId) {
    return NextResponse.json({ error: "Org not found" }, { status: 404 });
  }

  let body: { affiliation?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!isAffiliation(body.affiliation)) {
    return NextResponse.json({ error: "Invalid affiliation value" }, { status: 400 });
  }

  const { data: person, error } = await supabase
    .from("people")
    .update({
      affiliation: body.affiliation,
      updated_at: new Date().toISOString(),
    })
    .eq("org_id", orgId)
    .eq("id", params.personId)
    .select("id")
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!person) {
    return NextResponse.json({ error: "Person not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
