// POST /api/companies/[companyId]/synthesise
// Triggers on-demand company digest generation via Inngest.
// Returns immediately — the digest is generated in the background.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrgId } from "@/lib/auth/org";
import { requireActiveAccess } from "@/lib/auth/access";
import { inngest } from "@/lib/inngest/client";

export async function POST(
  _req: NextRequest,
  { params }: { params: { companyId: string } }
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

  // Confirm company belongs to this org
  const { data: company } = await supabase
    .from("companies")
    .select("id")
    .eq("org_id", orgId)
    .eq("id", params.companyId)
    .single();

  if (!company) {
    return NextResponse.json({ error: "Company not found" }, { status: 404 });
  }

  try {
    await inngest.send({
      name: "company/digest.requested",
      data: { org_id: orgId, company_id: params.companyId },
    });
  } catch (inngestError) {
    const message = inngestError instanceof Error ? inngestError.message : String(inngestError);
    return NextResponse.json({ error: `Could not queue digest: ${message}` }, { status: 503 });
  }

  return NextResponse.json({ ok: true, status: "queued" });
}
