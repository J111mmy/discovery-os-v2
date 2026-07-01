// GET /api/artifacts/[id]/status
// Polling endpoint for async artifact generation (compose via Inngest).
// Returns compose_status and the document location once the draft is ready.
// Security: artifact query is scoped to the user's org_id — prevents cross-org access by UUID guessing.
import { NextRequest, NextResponse } from "next/server";
import { getOrgScopedReadForUser } from "@/lib/auth/support-read";
import { createClient } from "@/lib/supabase/server";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const read = await getOrgScopedReadForUser(user.id, supabase);

  if (!read) {
    return NextResponse.json({ error: "No org" }, { status: 403 });
  }

  const { data: artifact, error } = await read
    .from("artifacts")
    .select("id, org_id, project_id, title, content_html, model_used, task_tier, metadata")
    .eq("id", params.id)
    .single();

  if (error || !artifact) {
    return NextResponse.json({ error: "Artifact not found" }, { status: 404 });
  }

  const meta = (artifact.metadata ?? {}) as Record<string, unknown>;
  const composeStatus = (meta.compose_status as string | undefined) ?? "done";

  if (composeStatus === "pending") {
    return NextResponse.json({ status: "pending" });
  }

  if (composeStatus === "failed") {
    const errorCode = meta.compose_error_code as string | undefined;
    return NextResponse.json({
      status: "failed",
      error: (meta.compose_error as string | undefined) ?? "Compose failed — please try again.",
      error_code: errorCode ?? "compose_failed",
      cta_href:
        errorCode === "needs_synthesis" ? `/projects/${artifact.project_id}` : undefined,
      cta_label: errorCode === "needs_synthesis" ? "Open workspace" : undefined,
    });
  }

  // Done — the document reader is the canonical flowing surface.
  const contentHtmlReady =
    typeof artifact.content_html === "string" && artifact.content_html.trim().length > 0;
  const evidenceIds = Array.isArray(meta.evidence_ids) ? (meta.evidence_ids as string[]) : [];

  return NextResponse.json({
    status: "done",
    artifact_id: artifact.id,
    title: artifact.title,
    document_href: `/projects/${artifact.project_id}/documents/${artifact.id}`,
    content_html_ready: contentHtmlReady,
    model_used: artifact.model_used ?? null,
    task_tier: artifact.task_tier ?? null,
    evidence_ids: evidenceIds,
  });
}
