import { createClient } from "@/lib/supabase/server";
import { getActiveOrgId } from "@/lib/auth/org";
import { getOrgScopedReadForUser } from "@/lib/auth/support-read";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const CompanyPatchSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  domain: z.string().max(255).nullable().optional(),
  industry: z.string().max(255).nullable().optional(),
  size: z.string().max(255).nullable().optional(),
  notes: z.string().max(4000).nullable().optional(),
});

type JoinedEvidence = {
  id: string;
  content: string;
  summary: string | null;
  classification: string | null;
  sentiment: string | null;
  trust_scope: string;
  metadata: Record<string, unknown>;
  project_id: string;
  source_id: string;
  created_at: string;
};

type EvidenceEntityRow = {
  evidence: JoinedEvidence | JoinedEvidence[] | null;
};

type ProjectJoinRow = {
  id: string;
  name: string;
};

function asArray<T>(value: T | T[] | null | undefined): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function dedupeEvidence(rows: EvidenceEntityRow[]) {
  const seen = new Set<string>();
  return rows
    .flatMap((row) => asArray(row.evidence))
    .filter((record): record is JoinedEvidence => {
      if (!record?.id || seen.has(record.id)) return false;
      seen.add(record.id);
      return true;
    });
}

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
  const [companyResult, peopleResult, projectsResult, evidenceResult] = await Promise.all([
    read
      .from("companies")
      .select("id, name, domain, industry, size, notes, digest, digest_updated_at")
      .eq("id", params.companyId)
      .single(),
    read
      .from("people")
      .select("id, name, role, status, email")
      .eq("company_id", params.companyId)
      .order("name", { ascending: true }),
    read
      .from("projects")
      .select("id, name, company_projects!inner(company_id)")
      .eq("company_projects.company_id", params.companyId)
      .order("name", { ascending: true }),
    read
      .from("evidence_entities")
      .select("evidence(id, content, summary, classification, sentiment, trust_scope, metadata, project_id, source_id, created_at)")
      .eq("entity_type", "company")
      .eq("entity_id", params.companyId)
      .limit(20),
  ]);

  if (companyResult.error || !companyResult.data) {
    return NextResponse.json({ error: "Company not found" }, { status: 404 });
  }

  if (peopleResult.error || projectsResult.error || evidenceResult.error) {
    return NextResponse.json(
      {
        error:
          peopleResult.error?.message ??
          projectsResult.error?.message ??
          evidenceResult.error?.message ??
          "Could not load company detail",
      },
      { status: 500 }
    );
  }

  const evidence = dedupeEvidence((evidenceResult.data ?? []) as EvidenceEntityRow[]);
  const projectIds = Array.from(new Set(evidence.map((record) => record.project_id)));
  const sourceIds = Array.from(new Set(evidence.map((record) => record.source_id)));

  const [evidenceProjectsResult, sourcesResult] = await Promise.all([
    projectIds.length > 0
      ? read
          .from("projects")
          .select("id, name")
          .in("id", projectIds)
      : Promise.resolve({ data: [] }),
    sourceIds.length > 0
      ? read
          .from("sources")
          .select("id, title")
          .in("id", sourceIds)
      : Promise.resolve({ data: [] }),
  ]);

  const projectNames = new Map(
    ((evidenceProjectsResult.data ?? []) as ProjectJoinRow[]).map((project) => [
      project.id,
      project.name,
    ])
  );
  const sourceTitles = new Map(
    ((sourcesResult.data ?? []) as { id: string; title: string }[]).map((source) => [
      source.id,
      source.title,
    ])
  );

  return NextResponse.json({
    company: companyResult.data,
    people: peopleResult.data ?? [],
    projects: ((projectsResult.data ?? []) as ProjectJoinRow[]).map((project) => ({
      id: project.id,
      name: project.name,
    })),
    evidence: evidence.map((record) => ({
      ...record,
      project_name: projectNames.get(record.project_id) ?? null,
      source_title: sourceTitles.get(record.source_id) ?? null,
    })),
  });
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
