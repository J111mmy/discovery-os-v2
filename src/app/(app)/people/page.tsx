import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { redirect } from "next/navigation";

type ProjectRelation = {
  project_id: string;
  projects: { name: string } | { name: string }[] | null;
};

type PersonRow = {
  id: string;
  name: string;
  role: string | null;
  email: string | null;
  person_projects: ProjectRelation[] | ProjectRelation | null;
};

function asArray<T>(value: T | T[] | null | undefined): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function projectName(projects: ProjectRelation["projects"]) {
  const project = Array.isArray(projects) ? projects[0] : projects;
  return project?.name ?? "Project";
}

export default async function PeoplePage() {
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
  const { data: people } = orgId
    ? await supabase
        .from("people")
        .select("id, name, role, email, person_projects(project_id, projects(name))")
        .eq("org_id", orgId)
        .order("name", { ascending: true })
    : { data: [] };

  const rows = (people ?? []) as PersonRow[];

  return (
    <main className="min-h-screen px-5 py-8 sm:px-8">
      <div className="mx-auto max-w-5xl">
        <div className="mb-8">
          <h1 className="text-2xl font-semibold text-[var(--ink)]">People</h1>
          <p className="mt-2 text-sm leading-6 text-[var(--ink-muted)]">
            Individuals who appear across your research.
          </p>
        </div>

        {rows.length === 0 ? (
          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-1)] p-12 text-center text-sm text-[var(--ink-muted)]">
            No people extracted yet. Ingest and process transcripts to surface people automatically.
          </div>
        ) : (
          <div className="grid gap-3">
            {rows.map((person) => {
              const projectLinks = asArray(person.person_projects);

              return (
                <article
                  key={person.id}
                  className="rounded-xl border border-[var(--border)] bg-[var(--surface-1)] p-5"
                >
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <Link
                        href={`/people/${person.id}`}
                        className="font-semibold text-[var(--ink)] transition-colors hover:text-[var(--brand)]"
                      >
                        {person.name}
                      </Link>
                      {(person.role || person.email) && (
                        <p className="mt-1 text-sm text-[var(--ink-muted)]">
                          {[person.role, person.email].filter(Boolean).join(" · ")}
                        </p>
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
