// Outcome assessment — cached, user-triggered assessment of whether a project
// can satisfy its stated outcome. Never auto-runs from ingest or synthesis.

import { z } from "zod";
import { inngest } from "../client";
import { createServiceClient } from "@/lib/supabase/server";
import { callLLM } from "@/lib/llm/client";
import {
  buildOutcomeAssessmentPrompt,
  OUTCOME_ASSESSMENT_PROMPT_VERSION,
} from "@/lib/llm/prompts/outcome-assessment";

const OUTCOME_ASSESSMENT_TIMEOUT_MS = 50_000;

const GapToOutcomeSchema = z.object({
  gap: z.string().trim().min(1).max(240),
  why_it_matters: z.string().trim().min(1).max(420),
  severity: z.enum(["high", "medium", "low"]).default("medium"),
});

const NextActionSchema = z.object({
  action: z.string().trim().min(1).max(240),
  priority: z.enum(["high", "medium", "low"]).default("medium"),
  rationale: z.string().trim().min(1).max(420),
});

const GeneratableArtifactSchema = z.object({
  artifact_type: z.string().trim().min(1).max(120),
  purpose: z.string().trim().min(1).max(360),
  readiness: z.enum(["ready", "needs_more_evidence", "not_ready"]).default("needs_more_evidence"),
});

const OutcomeAssessmentSchema = z.object({
  outcome_status: z.enum(["met", "on_track", "blocked"]),
  rationale: z.string().trim().min(1).max(1200),
  gaps_to_outcome: z.array(GapToOutcomeSchema).max(5).default([]),
  next_actions: z.array(NextActionSchema).max(6).default([]),
  generatable_artifacts: z.array(GeneratableArtifactSchema).max(6).default([]),
});

type OutcomeAssessment = z.infer<typeof OutcomeAssessmentSchema>;

type ProjectRow = {
  id: string;
  name: string;
  frame: string | null;
  frame_data: Record<string, unknown> | null;
  gap_signals: unknown;
  gaps_detected_at: string | null;
  synthesis_stale: boolean | null;
  last_synthesised_at: string | null;
};

type ProblemSummaryRow = {
  id: string;
  title: string;
  status: string;
  severity: string | null;
  confidence: string | null;
  who_affected: string | null;
  why_it_matters: string | null;
  source_evidence_ids: string[] | null;
};

type ThemeSummaryRow = {
  id: string;
  label: string;
  description: string | null;
  evidence_count: number | null;
};

type OpportunitySummaryRow = {
  id: string;
  title: string;
  description: string | null;
  how_might_we: string | null;
  status: string;
  confidence: string | null;
  review_state: string;
};

type ProjectSummary = {
  project: ProjectRow;
  counts: {
    sources: number;
    evidence: number;
    trusted_evidence: number;
    pending_evidence: number;
    themes: number;
    active_problems: number;
    opportunities: number;
    artifacts: number;
  };
  topProblems: ProblemSummaryRow[];
  topThemes: ThemeSummaryRow[];
  topOpportunities: OpportunitySummaryRow[];
};

function extractJsonObject(content: string) {
  const unfenced = content
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  const start = unfenced.indexOf("{");
  const end = unfenced.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("Outcome assessment did not return a JSON object");
  }
  return JSON.parse(unfenced.slice(start, end + 1)) as unknown;
}

