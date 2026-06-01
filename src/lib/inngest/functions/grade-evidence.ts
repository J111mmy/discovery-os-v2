// Evidence grading — AI assessment of each evidence record's relevance
// to the project's research context.
//
// Triggered by: source/evidence.grading.requested
// Fires from:   ingest-source (after embed-and-store, if evidence was created)
//
// Behaviour:
//   - Fetches the project's research_context and all evidence for this source
//   - Grades records in batches of 20 (cheap tier — cost-efficient)
//   - Writes ai_trust_grade + ai_trust_reason + ai_graded_at to each record
//   - Auto-sets trust_scope = 'trusted' for 'trusted' grade records
//   - Leaves 'uncertain' and 'weak' records as 'pending' for user review
//   - If no research_context is set, grades all records as 'uncertain' (conservative)
//   - Idempotent: safe to re-run — overwrites previous grades for this source

import { inngest } from "../client";
import { createServiceClient } from "@/lib/supabase/server";
import { callLLM } from "@/lib/llm/client";
import {
  buildGradeEvidencePrompt,
  formatResearchContext,
  parseGradeResults,
  GRADE_EVIDENCE_PROMPT_VERSION,
} from "@/lib/llm/prompts/grade-evidence";

const BATCH_SIZE = 20; // evidence records per LLM call

type EvidenceRecord = {
  id: string;
  content: string;
  classification: string | null;
  trust_scope: string;
};

type ProjectContext = {
  research_context: Record<string, unknown> | null;
};

function isMissingTrustScopeSourceColumn(error: { message?: string } | null) {
  return Boolean(error?.message?.includes("trust_scope_source"));
}

async function updateEvidenceGrade(params: {
  supabase: ReturnType<typeof createServiceClient>;
  org_id: string;
  evidence_id: string;
  updates: Record<string, unknown>;
}) {
  const { supabase, org_id, evidence_id, updates } = params;
  const { error } = await supabase
    .from("evidence")
    .update(updates)
    .eq("org_id", org_id)
    .eq("id", evidence_id);

  if (!error) return;

  // Backward-compatible deploy safety: if code reaches production before
  // migration 0026, keep grading functional and retry without provenance.
  if ("trust_scope_source" in updates && isMissingTrustScopeSourceColumn(error)) {
    const { trust_scope_source: _trustScopeSource, ...fallbackUpdates } = updates;
    const { error: fallbackError } = await supabase
      .from("evidence")
      .update(fallbackUpdates)
      .eq("org_id", org_id)
      .eq("id", evidence_id);

    if (!fallbackError) return;
    throw new Error(`Failed to update evidence grade: ${fallbackError.message}`);
  }

  throw new Error(`Failed to update evidence grade: ${error.message}`);
}

