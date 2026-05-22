"use server";

import { getProjectForUser } from "@/lib/auth/org";
import { createClient } from "@/lib/supabase/server";
import type { ArtifactVerificationStatus } from "@/types/database";
import { redirect } from "next/navigation";

export type ArtifactVerificationState = {
  status: ArtifactVerificationStatus;
  runAt: string | null;
  summary: Record<string, unknown> | null;
};

export async function getArtifactVerificationStatusAction(
  projectId: string,
  artifactId: string
): Promise<ArtifactVerificationState | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");
  if (!projectId || !artifactId) return null;

  const project = await getProjectForUser<{ id: string; org_id: string }>(
    user.id,
    projectId,
    "id, org_id"
  );

  if (!project) return null;

  const { data } = await supabase
    .from("artifacts")
    .select("verification_status, verification_run_at, verification_summary")
    .eq("org_id", project.org_id)
    .eq("project_id", project.id)
    .eq("id", artifactId)
    .single();

  if (!data) return null;

  return {
    status: (data.verification_status ?? "unverified") as ArtifactVerificationStatus,
    runAt: (data.verification_run_at as string | null) ?? null,
    summary: (data.verification_summary as Record<string, unknown> | null) ?? null,
  };
}
