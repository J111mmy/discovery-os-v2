import { getProjectForUser } from "@/lib/auth/org";
import { getProjectOrgReadForUser } from "@/lib/auth/support-read";
import { createClient } from "@/lib/supabase/server";
import type { ArtifactType, ArtifactVerificationStatus } from "@/types/database";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

interface Props {
  params: { projectId: string };
}

type ArtifactRow = {
  id: string;
  org_id: string;
  project_id: string;
  type: ArtifactType;
  title: string;
  prompt: string;
  word_count: number | null;
  version: number;
  verification_status: ArtifactVerificationStatus;
  verification_summary: Record<string, unknown> | null;
  updated_at: string;
  created_at: string;
};

function dateLabel(value: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

function VerificationBadge({ status }: { status: ArtifactVerificationStatus }) {
  const classes =
    status === "verified"
      ? "border-pos/20 bg-pos-bg text-pos"
      : status === "partial"
      ? "border-warn/20 bg-warn-bg text-warn"
      : "border-[var(--line)] bg-[var(--surface-2)] text-[var(--ink-2)]";

  const label =
    status === "verified"
      ? "Verified"
      : status === "partial"
      ? "Partially verified"
      : "Unverified";

  return (
    <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${classes}`}>
      {label}
    </span>
  );
}

function ArtifactCard({
  artifact,
  projectId,
}: {
  artifact: ArtifactRow;
  projectId: string;
}) {
  return (
    <Link
      href={`/projects/${projectId}/documents/${artifact.id}`}
      className="group block"
    >
      <article className="flex h-full flex-col rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5 transition-all duration-150 group-hover:border-[var(--line-strong)] group-hover:bg-[var(--surface-hover)] group-hover:shadow-md">
        {/* Meta row */}
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <VerificationBadge status={artifact.verification_status} />
          <span className="text-xs text-[var(--ink-faint)]">v{artifact.version}</span>
          <span className="ml-auto text-xs text-[var(--ink-faint)]">{dateLabel(artifact.updated_at)}</span>
        </div>

        {/* Title */}
        <h3 className="mb-2 line-clamp-2 text-sm font-semibold leading-5 text-[var(--ink)] transition-colors group-hover:text-[var(--accent)]">
          {artifact.title}
        </h3>

        {/* Prompt snippet */}
        <p className="line-clamp-2 flex-1 text-xs leading-5 text-[var(--ink-2)]">
          {artifact.prompt}
        </p>

        {/* Footer — word count only */}
        <div className="mt-4 border-t border-[var(--line)] pt-4">
          <span className="text-xs text-[var(--ink-faint)]">{artifact.word_count ?? 0} words</span>
        </div>
      </article>
    </Link>
  );
}

export default async function DocumentsPage({ params }: Props) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const project = await getProjectForUser<{ id: string; org_id: string; name: string }>(
    user.id,
    params.projectId,
    "id, org_id, name"
  );

  if (!project) notFound();
  const read = await getProjectOrgReadForUser({
    userId: user.id,
    orgId: project.org_id,
    memberClient: supabase,
  });

  const { data } = await read
    .from("artifacts")
    .select("id, org_id, project_id, type, title, prompt, word_count, version, verification_status, verification_summary, updated_at, created_at")
    .eq("project_id", project.id)
    .order("updated_at", { ascending: false });

  const artifacts = (data ?? []) as ArtifactRow[];

  // Group by artifact type (preserving updated_at descending order within each group)
  const grouped = new Map<string, ArtifactRow[]>();
  artifacts.forEach((artifact) => {
    if (!grouped.has(artifact.type)) grouped.set(artifact.type, []);
    grouped.get(artifact.type)!.push(artifact);
  });

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="mb-2 text-xs font-medium uppercase tracking-wide text-[var(--ink-faint)]">
            Documents
          </div>
          <h1 className="text-2xl font-semibold text-[var(--ink)]">Artifact library</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--ink-2)]">
            Re-open generated drafts, continue editing, and keep the working document set tidy.
          </p>
        </div>
        <Link
          href={`/projects/${project.id}/compose`}
          className="inline-flex rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white transition-colors hover:opacity-90"
        >
          New draft
        </Link>
      </div>

      {artifacts.length === 0 ? (
        <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-12 text-center">
          <div className="text-sm font-medium text-[var(--ink)]">No documents yet</div>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[var(--ink-2)]">
            Draft from trusted evidence and saved artifacts will appear here.
          </p>
          <Link
            href={`/projects/${project.id}/compose`}
            className="mt-5 inline-flex rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white transition-colors hover:opacity-90"
          >
            Draft your first document →
          </Link>
        </div>
      ) : (
        <div className="space-y-10">
          {Array.from(grouped.entries()).map(([type, group]: [string, ArtifactRow[]]) => (
            <section key={type}>
              <div className="mb-4 text-xs font-medium uppercase tracking-wide text-[var(--ink-faint)]">
                <span className="capitalize">{type}</span>
                <span className="ml-2 text-[var(--ink-faint)]">· {group.length}</span>
              </div>
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {group.map((artifact: ArtifactRow) => (
                  <ArtifactCard key={artifact.id} artifact={artifact} projectId={project.id} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
