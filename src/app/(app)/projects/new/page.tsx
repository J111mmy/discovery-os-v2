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
    <div className="min-h-screen bg-[var(--bg)] p-8">
      <div className="mx-auto max-w-2xl">
        <Link
          href="/projects"
          className="mb-4 block text-xs text-[var(--ink-2)] transition-colors hover:text-[var(--ink)]"
        >
          Back to projects
        </Link>

        <div className="mb-8">
          <h1 className="text-xl font-semibold text-[var(--ink)]">New project</h1>
          <p className="mt-1 text-sm text-[var(--ink-2)]">
            Create a workspace for evidence, synthesis, and artifacts.
          </p>
        </div>

        <div className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-6">
          <NewProjectForm />
        </div>
      </div>
    </div>
  );
}
