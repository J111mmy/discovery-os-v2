import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { redirect } from "next/navigation";

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

  const { data: membership } = await supabase
    .from("org_members")
    .select("org_id")
    .eq("user_id", user.id)
    .order("joined_at", { ascending: true })
    .limit(1)
    .single();

  const orgId = membership?.org_id;
  const { data: companies } = orgId
    ? await supabase
        .from("companies")
        .select("id, name, domain, company_projects(project_id, projects(name))")
        .eq("org_id", orgId)
        .order("name", { ascending: true })
    : { data: [] };

  const rows = (companies ?? []) as CompanyRow[];

  return (
    <main className="min-h-screen px-5 py-8 sm:px-8">
      <div className="mx-auto max-w-5xl">
        <div className="mb-8">
          <h1 className="text-2xl font-semibold text-[var(--ink)]">Companies</h1>
          <p className="mt-2 text-sm leading-6 text-[var(--ink-muted)]">
            Organisations that appear across your research.
          </p>
        </div>

        {rows.length === 0 ? (
          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-1)] p-12 text-center text-sm text-[var(--ink-muted)]">
            No companies extracted yet.
          </div>
        ) : (
          <div className="grid gap-3">
            {rows.map((company) => {
              const projectLinks = asArray(company.company_projects);

              return (
                <article
                  key={company.id}
                  className="rounded-xl border border-[var(--border)] bg-[var(--surface-1)] p-5"
                >
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <Link
                        href={`/companies/${company.id}`}
                        className="font-semibold text-[var(--ink)] transition-colors hover:text-[var(--brand)]"
                      >
                        {company.name}
                      </Link>
                      {company.domain && (
                        <p className="mt-1 text-sm text-[var(--ink-muted)]">{company.domain}</p>
                      )}
                    </div>

                    {projectLinks.length > 0 && (
                      <div className="flex flex-wrap gap-2 sm:justify-end">
                        {projectLinks.map((relation) => (
                          <Link
                            key={relation.project_id}
                            href={`/projects/${relation.project_id}`}
                            className="rounded-full border border-[var(--border)] bg-[var(--surface-0)] px-2.5 py-1 text-xs font-medium text-[var(--ink-muted)] transition-colors hover:border-[var(--brand)] hover:text-[var(--brand)]"
                          >
                            {projectName(relation.projects)}
                          </Link>
                        ))}
                      </div>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}