function truncate(value: string | null | undefined, max = 700) {
  const text = value?.trim() ?? "";
  if (!text) return "";
  return text.length <= max ? text : `${text.slice(0, max - 1)}...`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringField(record: Record<string, unknown> | null, key: string) {
  const value = record?.[key];
  return typeof value === "string" ? value.trim() : "";
}

function formatFrame(project: ProjectRow) {
  const frameData = asRecord(project.frame_data);
  const researchContext = asRecord(frameData?.research_context);
  const fields = [
    ["Goal", stringField(researchContext, "goals") || stringField(frameData, "goals")],
    ["Audience / buyers", stringField(researchContext, "buyers") || stringField(frameData, "buyers")],
    ["Desired outcome", stringField(researchContext, "outcomes") || stringField(frameData, "outcomes")],
    ["Scope in", stringField(researchContext, "scope_in")],
    ["Scope out", stringField(researchContext, "scope_out")],
  ].filter(([, value]) => Boolean(value));

  const structured = fields.map(([label, value]) => `- ${label}: ${truncate(value, 260)}`).join("\n");
  const frame = truncate(project.frame, 900);

  if (structured && frame) return `${structured}\n\nFrame text:\n${frame}`;
  if (structured) return structured;
  if (frame) return frame;
  return "No project frame or explicit outcome set.";
}

function formatGapSignals(value: unknown) {
  if (!Array.isArray(value) || value.length === 0) return "No cached gap-detection output.";
  return value
    .slice(0, 8)
    .map((gap, index) => {
      const record = asRecord(gap);
      if (!record) return `${index + 1}. ${truncate(String(gap), 260)}`;
      const area = stringField(record, "area") || `Gap ${index + 1}`;
      const description = stringField(record, "description");
      const severity = stringField(record, "severity");
      const action = stringField(record, "suggested_action");
      return [
        `${index + 1}. ${area}${severity ? ` (${severity})` : ""}`,
        description ? `   Description: ${truncate(description, 240)}` : null,
        action ? `   Suggested action: ${truncate(action, 200)}` : null,
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n");
}

function formatProblems(problems: ProblemSummaryRow[]) {
  if (problems.length === 0) return "No active/acknowledged/surfaced problems.";
  return problems
    .map((problem, index) => {
      const evidenceCount = problem.source_evidence_ids?.length ?? 0;
      return [
        `${index + 1}. ${problem.title}`,
        `   Status: ${problem.status}; severity: ${problem.severity ?? "unknown"}; confidence: ${
          problem.confidence ?? "unknown"
        }; evidence ids: ${evidenceCount}`,
        problem.who_affected ? `   Who: ${truncate(problem.who_affected, 180)}` : null,
        problem.why_it_matters ? `   Why it matters: ${truncate(problem.why_it_matters, 220)}` : null,
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n");
}

function formatThemes(themes: ThemeSummaryRow[]) {
  if (themes.length === 0) return "No themes.";
  return themes
    .map(
      (theme, index) =>
        `${index + 1}. ${theme.label} (${theme.evidence_count ?? 0} evidence)${
          theme.description ? `: ${truncate(theme.description, 260)}` : ""
        }`
    )
    .join("\n");
}

function formatOpportunities(opportunities: OpportunitySummaryRow[]) {
  if (opportunities.length === 0) return "No product opportunities generated yet.";
  return opportunities
    .map((opportunity, index) =>
      [
        `${index + 1}. ${opportunity.title}`,
        `   Status: ${opportunity.status}; review_state: ${opportunity.review_state}; confidence: ${
          opportunity.confidence ?? "unknown"
        }`,
        opportunity.how_might_we ? `   HMW: ${truncate(opportunity.how_might_we, 220)}` : null,
        opportunity.description ? `   Description: ${truncate(opportunity.description, 260)}` : null,
      ]
        .filter(Boolean)
        .join("\n")
    )
    .join("\n");
}

function formatProjectSummary(summary: ProjectSummary) {
  return `
PROJECT:
- Name: ${summary.project.name}
- Synthesis stale: ${summary.project.synthesis_stale ? "yes" : "no"}
- Last synthesised at: ${summary.project.last_synthesised_at ?? "never"}
- Gaps detected at: ${summary.project.gaps_detected_at ?? "never"}

FRAME / AUDIENCE / OUTCOME:
${formatFrame(summary.project)}

COUNTS:
- Sources: ${summary.counts.sources}
- Evidence: ${summary.counts.evidence} (${summary.counts.trusted_evidence} trusted, ${summary.counts.pending_evidence} pending)
- Themes: ${summary.counts.themes}
- Active problems: ${summary.counts.active_problems}
- Product opportunities: ${summary.counts.opportunities}
- Artifacts: ${summary.counts.artifacts}

TOP PROBLEMS:
${formatProblems(summary.topProblems)}

TOP THEMES:
${formatThemes(summary.topThemes)}

TOP PRODUCT OPPORTUNITIES:
${formatOpportunities(summary.topOpportunities)}

LATEST DETECT-GAPS OUTPUT:
${formatGapSignals(summary.project.gap_signals)}
`.trim();
}

function deterministicEmptyAssessment(summary: ProjectSummary): OutcomeAssessment | null {
  const hasFrame = Boolean(summary.project.frame?.trim()) || Boolean(summary.project.frame_data);
  const hasDiscoveryData =
    summary.counts.evidence > 0 ||
    summary.counts.themes > 0 ||
    summary.counts.active_problems > 0 ||
    summary.counts.opportunities > 0;

  if (hasFrame || hasDiscoveryData) return null;

  return {
    outcome_status: "blocked",
    rationale:
      "The project does not yet have a frame, evidence, themes, problems, or opportunities. It cannot credibly be assessed against an outcome until the desired outcome and first evidence are added.",
    gaps_to_outcome: [
      {
        gap: "No project frame or outcome is set",
        why_it_matters: "The system has no target to assess progress against.",
        severity: "high",
      },
      {
        gap: "No evidence has been ingested",
        why_it_matters: "The system cannot distinguish a real user problem from an assumption.",
        severity: "high",
      },
    ],
    next_actions: [
      {
        action: "Set the project frame with the target audience, problem, and desired decision/outcome",
        priority: "high",
        rationale: "Outcome assessment needs a clear target before readiness can be judged.",
      },
      {
        action: "Ingest the first source of customer or market evidence",
        priority: "high",
        rationale: "Evidence is required before problems, gaps, or artifacts can be trusted.",
      },
    ],
    generatable_artifacts: [],
  };
}

export const assessOutcome = inngest.createFunction(
  {
    id: "assess-outcome",
    name: "Assess Outcome",
    retries: 1,
    concurrency: { limit: 1, key: "event.data.project_id" },
  },
  { event: "project/outcome.assess.requested" },
  async ({ event, step }) => {
    const { org_id, project_id } = event.data;
    const supabase = createServiceClient();
    let agentRunId: string | null = null;

    try {
      agentRunId = await step.run("start-agent-run", async () => {
        const { data, error } = await supabase
          .from("agent_runs")
          .insert({
            org_id,
            project_id,
            agent_type: "outcome-assessment",
            input: {
              prompt_version: OUTCOME_ASSESSMENT_PROMPT_VERSION,
              timeout_ms: OUTCOME_ASSESSMENT_TIMEOUT_MS,
              trigger: "user_action",
            },
          })
          .select("id")
          .single();

        if (error || !data) {
          throw new Error(`Failed to start outcome assessment run: ${error?.message}`);
        }
        return data.id as string;
      });

      const summary = await step.run("fetch-summary", async (): Promise<ProjectSummary> => {
        const [
          projectResult,
          sourcesResult,
          evidenceResult,
          trustedEvidenceResult,
          pendingEvidenceResult,
          themesCountResult,
          problemsCountResult,
          opportunitiesCountResult,
          artifactsResult,
          topProblemsResult,
          topThemesResult,
          topOpportunitiesResult,
        ] = await Promise.all([
          supabase
            .from("projects")
            .select(
              "id, name, frame, frame_data, gap_signals, gaps_detected_at, synthesis_stale, last_synthesised_at"
            )
            .eq("org_id", org_id)
            .eq("id", project_id)
            .single(),
          supabase
            .from("sources")
            .select("*", { count: "exact", head: true })
            .eq("org_id", org_id)
            .eq("project_id", project_id),
          supabase
            .from("evidence")
            .select("*", { count: "exact", head: true })
            .eq("org_id", org_id)
            .eq("project_id", project_id),
          supabase
            .from("evidence")
            .select("*", { count: "exact", head: true })
            .eq("org_id", org_id)
            .eq("project_id", project_id)
            .eq("trust_scope", "trusted"),
          supabase
            .from("evidence")
            .select("*", { count: "exact", head: true })
            .eq("org_id", org_id)
            .eq("project_id", project_id)
            .eq("trust_scope", "pending"),
          supabase
            .from("themes")
            .select("*", { count: "exact", head: true })
            .eq("org_id", org_id)
            .eq("project_id", project_id),
          supabase
            .from("problems")
            .select("*", { count: "exact", head: true })
            .eq("org_id", org_id)
            .eq("project_id", project_id)
            .in("status", ["surfaced", "acknowledged", "active"])
            .neq("review_state", "rejected"),
          supabase
            .from("opportunities")
            .select("*", { count: "exact", head: true })
            .eq("org_id", org_id)
            .eq("project_id", project_id)
            .not("status", "in", '("dismissed","archived")')
            .not("review_state", "in", '("rejected","archived")'),
          supabase
            .from("artifacts")
            .select("*", { count: "exact", head: true })
            .eq("org_id", org_id)
            .eq("project_id", project_id),
          supabase
            .from("problems")
            .select(
              "id, title, status, severity, confidence, who_affected, why_it_matters, source_evidence_ids"
            )
            .eq("org_id", org_id)
            .eq("project_id", project_id)
            .in("status", ["surfaced", "acknowledged", "active"])
            .neq("review_state", "rejected")
            .order("created_at", { ascending: false })
            .limit(8),
          supabase
            .from("themes")
            .select("id, label, description, evidence_count")
            .eq("org_id", org_id)
            .eq("project_id", project_id)
            .order("evidence_count", { ascending: false })
            .limit(8),
          supabase
            .from("opportunities")
            .select("id, title, description, how_might_we, status, confidence, review_state")
            .eq("org_id", org_id)
            .eq("project_id", project_id)
            .not("status", "in", '("dismissed","archived")')
            .not("review_state", "in", '("rejected","archived")')
            .order("updated_at", { ascending: false })
            .limit(8),
        ]);

        if (projectResult.error || !projectResult.data) {
          throw new Error(`Failed to fetch project: ${projectResult.error?.message}`);
        }

        const queryErrors = [
          sourcesResult.error,
          evidenceResult.error,
          trustedEvidenceResult.error,
          pendingEvidenceResult.error,
          themesCountResult.error,
          problemsCountResult.error,
          opportunitiesCountResult.error,
          artifactsResult.error,
          topProblemsResult.error,
          topThemesResult.error,
          topOpportunitiesResult.error,
        ].filter(Boolean);

        if (queryErrors.length > 0) {
          throw new Error(`Failed to fetch outcome assessment summary: ${queryErrors[0]?.message}`);
        }

        return {
          project: projectResult.data as ProjectRow,
          counts: {
            sources: sourcesResult.count ?? 0,
            evidence: evidenceResult.count ?? 0,
            trusted_evidence: trustedEvidenceResult.count ?? 0,
            pending_evidence: pendingEvidenceResult.count ?? 0,
            themes: themesCountResult.count ?? 0,
            active_problems: problemsCountResult.count ?? 0,
            opportunities: opportunitiesCountResult.count ?? 0,
            artifacts: artifactsResult.count ?? 0,
          },
          topProblems: (topProblemsResult.data ?? []) as ProblemSummaryRow[],
          topThemes: (topThemesResult.data ?? []) as ThemeSummaryRow[],
          topOpportunities: (topOpportunitiesResult.data ?? []) as OpportunitySummaryRow[],
        };
      });

      const projectSummary = formatProjectSummary(summary);
      const deterministicAssessment = deterministicEmptyAssessment(summary);

      const { assessment, model_used } = deterministicAssessment
        ? { assessment: deterministicAssessment, model_used: "deterministic-empty-project" }
        : await step.run("call-llm", async () => {
            const result = await callLLM({
              tier: "standard",
              temperature: 0.2,
              maxTokens: 1_800,
              timeoutMs: OUTCOME_ASSESSMENT_TIMEOUT_MS,
              system:
                "You assess product discovery outcome readiness from compact project state summaries. Return strict JSON only.",
              messages: [
                {
                  role: "user",
                  content: buildOutcomeAssessmentPrompt({ projectSummary }),
                },
              ],
              telemetry: {
                orgId: org_id,
                projectId: project_id,
                agentRunId,
                agentType: "outcome-assessment",
                step: "call-llm",
              },
            });

            const parsed = OutcomeAssessmentSchema.safeParse(extractJsonObject(result.content));
            if (!parsed.success) {
              const issues = parsed.error.issues
                .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
                .join("; ");
              throw new Error(`Outcome assessment JSON failed validation: ${issues}`);
            }

            return { assessment: parsed.data, model_used: result.model };
          });

      const writtenAt = new Date().toISOString();
      const storedAssessment = {
        ...assessment,
        metadata: {
          source: "ai",
          prompt_version: OUTCOME_ASSESSMENT_PROMPT_VERSION,
          model_used,
          generated_at: writtenAt,
          summary_counts: summary.counts,
          gaps_detected_at: summary.project.gaps_detected_at,
        },
      };

      await step.run("write-assessment", async () => {
        const { error } = await supabase
          .from("projects")
          .update({
            outcome_assessment: storedAssessment,
            outcome_assessed_at: writtenAt,
          })
          .eq("org_id", org_id)
          .eq("id", project_id);

        if (error) {
          throw new Error(`Failed to write outcome assessment: ${error.message}`);
        }
      });

      await step.run("complete-agent-run", async () => {
        await supabase
          .from("agent_runs")
          .update({
            status: "completed",
            output: {
              outcome_status: assessment.outcome_status,
              gaps_to_outcome: assessment.gaps_to_outcome.length,
              next_actions: assessment.next_actions.length,
              generatable_artifacts: assessment.generatable_artifacts.length,
              summary_counts: summary.counts,
            },
            model_used,
            completed_at: writtenAt,
          })
          .eq("org_id", org_id)
          .eq("id", agentRunId!);
      });

      return {
        outcome_status: assessment.outcome_status,
        assessed_at: writtenAt,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown outcome assessment error";
      if (agentRunId) {
        await supabase
          .from("agent_runs")
          .update({
            status: "failed",
            error: message,
            completed_at: new Date().toISOString(),
          })
          .eq("org_id", org_id)
          .eq("id", agentRunId);
      }
      throw error;
    }
  }
);
