// GET /api/agent-runs
// Returns agent_runs scoped to the user's org.
//
// Query params (all optional, combinable):
//   source_id  — filter to runs whose input.source_id matches
//   project_id — filter to runs whose project_id matches
//   limit      — max records to return (default 50, max 200)
//
// Response shape:
//   { runs: AgentRunSummary[] }
//
// AgentRunSummary adds:
//   source_id      — extracted from input.source_id if present
//   duration_ms    — computed from started_at / completed_at
//   output_summary — human-readable one-liner from output fields

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { AgentRun } from "@/types/database";

export type AgentRunSummary = {
  id: string;
  agent_type: string;
  status: "running" | "completed" | "failed";
  project_id: string | null;
  source_id: string | null;
  started_at: string;
  completed_at: string | null;
  duration_ms: number | null;
  model_used: string | null;
  output_summary: string | null;
  error: string | null;
};

// Produces a short human-readable summary from the output jsonb field.
// Each agent stores different keys — we surface the most useful one.
function buildOutputSummary(
  agentType: string,
  output: Record<string, unknown> | null,
  status: string
): string | null {
  if (status === "failed") return null;
  if (!output) return null;

  if (output.skipped === true) {
    const reason = typeof output.reason === "string" ? output.reason : "insufficient evidence";
    return `Skipped — ${reason.replace(/_/g, " ")}`;
  }

  switch (agentType) {
    case "entity-extraction": {
      const parts: string[] = [];
      if (typeof output.people_count === "number") parts.push(`${output.people_count} people`);
      if (typeof output.companies_count === "number") parts.push(`${output.companies_count} companies`);
      if (typeof output.competitors_count === "number") parts.push(`${output.competitors_count} competitors`);
      return parts.length > 0 ? parts.join(", ") + " extracted" : "Entities extracted";
    }
    case "session-review":
      return output.artifact_id ? "Session brief generated" : "Session brief generated";
    case "action-extraction": {
      const actions = typeof output.actions_inserted === "number" ? output.actions_inserted : 0;
      const requests = typeof output.requests_inserted === "number" ? output.requests_inserted : 0;
      return `${actions} action${actions !== 1 ? "s" : ""}, ${requests} product request${requests !== 1 ? "s" : ""}`;
    }
    case "project-synthesis": {
      const themes = typeof output.theme_count === "number" ? output.theme_count : null;
      return themes !== null ? `${themes} themes synthesised` : "Project synthesised";
    }
    case "problem-discovery": {
      const problems = typeof output.problem_count === "number" ? output.problem_count : null;
      return problems !== null ? `${problems} problems found` : "Problems discovered";
    }
    case "gap-detection":
      return typeof output.gap_count === "number"
        ? `${output.gap_count} research gaps detected`
        : "Gaps detected";
    case "frame-draft":
      return "Frame draft generated";
    case "person-digest": {
      const len = typeof output.digest_length === "number" ? output.digest_length : null;
      return len ? `Brief generated (${Math.round(len / 5)} words)` : "Person brief generated";
    }
    case "company-digest": {
      const len = typeof output.digest_length === "number" ? output.digest_length : null;
      return len ? `Brief generated (${Math.round(len / 5)} words)` : "Company brief generated";
    }
    case "competitor-digest": {
      const ev = typeof output.evidence_count === "number" ? output.evidence_count : null;
      return ev !== null ? `Digest generated from ${ev} evidence record${ev !== 1 ? "s" : ""}` : "Competitor digest generated";
    }
    case "claim-verification":
      return typeof output.claims_checked === "number"
        ? `${output.claims_checked} claims verified`
        : "Claims verified";
    case "compose":
      return "Artifact composed";
    default:
      return "Completed";
  }
}

function summarise(run: AgentRun): AgentRunSummary {
  const sourceId =
    run.input && typeof run.input.source_id === "string" ? run.input.source_id : null;

  const durationMs =
    run.completed_at && run.started_at
      ? new Date(run.completed_at).getTime() - new Date(run.started_at).getTime()
      : null;

  return {
    id: run.id,
    agent_type: run.agent_type,
    status: run.status,
    project_id: run.project_id,
    source_id: sourceId,
    started_at: run.started_at,
    completed_at: run.completed_at,
    duration_ms: durationMs,
    model_used: run.model_used,
    output_summary: buildOutputSummary(run.agent_type, run.output, run.status),
    error: run.error,
  };
}

const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 50;

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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

  const { searchParams } = new URL(req.url);
  const sourceId = searchParams.get("source_id");
  const projectId = searchParams.get("project_id");
  const rawLimit = parseInt(searchParams.get("limit") ?? String(DEFAULT_LIMIT), 10);
  const limit = Math.min(isNaN(rawLimit) ? DEFAULT_LIMIT : rawLimit, MAX_LIMIT);

  let query = supabase
    .from("agent_runs")
    .select("id, org_id, project_id, agent_type, status, input, output, error, model_used, started_at, completed_at")
    .eq("org_id", membership.org_id)
    .order("started_at", { ascending: false })
    .limit(limit);

  if (sourceId) {
    query = query.contains("input", { source_id: sourceId });
  }

  if (projectId) {
    query = query.eq("project_id", projectId);
  }

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const runs = ((data ?? []) as AgentRun[]).map(summarise);

  return NextResponse.json({ runs });
}
