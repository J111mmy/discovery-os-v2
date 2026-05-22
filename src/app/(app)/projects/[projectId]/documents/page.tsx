import { getProjectForUser } from "@/lib/auth/org";
import { createClient } from "@/lib/supabase/server";
import type { ArtifactType, ArtifactVerificationStatus } from "@/types/database";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { deleteArtifactAction } from "./actions";

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
      ? "border-green-500/20 bg-green-500/10 text-green-300"
      : status === "partial"
      ? "border-yellow-500/20 bg-yellow-500/10 text-yellow-300"
      : "border-[var(--border)] bg-[var(--surface-2)] text-[var(--ink-muted)]";

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

  const { data } = await supabase
    .from("artifacts")
    .select("id, org_id, project_id, type, title, prompt, word_count, version, verification_status, verification_summary, updated_at, created_at")
    .eq("org_id", project.org_id)
    .eq("project_id", project.id)
    .order("updated_at", { ascending: false });

  const artifacts = (data ?? []) as ArtifactRow[];

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="mb-2 text-xs font-medium uppercase tracking-wide text-[var(--ink-faint)]">
            Documents
          </div>
          <h1 className="text-2xl font-semibold text-[var(--ink)]">Artifact library</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--ink-muted)]">
            Re-open generated drafts, continue editing, and keep the working document set tidy.
          </p>
        </div>
        <Link
          href={`/projects/${project.id}/compose`}
          className="inline-flex rounded-lg bg-[var(--brand)] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[var(--brand-dim)]"
        >
          New draft
        </Link>
      </div>

      {artifacts.length === 0 ? (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-1)] p-12 text-center">
          <div className="text-sm font-medium text-[var(--ink)]">No documents yet</div>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[var(--ink-muted)]">
            Draft from trusted evidence and saved artifacts will appear here.
          </p>
        </div>
      ) : (
        <div className="grid gap-3">
          {artifacts.map((artifact) => (
            <article
              key={artifact.id}
              className="rounded-xl border border-[var(--border)] bg-[var(--surface-1)] p-5"
            >
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <span className="rounded-full border border-[var(--border)] bg-[var(--surface-2)] px-2 py-0.5 text-xs font-medium capitalize text-[var(--ink-muted)]">
                      {artifact.type}
                    </span>
                    <VerificationBadge status={artifact.verification_status} />
                    <span className="text-xs text-[var(--ink-faint)]">v{artifact.version}</span>
                    <span className="text-xs text-[var(--ink-faint)]">{dateLabel(artifact.updated_at)}</span>
                  </div>
                  <Link
                    href={`/projects/${project.id}/compose?artifactId=${artifact.id}`}
                    className="text-base font-semibold text-[var(--ink)] transition-colors hover:text-[var(--brand)]"
                  >
                    {artifact.title}
                  </Link>
                  <div className="mt-2 max-w-3xl truncate text-sm text-[var(--ink-muted)]">
                    {artifact.prompt}
                  </div>
                  <div className="mt-3 text-xs text-[var(--ink-muted)]">
                    {artifact.word_count ?? 0} words
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Link
                    href={`/projects/${project.id}/compose?artifactId=${artifact.id}`}
                    className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-medium text-[var(--ink)] transition-colors hover:border-[var(--brand)] hover:text-[var(--brand)]"
                  >
                    Open
                  </Link>
                  <form action={deleteArtifactAction}>
                    <input type="hidden" name="project_id" value={project.id} />
                    <input type="hidden" name="artifact_id" value={artifact.id} />
                    <button
                      type="submit"
                      className="rounded-lg border border-red-500/20 px-3 py-1.5 text-xs font-medium text-red-300 transition-colors hover:border-red-400"
                    >
                      Delete
                    </button>
                  </form>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
