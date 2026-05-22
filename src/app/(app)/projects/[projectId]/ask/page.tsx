import { getProjectForUser } from "@/lib/auth/org";
import { createClient } from "@/lib/supabase/server";
import { notFound, redirect } from "next/navigation";
import { AskInterface } from "./ask-interface";

interface Props {
  params: { projectId: string };
}

export default async function AskPage({ params }: Props) {
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

  return <AskInterface projectId={project.id} projectName={project.name} />;
}
