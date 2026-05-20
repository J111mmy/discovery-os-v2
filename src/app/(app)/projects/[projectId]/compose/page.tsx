import { getProjectForUser } from "@/lib/auth/org";
import { createClient } from "@/lib/supabase/server";
import { notFound, redirect } from "next/navigation";
import { ComposeEditor } from "./compose-editor";

interface Props {
  params: { projectId: string };
}

export default async function ComposePage({ params }: Props) {
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
    <div className="mx-auto max-w-6xl">
      <div className="mb-8">
        <div className="mb-2 text-xs font-medium uppercase tracking-wide text-[var(--ink-faint)]">
          Compose
        </div>
        <h1 className="text-2xl font-semibold text-[var(--ink)]">Draft from trusted evidence</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--ink-muted)]">
          Ask for a persona, PRD, opportunity brief, or GTM draft. The editor keeps the generated sections editable before you save.
        </p>
      </div>

      <ComposeEditor projectId={project.id} />
    </div>
  );
}
