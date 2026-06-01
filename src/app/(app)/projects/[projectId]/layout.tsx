import { getProjectForUser } from "@/lib/auth/org";
import { createClient } from "@/lib/supabase/server";
import { notFound, redirect } from "next/navigation";
import { ProjectMobileDrawer } from "./project-mobile-drawer";
import { ProjectSidebar } from "./project-sidebar";

interface ProjectLayoutProps {
  children: React.ReactNode;
  params: { projectId: string };
}

export default async function ProjectLayout({
  children,
  params,
}: ProjectLayoutProps) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const project = await getProjectForUser<{
    id: string;
    org_id: string;
    name: string;
    description: string | null;
  }>(user.id, params.projectId, "id, org_id, name, description");

  if (!project) notFound();

  return (
    <div className="min-h-screen bg-[var(--surface-0)] text-[var(--ink)]">
      <div className="grid min-h-screen lg:grid-cols-[260px_minmax(0,1fr)]">
        <div className="hidden lg:block lg:sticky lg:top-14 lg:h-[calc(100vh-3.5rem)] lg:self-start lg:overflow-y-auto">
          <ProjectSidebar
            projectId={project.id}
            projectName={project.name}
            projectDescription={project.description}
          />
        </div>

        <ProjectMobileDrawer
          projectId={project.id}
          projectName={project.name}
          projectDescription={project.description}
        />

        <main className="min-w-0 px-5 py-6 sm:px-8 lg:px-10 lg:py-8">
          {children}
        </main>
      </div>
    </div>
  );
}
