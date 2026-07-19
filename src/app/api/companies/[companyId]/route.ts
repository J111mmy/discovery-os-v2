import { createClient } from "@/lib/supabase/server";
import { getActiveOrgId } from "@/lib/auth/org";
import { getOrgScopedReadForUser } from "@/lib/auth/support-read";
import { CompanyNotFoundError, getCompanyDetail } from "@/lib/companies/detail";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const CompanyPatchSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  domain: z.string().max(255).nullable().optional(),
  industry: z.string().max(255).nullable().optional(),
  size: z.string().max(255).nullable().optional(),
  notes: z.string().max(4000).nullable().optional(),
});

export async function GET(
  _req: NextRequest,
  { params }: { params: { companyId: string } }
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const read = await getOrgScopedReadForUser(user.id, supabase);

  if (!read) {
    return NextResponse.json({ error: "Org not found" }, { status: 404 });
  }
  try {
    return NextResponse.json(await getCompanyDetail(read, params.companyId));
  } catch (error) {
    if (error instanceof CompanyNotFoundError) {
      return NextResponse.json({ error: "Company not found" }, { status: 404 });
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not load company detail" },
      { status: 500 }
    );
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { companyId: string } }
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

  const parsed = CompanyPatchSchema.safeParse(await req.json());

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const updates: Record<string, unknown> = {};

  if ("name" in parsed.data) updates.name = parsed.data.name?.trim();
  if ("domain" in parsed.data) updates.domain = parsed.data.domain?.trim() || null;
  if ("industry" in parsed.data) updates.industry = parsed.data.industry?.trim() || null;
  if ("size" in parsed.data) updates.size = parsed.data.size?.trim() || null;
  if ("notes" in parsed.data) updates.notes = parsed.data.notes?.trim() || null;

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No valid update fields provided" }, { status: 400 });
  }

  updates.updated_at = new Date().toISOString();

  const { data, error } = await supabase
    .from("companies")
    .update(updates)
    .eq("org_id", orgId)
    .eq("id", params.companyId)
    .select("id, name, domain, industry, size, notes, digest, digest_updated_at")
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!data) {
    return NextResponse.json({ error: "Company not found" }, { status: 404 });
  }

  return NextResponse.json({ company: data });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { companyId: string } }
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

  const { data: company, error: lookupError } = await supabase
    .from("companies")
    .select("id")
    .eq("org_id", orgId)
    .eq("id", params.companyId)
    .maybeSingle();

  if (lookupError) {
    return NextResponse.json({ error: lookupError.message }, { status: 500 });
  }

  if (!company) {
    return NextResponse.json({ error: "Company not found" }, { status: 404 });
  }

  // evidence_entities.entity_id/entity_type aren't covered by the companies FK
  // (only the legacy company_id column is "on delete set null"), so clear the
  // company-tagged rows explicitly to avoid leaving dangling entity references.
  const { error: entityError } = await supabase
    .from("evidence_entities")
    .delete()
    .eq("org_id", orgId)
    .eq("entity_type", "company")
    .eq("entity_id", params.companyId);

  if (entityError) {
    return NextResponse.json({ error: entityError.message }, { status: 500 });
  }

  const { error: deleteError } = await supabase
    .from("companies")
    .delete()
    .eq("org_id", orgId)
    .eq("id", params.companyId);

  if (deleteError) {
    return NextResponse.json({ error: deleteError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
