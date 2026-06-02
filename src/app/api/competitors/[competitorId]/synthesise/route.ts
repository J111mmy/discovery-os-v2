// POST /api/competitors/[competitorId]/synthesise
// Triggers on-demand competitor digest generation via Inngest.
// Returns immediately — the digest is generated in the background.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrgId } from "@/lib/auth/org";
import { inngest } from "@/lib/inngest/client";

export async function POST(
  _req: NextRequest,
  { params }: { params: { competitorId: string } }
) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const orgId = await getActiveOrgId(user.id);

  if (!orgId) {
    return NextResponse.json({ error: "Org not found" }, { status: 404 });
  }

  // Confirm competitor belongs to this org
  const { data: competitor } = await supabase
    .from("competitors")
    .select("id")
    .eq("org_id", orgId)
    .eq("id", params.competitorId)
    .single();

  if (!competitor) {
    return NextResponse.json({ error: "Competitor not found" }, { status: 404 });
  }

  try {
    await inngest.send({
      name: "competitor/digest.requested",
      data: { org_id: orgId, competitor_id: params.competitorId },
    });
  } catch (inngestError) {
    const message = inngestError instanceof Error ? inngestError.message : String(inngestError);
    return NextResponse.json({ error: `Could not queue digest: ${message}` }, { status: 503 });
  }

  return NextResponse.json({ ok: true, status: "queued" });
}
