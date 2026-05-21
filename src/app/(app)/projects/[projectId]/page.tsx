// Project workspace — evidence browser + compose entry point
import { createClient } from "@/lib/supabase/server";
import { getProjectForUser } from "@/lib/auth/org";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";

interface Props {
  params: { projectId: string };
}

export default async function ProjectPage({ params }: Props) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const project = await getProjectForUser<{
    id: string;
    org_id: string;
    name: string;
    description: string | null;
    frame: string | null;
    created_at: string;
  }>(user.id, params.projectId, "id, org_id, name, description, frame, created_at");

  if (!project) notFound();

  const [
    { count: evidenceCount },
    { count: trustedCount },
    { count: pendingCount },
    { count: artifactCount },
    { data: sources },
  ] =
    await Promise.all([
      supabase
        .from("evidence")
        .select("*", { count: "exact", head: true })
        .eq("org_id", project.org_id)
        .eq("project_id", project.id),
      supabase
        .from("evidence")
        .select("*", { count: "exact", head: true })
        .eq("org_id", project.org_id)
        .eq("project_id", project.id)
        .eq("trust_scope", "trusted"),
      supabase
        .from("evidence")
        .select("*", { count: "exact", head: true })
        .eq("org_id", project.org_id)
        .eq("project_id", project.id)
        .eq("trust_scope", "pending"),
      supabase
        .from("artifacts")
        .select("*", { count: "exact", head: true })
        .eq("org_id", project.org_id)
        .eq("project_id", project.id),
      supabase
        .from("sources")
        .select("id, org_id, title, type, trust_scope, ingested_at")
        .eq("org_id", project.org_id)
        .eq("project_id", project.id)
        .order("ingested_at", { ascending: false })
        .limit(5),
    ]);

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-8 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="mb-2 text-xs font-medium uppercase tracking-wide text-[var(--ink-faint)]">
            Workspace
          </div>
          <h1 className="text-2xl font-semibold text-[var(--ink)]">{project.name}</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--ink-muted)]">
            {project.description || "Turn raw discovery input into trusted evidence and working artifacts."}
          </p>
        </div>
        <Link
          href={`/projects/${project.id}/ingest`}
          className="inline-flex rounded-lg bg-[var(--brand)] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[var(--brand-dim)]"
        >
          Add evidence
        </Link>
      </div>

      <div className="mb-8 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-1)] p-5">
          <div className="text-2xl font-semibold text-[var(--ink)]">{evidenceCount ?? 0}</div>
          <div className="mt-1 text-sm text-[var(--ink-muted)]">Evidence records</div>
        </div>
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-1)] p-5">
          <div className="text-2xl font-semibold text-green-300">{trustedCount ?? 0}</div>
          <div className="mt-1 text-sm text-[var(--ink-muted)]">Trusted</div>
        </div>
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-1)] p-5">
          <div className="text-2xl font-semibold text-yellow-300">{pendingCount ?? 0}</div>
          <div className="mt-1 text-sm text-[var(--ink-muted)]">Pending review</div>
        </div>
        <Link
          href={`/projects/${project.id}/documents`}
          className="rounded-xl border border-[var(--border)] bg-[var(--surface-1)] p-5 transition-colors hover:border-[var(--brand)]"
        >
          <div className="text-2xl font-semibold text-[var(--ink)]">{artifactCount ?? 0}</div>
          <div className="mt-1 text-sm text-[var(--ink-muted)]">Documents</div>
        </Link>
      </div>

      {!project.frame?.trim() && (
        <Link
          href={`/projects/${project.id}/settings`}
          className="mb-8 block rounded-xl border border-[var(--brand)] bg-[var(--surface-1)] p-5 text-[var(--ink)] transition-colors hover:bg-[var(--surface-2)]"
        >
          <div className="text-sm font-semibold">Add a Project Frame to improve compose quality →</div>
          <div className="mt-2 text-sm leading-6 text-[var(--ink-muted)]">
            Give drafts a clearer north star, audience, and decision context.
          </div>
        </Link>
      )}

      <div className="mb-8 grid gap-3 lg:grid-cols-4">
        <Link
          href={`/projects/${project.id}/evidence`}
          className="rounded-xl border border-[var(--border)] bg-[var(--surface-1)] p-5 text-[var(--ink)] transition-colors hover:border-[var(--brand)]"
        >
          <div className="text-sm font-semibold">Review evidence</div>
          <div className="mt-2 text-sm leading-6 text-[var(--ink-muted)]">
            Search, inspect, and trust source-backed claims.
          </div>
        </Link>
        <Link
          href={`/projects/${project.id}/sources`}
          className="rounded-xl border border-[var(--border)] bg-[var(--surface-1)] p-5 text-[var(--ink)] transition-colors hover:border-[var(--brand)]"
        >
          <div className="text-sm font-semibold">Manage sources</div>
          <div className="mt-2 text-sm leading-6 text-[var(--ink-muted)]">
            View segments, retry ingest, and remove source material.
          </div>
        </Link>
        <Link
          href={`/projects/${project.id}/compose`}
          className="rounded-xl border border-[var(--brand)] bg-[var(--brand)] p-5 text-white transition-colors hover:bg-[var(--brand-dim)]"
        >
          <div className="text-sm font-semibold">Draft artifact</div>
          <div className="mt-2 text-sm leading-6 text-white/75">
            Generate a working document grounded in trusted evidence.
          </div>
        </Link>
        <Link
          href={`/projects/${project.id}/ingest`}
          className="rounded-xl border border-[var(--border)] bg-[var(--surface-1)] p-5 text-[var(--ink)] transition-colors hover:border-[var(--brand)]"
        >
          <div className="text-sm font-semibold">Add source material</div>
          <div className="mt-2 text-sm leading-6 text-[var(--ink-muted)]">
            Paste a transcript, document, note, or raw research input.
          </div>
        </Link>
      </div>

      <section className="rounded-xl border border-[var(--border)] bg-[var(--surface-1)]">
        <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold text-[var(--ink)]">Recent sources</h2>
            <p className="mt-1 text-xs text-[var(--ink-muted)]">Latest raw inputs added to this workspace</p>
          </div>
          <Link
            href={`/projects/${project.id}/sources`}
            className="text-xs font-medium text-[var(--ink-muted)] transition-colors hover:text-[var(--brand)]"
          >
            View all
          </Link>
        </div>
        {sources && sources.length > 0 && (
          <div className="divide-y divide-[var(--border)]">
              {sources.map((s) => (
                <div
                  key={s.id}
                className="flex items-center justify-between gap-4 px-5 py-4"
                >
                  <div>
                    <div className="text-sm font-medium text-[var(--ink)]">{s.title}</div>
                    <div className="text-xs text-[var(--ink-muted)] mt-0.5 capitalize">{s.type}</div>
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                    s.trust_scope === "trusted"
                      ? "bg-green-900/30 text-green-400"
                      : s.trust_scope === "pending"
                      ? "bg-yellow-900/30 text-yellow-400"
                      : "bg-red-900/30 text-red-400"
                  }`}>
                    {s.trust_scope}
                  </span>
                </div>
              ))}
          </div>
        )}
        {(!sources || sources.length === 0) && (
          <div className="px-5 py-12 text-center text-sm text-[var(--ink-muted)]">
            No sources yet. Add a transcript or note to start building evidence.
          </div>
        )}
      </section>
    </div>
  );
}
