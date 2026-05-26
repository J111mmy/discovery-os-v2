import { createClient } from "@/lib/supabase/server";
import { getUserOrgIds } from "@/lib/auth/org";
import { NextRequest, NextResponse } from "next/server";

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

  const orgIds = await getUserOrgIds(user.id);
  const orgId = orgIds[0] ?? null;

  if (!orgId) {
    return NextResponse.json({ error: "Org not found" }, { status: 404 });
  }
  const [companyResult, peopleResult, projectsResult, evidenceResult] = await Promise.all([
    supabase
      .from("companies")
      .select("id, name, domain, industry, size, notes, digest, digest_updated_at")
      .eq("org_id", orgId)
      .eq("id", params.companyId)
      .single(),
    supabase
      .from("people")
      .select("id, name, role, status, email")
      .eq("org_id", orgId)
      .eq("company_id", params.companyId)
      .order("name", { ascending: true }),
    supabase
      .from("projects")
      .select("id, name, company_projects!inner(company_id)")
      .eq("org_id", orgId)
      .eq("company_projects.company_id", params.companyId)
      .order("name", { ascending: true }),
    supabase
      .from("evidence_entities")
      .select("evidence(id, content, summary, classification, sentiment, trust_scope, metadata, project_id, source_id, created_at)")
      .eq("org_id", orgId)
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
      ? supabase
          .from("projects")
          .select("id, name")
          .eq("org_id", orgId)
          .in("id", projectIds)
      : Promise.resolve({ data: [] }),
    sourceIds.length > 0
      ? supabase
          .from("sources")
          .select("id, title")
          .eq("org_id", orgId)
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
    projects: (projectsResult.data ?? []).map((project) => ({
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
