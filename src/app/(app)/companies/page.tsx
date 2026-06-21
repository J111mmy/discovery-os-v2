import { createClient } from "@/lib/supabase/server";
import { getOrgScopedReadForUser } from "@/lib/auth/support-read";
import { redirect } from "next/navigation";
import { DirectoryList, type DirectoryItem } from "@/app/(app)/components/DirectoryList";

type ProjectRelation = {
  project_id: string;
  projects: { name: string } | { name: string }[] | null;
};

type CompanyRow = {
  id: string;
  name: string;
  domain: string | null;
  company_projects: ProjectRelation[] | ProjectRelation | null;
};

function asArray<T>(value: T | T[] | null | undefined): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function projectName(projects: ProjectRelation["projects"]) {
  const project = Array.isArray(projects) ? projects[0] : projects;
  return project?.name ?? "Project";
}

export default async function CompaniesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const read = await getOrgScopedReadForUser(user.id, supabase);
  const { data: companies } = read
    ? await read
        .from("companies")
        .select("id, name, domain, company_projects(project_id, projects(name))")
        .order("name", { ascending: true })
    : { data: [] };

  const rows = (companies ?? []) as CompanyRow[];

  const items: DirectoryItem[] = rows.map((company) => {
    const projectLinks = asArray(company.company_projects).map((rel) => ({
      id: rel.project_id,
      name: projectName(rel.projects),
    }));

    const meta =
      projectLinks.length > 0
        ? `${projectLinks.length} project${projectLinks.length !== 1 ? "s" : ""}`
        : null;

    return {
      id: company.id,
      name: company.name,
      subtitle: company.domain ?? null,
      meta,
      projectLinks,
      detailHref: `/companies/${company.id}`,
      kind: "company" as const,
    };
  });

  return (
    <DirectoryList
      title="Companies"
      lead="Organisations that appear across your research."
      searchPlaceholder="Search companies…"
      items={items}
      emptyMessage="No companies extracted yet. Companies are surfaced automatically during ingest."
    />
  );
}
