import { createClient } from "@/lib/supabase/server";
import { getActiveOrgId } from "@/lib/auth/org";
import { redirect } from "next/navigation";
import Link from "next/link";

export default async function ProjectsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const orgId = await getActiveOrgId(user.id);
  const { data: projects } = orgId
    ? await supabase
        .from("projects")
        .select("id, org_id, name, slug, description, updated_at, archived")
        .eq("org_id", orgId)
        .eq("archived", false)
        .order("updated_at", { ascending: false })
    : { data: [] };

  return (
    <div className="min-h-screen bg-[var(--surface-0)] p-8">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-xl font-semibold text-[var(--ink)]">Projects</h1>
            <p className="text-sm text-[var(--ink-muted)] mt-0.5">Your evidence workspaces</p>
          </div>
          <Link
            href="/projects/new"
            className="px-4 py-2 rounded-lg bg-[var(--brand)] text-white text-sm font-medium hover:bg-[var(--brand-dim)] transition-colors"
          >
            New project
          </Link>
        </div>

        {(!projects || projects.length === 0) ? (
          <div className="text-center py-24 text-[var(--ink-muted)]">
            <p className="font-medium text-[var(--ink)]">No projects yet</p>
            <p className="text-sm mt-1">Create your first project to start ingesting evidence.</p>
          </div>
        ) : (
          <div className="grid gap-3">
            {projects.map((p) => (
              <Link
                key={p.id}
                href={`/projects/${p.id}`}
                className="block p-5 rounded-xl bg-[var(--surface-1)] border border-[var(--border)] hover:border-[var(--brand)] transition-colors group"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <h2 className="font-medium text-[var(--ink)] group-hover:text-[var(--brand)] transition-colors">
                      {p.name}
                    </h2>
                    {p.description && (
                      <p className="text-sm text-[var(--ink-muted)] mt-0.5 line-clamp-2">
                        {p.description}
                      </p>
                    )}
                  </div>
                  <span className="text-xs text-[var(--ink-faint)] mt-0.5 shrink-0 ml-4">
                    {new Date(p.updated_at).toLocaleDateString()}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
