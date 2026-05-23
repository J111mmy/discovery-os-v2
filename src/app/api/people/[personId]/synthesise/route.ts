// POST /api/people/[personId]/synthesise
// Triggers an on-demand digest refresh for a person.
// Returns immediately — digest generation runs as an Inngest background function.
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
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

  // Resolve the user's org
  const { data: membership } = await supabase
    .from("org_members")
    .select("org_id")
    .eq("user_id", user.id)
    .order("joined_at", { ascending: true })
    .limit(1)
    .single();

  if (!membership?.org_id) {
    return NextResponse.json({ error: "Org not found" }, { status: 404 });
  }

  // Confirm the person belongs to this org
  const { data: person } = await supabase
    .from("people")
    .select("id")
    .eq("org_id", membership.org_id)
    .eq("id", params.personId)
    .single();

  if (!person) {
    return NextResponse.json({ error: "Person not found" }, { status: 404 });
  }

  try {
    await inngest.send({
      name: "person/digest.requested",
      data: { org_id: membership.org_id, person_id: params.personId },
    });
  } catch (inngestError) {
    const message = inngestError instanceof Error ? inngestError.message : String(inngestError);
    return NextResponse.json({ error: `Could not queue digest: ${message}` }, { status: 503 });
  }

  return NextResponse.json({ ok: true, status: "queued" });
}
