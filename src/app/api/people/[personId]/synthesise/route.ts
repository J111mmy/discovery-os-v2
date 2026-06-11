// POST /api/people/[personId]/synthesise
// Triggers an on-demand digest refresh for a person.
// Returns immediately — digest generation runs as an Inngest background function.
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrgId } from "@/lib/auth/org";
import { requireActiveAccess } from "@/lib/auth/access";
import { inngest } from "@/lib/inngest/client";

export async function POST(
  _req: NextRequest,
  { params }: { params: { personId: string } }
) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();

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

  const orgId = await getActiveOrgId(user.id);

  if (!orgId) {
    return NextResponse.json({ error: "Org not found" }, { status: 404 });
  }

  // Confirm the person belongs to this org
  const { data: person } = await supabase
    .from("people")
    .select("id")
    .eq("org_id", orgId)
    .eq("id", params.personId)
    .single();

  if (!person) {
    return NextResponse.json({ error: "Person not found" }, { status: 404 });
  }

  try {
    await inngest.send({
      name: "person/digest.requested",
      data: { org_id: orgId, person_id: params.personId },
    });
  } catch (inngestError) {
    const message = inngestError instanceof Error ? inngestError.message : String(inngestError);
    return NextResponse.json({ error: `Could not queue digest: ${message}` }, { status: 503 });
  }

  return NextResponse.json({ ok: true, status: "queued" });
}
