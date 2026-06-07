import { getProjectForUser } from "@/lib/auth/org";
import { createClient } from "@/lib/supabase/server";
import { notFound, redirect } from "next/navigation";
import { IngestForm } from "./ingest-form";

interface Props {
  params: { projectId: string };
}

export default async function IngestPage({ params }: Props) {
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

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-8">
        <div className="mb-2 text-xs font-medium uppercase tracking-wide text-[var(--ink-faint)]">
          Add evidence
        </div>
        <h1 className="text-2xl font-semibold text-[var(--ink)]">Submit source material</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--ink-2)]">
          Paste a transcript, document, or research note. DiscOS will segment it, redact sensitive details, and create evidence records for review.
        </p>
      </div>

      <IngestForm projectId={project.id} />
    </div>
  );
}
