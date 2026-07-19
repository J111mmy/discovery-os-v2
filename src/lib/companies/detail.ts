import type { OrgScopedRead } from "@/lib/auth/support-read";
import type {
  EvidenceClassification,
  EvidenceSentiment,
  PersonStatus,
  TrustScope,
} from "@/types/database";

export type CompanyDetail = {
  id: string;
  name: string;
  domain: string | null;
  industry: string | null;
  size: string | null;
  notes: string | null;
  digest: string | null;
  digest_updated_at: string | null;
};

export type CompanyPerson = {
  id: string;
  name: string;
  role: string | null;
  status: PersonStatus | null;
  email: string | null;
};

export type CompanyProject = {
  id: string;
  name: string;
};

export type CompanyEvidence = {
  id: string;
  content: string;
  summary: string | null;
  classification: EvidenceClassification | null;
  sentiment: EvidenceSentiment | null;
  trust_scope: TrustScope;
  metadata: Record<string, unknown>;
  project_id: string;
  project_name: string | null;
  source_id: string;
  source_title: string | null;
  created_at: string;
};

export type CompanyDetailPayload = {
  company: CompanyDetail;
  people: CompanyPerson[];
  projects: CompanyProject[];
  evidence: CompanyEvidence[];
};

export class CompanyNotFoundError extends Error {
  constructor() {
    super("Company not found");
    this.name = "CompanyNotFoundError";
  }
}

type JoinedEvidence = Omit<CompanyEvidence, "project_name" | "source_title">;

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

export async function getCompanyDetail(
  read: OrgScopedRead,
  companyId: string
): Promise<CompanyDetailPayload> {
  const [companyResult, peopleResult, projectsResult, evidenceResult] = await Promise.all([
    read
      .from("companies")
      .select("id, name, domain, industry, size, notes, digest, digest_updated_at")
      .eq("id", companyId)
      .single(),
    read
      .from("people")
      .select("id, name, role, status, email")
      .eq("company_id", companyId)
      .order("name", { ascending: true }),
    read
      .from("projects")
      .select("id, name, company_projects!inner(company_id)")
      .eq("company_projects.company_id", companyId)
      .order("name", { ascending: true }),
    read
      .from("evidence_entities")
      .select("evidence(id, content, summary, classification, sentiment, trust_scope, metadata, project_id, source_id, created_at)")
      .eq("entity_type", "company")
      .eq("entity_id", companyId)
      .limit(20),
  ]);

  if (companyResult.error || !companyResult.data) {
    throw new CompanyNotFoundError();
  }

  if (peopleResult.error || projectsResult.error || evidenceResult.error) {
    throw new Error(
      peopleResult.error?.message ??
        projectsResult.error?.message ??
        evidenceResult.error?.message ??
        "Could not load company detail"
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

  return {
    company: companyResult.data,
    people: (peopleResult.data ?? []) as CompanyPerson[],
    projects: ((projectsResult.data ?? []) as ProjectJoinRow[]).map((project) => ({
      id: project.id,
      name: project.name,
    })),
    evidence: evidence.map((record) => ({
      ...record,
      project_name: projectNames.get(record.project_id) ?? null,
      source_title: sourceTitles.get(record.source_id) ?? null,
    })),
  };
}
