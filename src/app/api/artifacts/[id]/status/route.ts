// GET /api/artifacts/[id]/status
// Polling endpoint for async artifact generation (compose via Inngest).
// Returns compose_status and parsed sections once the draft is ready.
// Security: artifact query is scoped to the user's org_id — prevents cross-org access by UUID guessing.
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

function parseMarkdownSections(markdown: string): Array<{ heading: string; content: string }> {
  const lines = markdown.split("\n");
  const sections: Array<{ heading: string; content: string }> = [];
  let currentHeading = "";
  let currentContent: string[] = [];

  for (const line of lines) {
    if (line.startsWith("## ")) {
      if (currentHeading) {
        sections.push({ heading: currentHeading, content: currentContent.join("\n").trim() });
      }
      currentHeading = line.replace(/^##\s+/, "").trim();
      currentContent = [];
    } else if (!line.startsWith("# ")) {
      currentContent.push(line);
    }
  }

  if (currentHeading) {
    sections.push({ heading: currentHeading, content: currentContent.join("\n").trim() });
  }

  return sections;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Resolve user's org — required to scope the artifact query
  const { data: membership } = await supabase
    .from("org_members")
    .select("org_id")
    .eq("user_id", user.id)
    .order("joined_at", { ascending: true })
    .limit(1)
    .single();

  if (!membership?.org_id) {
    return NextResponse.json({ error: "No org" }, { status: 403 });
  }

  const { data: artifact, error } = await supabase
    .from("artifacts")
    .select("id, org_id, project_id, title, content_md, model_used, task_tier, metadata")
    .eq("id", params.id)
    .eq("org_id", membership.org_id)
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
    return NextResponse.json({
      status: "failed",
      error: (meta.compose_error as string | undefined) ?? "Compose failed — please try again.",
    });
  }

  // Done — parse and return the full draft
  const sections = parseMarkdownSections(artifact.content_md ?? "");
  const evidenceIds = Array.isArray(meta.evidence_ids) ? (meta.evidence_ids as string[]) : [];

  return NextResponse.json({
    status: "done",
    artifact_id: artifact.id,
    title: artifact.title,
    sections,
    model_used: artifact.model_used ?? null,
    task_tier: artifact.task_tier ?? null,
    evidence_ids: evidenceIds,
  });
}
