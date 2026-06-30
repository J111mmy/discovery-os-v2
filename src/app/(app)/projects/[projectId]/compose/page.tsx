import { getProjectForUser } from "@/lib/auth/org";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ComposeEditor } from "./compose-editor";

interface Props {
  params: { projectId: string };
  searchParams?: { artifactId?: string };
}

export default async function ComposePage({ params, searchParams }: Props) {
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

  if (searchParams?.artifactId) {
    redirect(`/projects/${project.id}/documents/${encodeURIComponent(searchParams.artifactId)}`);
  }

  return (
    <div className="mx-auto max-w-6xl">
      {/* Studio chrome header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          marginBottom: 24,
          paddingBottom: 16,
          borderBottom: "1px solid var(--line)",
        }}
      >
        <Link
          href={`/projects/${project.id}/documents`}
          className="inline-flex items-center gap-1 text-xs font-medium text-[var(--ink-2)] no-underline transition-colors hover:text-[var(--ink)]"
        >
          <svg
            width="13"
            height="13"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M10 4L6 8l4 4" />
          </svg>
          Artifact library
        </Link>
        <span style={{ color: "var(--line)", userSelect: "none" }}>·</span>
        <span style={{ fontSize: 12, color: "var(--ink-faint)" }}>{project.name}</span>
        <div style={{ flex: 1 }} />
        <span
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: "var(--ink)",
            letterSpacing: "0.02em",
            textTransform: "uppercase",
          }}
        >
          Compose
        </span>
      </div>

      <ComposeEditor projectId={project.id} />
    </div>
  );
}
