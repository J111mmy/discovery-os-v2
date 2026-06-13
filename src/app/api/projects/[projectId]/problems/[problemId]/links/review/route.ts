import { getProjectForUser } from "@/lib/auth/org";
import { requireActiveAccess } from "@/lib/auth/access";
import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const ReviewStateSchema = z.enum(["suggested", "accepted", "edited", "rejected", "archived"]);
const ReviewActionSchema = z.enum(["accept", "reject"]);

const EvidenceLinkReviewSchema = z.object({
  link_type: z.literal("evidence"),
  target_id: z.string().uuid(),
  relationship: z.enum(["supporting", "contradicting", "example", "edge_case", "provenance"]),
  current_review_state: ReviewStateSchema,
  action: ReviewActionSchema,
});

const ThemeLinkReviewSchema = z.object({
  link_type: z.literal("theme"),
  target_id: z.string().uuid(),
  relationship: z.enum(["primary", "contributing", "provenance"]),
  current_review_state: ReviewStateSchema,
  action: ReviewActionSchema,
});

const ReviewLinkSchema = z.discriminatedUnion("link_type", [
  EvidenceLinkReviewSchema,
  ThemeLinkReviewSchema,
]);

type ReviewLinkInput = z.infer<typeof ReviewLinkSchema>;
type LinkType = ReviewLinkInput["link_type"];

const linkConfig = {
  evidence: {
    table: "problem_evidence",
    targetColumn: "evidence_id",
  },
  theme: {
    table: "problem_themes",
    targetColumn: "theme_id",
  },
} as const;

function nextReviewState(action: z.infer<typeof ReviewActionSchema>) {
  return action === "accept" ? "accepted" : "rejected";
}

function isArchivedState(value: z.infer<typeof ReviewStateSchema>) {
  return value === "archived";
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { projectId: string; problemId: string } }
) {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const access = await requireActiveAccess({ id: user.id, email: user.email });
  if (!access.ok) {
    return NextResponse.json(
      { error: access.error, access_status: access.status },
      { status: 403 }
    );
  }

  const parsed = ReviewLinkSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const project = await getProjectForUser<{ id: string; org_id: string }>(
    user.id,
    params.projectId,
    "id, org_id"
  );
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  if (isArchivedState(parsed.data.current_review_state)) {
    return NextResponse.json(
      { error: "Archived links cannot be reviewed from this surface." },
      { status: 409 }
    );
  }

  let link: Awaited<ReturnType<typeof updateReviewState>>;
  try {
    link = await updateReviewState({
      supabase,
      orgId: project.org_id,
      projectId: project.id,
      problemId: params.problemId,
      input: parsed.data,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to review problem link";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  if (link.status === "missing") {
    return NextResponse.json({ error: "Problem link not found" }, { status: 404 });
  }

  if (link.status === "conflict") {
    return NextResponse.json(
      {
        error: "Problem link was already reviewed. Refresh and try again.",
        current_review_state: link.currentReviewState,
      },
      { status: 409 }
    );
  }

  return NextResponse.json({ link: link.row });
}

async function updateReviewState({
  supabase,
  orgId,
  projectId,
  problemId,
  input,
}: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  orgId: string;
  projectId: string;
  problemId: string;
  input: ReviewLinkInput;
}): Promise<
  | { status: "updated"; row: Record<string, unknown> }
  | { status: "missing" }
  | { status: "conflict"; currentReviewState: string | null }
> {
  const config = linkConfig[input.link_type as LinkType];
  const updateResult = await supabase
    .from(config.table)
    .update({ review_state: nextReviewState(input.action) })
    .eq("org_id", orgId)
    .eq("project_id", projectId)
    .eq("problem_id", problemId)
    .eq(config.targetColumn, input.target_id)
    .eq("relationship", input.relationship)
    .eq("review_state", input.current_review_state)
    .select(
      [
        "org_id",
        "project_id",
        "problem_id",
        config.targetColumn,
        "relationship",
        "review_state",
        "rationale",
        "source",
        "agent_run_id",
        "created_at",
      ].join(", ")
    )
    .maybeSingle();

  if (updateResult.error) {
    throw new Error(`Failed to update problem ${input.link_type} review state: ${updateResult.error.message}`);
  }
  if (updateResult.data) {
    return { status: "updated", row: updateResult.data as unknown as Record<string, unknown> };
  }

  const currentResult = await supabase
    .from(config.table)
    .select("review_state")
    .eq("org_id", orgId)
    .eq("project_id", projectId)
    .eq("problem_id", problemId)
    .eq(config.targetColumn, input.target_id)
    .eq("relationship", input.relationship)
    .maybeSingle();

  if (currentResult.error) {
    throw new Error(`Failed to read problem ${input.link_type} review state: ${currentResult.error.message}`);
  }
  if (!currentResult.data) return { status: "missing" };

  return {
    status: "conflict",
    currentReviewState:
      typeof currentResult.data.review_state === "string"
        ? currentResult.data.review_state
        : null,
  };
}
