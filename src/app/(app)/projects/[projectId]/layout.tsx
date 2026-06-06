import { getProjectForUser } from "@/lib/auth/org";
import { createClient } from "@/lib/supabase/server";
import { notFound, redirect } from "next/navigation";

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

  // Project nav lives in the global rail (expandable project box).
  // No secondary sidebar needed here.
  return (
    <main className="min-w-0 px-5 py-6 sm:px-8 lg:px-10 lg:py-8">
      {children}
    </main>
  );
}
