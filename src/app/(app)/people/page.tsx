import { createClient } from "@/lib/supabase/server";
import { getOrgScopedReadForUser } from "@/lib/auth/support-read";
import type { Affiliation, PersonStatus } from "@/types/database";
import { redirect } from "next/navigation";
import { DirectoryList, type DirectoryItem } from "@/app/(app)/components/DirectoryList";

type ProjectRelation = {
  project_id: string;
  projects: { name: string } | { name: string }[] | null;
};

type PersonRow = {
  id: string;
  name: string;
  role: string | null;
  email: string | null;
  affiliation: Affiliation;
  status: PersonStatus;
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

  const read = await getOrgScopedReadForUser(user.id, supabase);
  const { data: people } = read
    ? await read
        .from("people")
        .select("id, name, role, email, affiliation, status, person_projects(project_id, projects(name))")
        .order("name", { ascending: true })
    : { data: [] };

  const rows = (people ?? []) as PersonRow[];

  const items: DirectoryItem[] = rows.map((person) => {
    const projectLinks = asArray(person.person_projects).map((rel) => ({
      id: rel.project_id,
      name: projectName(rel.projects),
    }));

    const subtitle = [person.role, person.email].filter(Boolean).join(" · ");

    const meta =
      projectLinks.length > 0
        ? `${projectLinks.length} project${projectLinks.length !== 1 ? "s" : ""}`
        : null;

    const badge =
      person.affiliation === "internal"
        ? { label: "Internal", tone: "warn" as const }
        : person.affiliation === "unknown"
        ? { label: "Unclassified", tone: "neutral" as const }
        : undefined;

    return {
      id: person.id,
      name: person.name,
      subtitle: subtitle || null,
      meta,
      badge,
      projectLinks,
      detailHref: `/people/${person.id}`,
      kind: "person" as const,
    };
  });

  return (
    <DirectoryList
      title="People"
      lead="Individuals who appear across your research."
      searchPlaceholder="Search people…"
      items={items}
      emptyMessage="No people extracted yet. Ingest and process transcripts to surface people automatically."
    />
  );
}
