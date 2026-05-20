import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { NewProjectForm } from "./new-project-form";

export default async function NewProjectPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  return (
    <div className="min-h-screen bg-[var(--surface-0)] p-8">
      <div className="mx-auto max-w-2xl">
        <Link
          href="/projects"
          className="mb-4 block text-xs text-[var(--ink-muted)] transition-colors hover:text-[var(--ink)]"
        >
          Back to projects
        </Link>

        <div className="mb-8">
          <h1 className="text-xl font-semibold text-[var(--ink)]">New project</h1>
          <p className="mt-1 text-sm text-[var(--ink-muted)]">
            Create a workspace for evidence, synthesis, and artifacts.
          </p>
        </div>

        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-1)] p-6">
          <NewProjectForm />
        </div>
      </div>
    </div>
  );
}