export const gradeEvidence = inngest.createFunction(
  { id: "grade-evidence", name: "Grade Evidence", retries: 2 },
  { event: "source/evidence.grading.requested" },
  async ({ event, step }) => {
    const { org_id, project_id, source_id } = event.data as {
      org_id: string;
      project_id: string;
      source_id: string;
    };

    const supabase = createServiceClient();
    let agentRunId: string | null = null;

    try {
      agentRunId = await step.run("start-agent-run", async () => {
        const { data, error } = await supabase
          .from("agent_runs")
          .insert({
            org_id,
            project_id,
            agent_type: "evidence-grading",
            input: { source_id, prompt_version: GRADE_EVIDENCE_PROMPT_VERSION },
          })
          .select("id")
          .single();

        if (error || !data) {
          throw new Error(`Failed to start evidence grading run: ${error?.message}`);
        }
        return data.id as string;
      });

      const { project, evidence } = await step.run("fetch-project-and-evidence", async () => {
        const [projectResult, evidenceResult] = await Promise.all([
          supabase
            .from("projects")
            .select("research_context")
            .eq("org_id", org_id)
            .eq("id", project_id)
            .single(),
          supabase
            .from("evidence")
            .select("id, content, classification, trust_scope")
            .eq("org_id", org_id)
            .eq("project_id", project_id)
            .eq("source_id", source_id),
        ]);

        if (projectResult.error) {
          throw new Error(`Failed to fetch project: ${projectResult.error.message}`);
        }
        if (evidenceResult.error) {
          throw new Error(`Failed to fetch evidence: ${evidenceResult.error.message}`);
        }

        return {
          project: projectResult.data as ProjectContext,
          evidence: (evidenceResult.data ?? []) as EvidenceRecord[],
        };
      });

      if (evidence.length === 0) {
        await step.run("complete-no-evidence", async () => {
          await supabase
            .from("agent_runs")
            .update({
              status: "completed",
              output: { skipped: true, reason: "no_evidence", evidence_count: 0 },
              completed_at: new Date().toISOString(),
            })
            .eq("org_id", org_id)
            .eq("id", agentRunId);
        });
        return { skipped: true, reason: "no_evidence" };
      }

      const contextText = formatResearchContext(project.research_context);
      const hasContext = project.research_context !== null &&
        Object.values(project.research_context).some(
          (v) => typeof v === "string" ? v.trim().length > 0 : Array.isArray(v) && v.length > 0
        );

      // Grade in batches — cheap tier for cost efficiency
      const batches: EvidenceRecord[][] = [];
      for (let i = 0; i < evidence.length; i += BATCH_SIZE) {
        batches.push(evidence.slice(i, i + BATCH_SIZE));
      }

      let totalTrusted = 0;
      let totalUncertain = 0;
      let totalWeak = 0;
      let totalAutoExcluded = 0;

      for (let batchIdx = 0; batchIdx < batches.length; batchIdx++) {
        const batch = batches[batchIdx];

        // Counts are RETURNED from the step (not mutated in outer scope). On Inngest
        // replay a completed step.run returns its memoized value without re-executing
        // the callback, so outer-scope mutation inside the callback would be lost. The
        // returned object is persisted and replays deterministically — accumulate from it.
        const batchCounts = await step.run(`grade-batch-${batchIdx}`, async () => {
          let trusted = 0;
          let uncertain = 0;
          let weak = 0;
          let autoExcluded = 0;

          const prompt = buildGradeEvidencePrompt({
            researchContext: contextText,
            evidence: batch.map((e) => ({
              id: e.id,
              content: e.content,
              classification: e.classification,
            })),
          });

          const llmResult = await callLLM({
            tier: "cheap",
            system:
              "You are a research analyst grading evidence relevance. Return only valid JSON as specified.",
            messages: [{ role: "user", content: prompt }],
            timeoutMs: 30_000,
          });

          const grades = parseGradeResults(llmResult.content);

          if (!grades || grades.length === 0) {
            // Parse failure — mark all as uncertain conservatively
            const now = new Date().toISOString();
            await supabase
              .from("evidence")
              .update({
                ai_trust_grade: "uncertain",
                ai_trust_reason: "Could not grade — review manually",
                ai_graded_at: now,
              })
              .eq("org_id", org_id)
              .in("id", batch.map((e) => e.id));
            uncertain += batch.length;
            return { trusted, uncertain, weak, autoExcluded };
          }

          const now = new Date().toISOString();

          // Write grades and auto-trust 'trusted' records
          for (const grade of grades) {
            const updates: Record<string, unknown> = {
              ai_trust_grade: grade.grade,
              ai_trust_reason: grade.reason,
              ai_graded_at: now,
            };

            const original = batch.find((record) => record.id === grade.id);

            // Auto-trust: only promote pending records when we have real context.
            // Auto-exclude: weak records are noise — dismiss them automatically so the
            // review queue only shows uncertain items that genuinely need a human look.
            // Never override evidence a user has already trusted, excluded, or disputed.
            if (original?.trust_scope === "pending" && hasContext) {
              if (grade.grade === "trusted") {
                updates.trust_scope = "trusted";
                updates.trust_scope_source = "ai";
              } else if (grade.grade === "weak") {
                updates.trust_scope = "excluded";
                updates.trust_scope_source = "ai";
              }
            }

            await updateEvidenceGrade({ supabase, org_id, evidence_id: grade.id, updates });

            if (grade.grade === "trusted") trusted++;
            else if (grade.grade === "uncertain") uncertain++;
            else {
              weak++;
              if (original?.trust_scope === "pending" && hasContext) autoExcluded++;
            }
          }

          return { trusted, uncertain, weak, autoExcluded };
        });

        totalTrusted += batchCounts.trusted;
        totalUncertain += batchCounts.uncertain;
        totalWeak += batchCounts.weak;
        totalAutoExcluded += batchCounts.autoExcluded;
      }

      await step.run("complete-agent-run", async () => {
        await supabase
          .from("agent_runs")
          .update({
            status: "completed",
            output: {
              evidence_count: evidence.length,
              trusted: totalTrusted,
              uncertain: totalUncertain,
              weak: totalWeak,
              has_context: hasContext,
              auto_trusted: hasContext ? totalTrusted : 0,
              auto_excluded: hasContext ? totalAutoExcluded : 0,
            },
            completed_at: new Date().toISOString(),
          })
          .eq("org_id", org_id)
          .eq("id", agentRunId);
      });

      return {
        source_id,
        evidence_count: evidence.length,
        trusted: totalTrusted,
        uncertain: totalUncertain,
        weak: totalWeak,
        auto_trusted: hasContext ? totalTrusted : 0,
        auto_excluded: hasContext ? totalAutoExcluded : 0,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown evidence grading error";
      console.error("[grade-evidence] failed:", message);
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
      return { skipped: true, error: message };
    }
  }
);
