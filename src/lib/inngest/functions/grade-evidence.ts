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
  parseGradeResultsDetailed,
  type GradeResult,
  GRADE_EVIDENCE_PROMPT_VERSION,
} from "@/lib/llm/prompts/grade-evidence";

const BATCH_SIZE = 20; // evidence records per LLM call
const RETRY_BATCH_SIZE = 5; // retry only missing ids, in small chunks to avoid truncation
const FALLBACK_REASON = "Could not grade — review manually";

type EvidenceRecord = {
  id: string;
  content: string;
  classification: string | null;
  trust_scope: string;
  trust_scope_source: string | null;
};

type ProjectContext = {
  research_context: Record<string, unknown> | null;
};

type GradeResponseDiagnostics = {
  parse_failures: number;
  retry_calls: number;
  missing_after_first_pass: number;
  missing_after_retry: number;
  invalid_items: number;
  object_scan_rescues: number;
  raw_failure_samples: Array<{
    step: string;
    requested: number;
    parsed: number;
    missing_ids: string[];
    raw_response_excerpt: string;
  }>;
};

function emptyGradeDiagnostics(): GradeResponseDiagnostics {
  return {
    parse_failures: 0,
    retry_calls: 0,
    missing_after_first_pass: 0,
    missing_after_retry: 0,
    invalid_items: 0,
    object_scan_rescues: 0,
    raw_failure_samples: [],
  };
}

function mergeGradeDiagnostics(target: GradeResponseDiagnostics, source: GradeResponseDiagnostics) {
  target.parse_failures += source.parse_failures;
  target.retry_calls += source.retry_calls;
  target.missing_after_first_pass += source.missing_after_first_pass;
  target.missing_after_retry += source.missing_after_retry;
  target.invalid_items += source.invalid_items;
  target.object_scan_rescues += source.object_scan_rescues;
  for (const sample of source.raw_failure_samples) {
    if (target.raw_failure_samples.length >= 3) break;
    target.raw_failure_samples.push(sample);
  }
}

function chunk<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

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
            .select("id, content, classification, trust_scope, trust_scope_source")
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
      const diagnostics = emptyGradeDiagnostics();

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
          const batchDiagnostics = emptyGradeDiagnostics();

          async function requestGrades(records: EvidenceRecord[], stepName: string) {
            const prompt = buildGradeEvidencePrompt({
              researchContext: contextText,
              evidence: records.map((e) => ({
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
              telemetry: {
                orgId: org_id,
                projectId: project_id,
                agentRunId,
                agentType: "evidence-grading",
                step: stepName,
              },
            });

            const parsed = parseGradeResultsDetailed(llmResult.content);
            const allowedIds = new Set(records.map((record) => record.id));
            const byId = new Map<string, GradeResult>();
            let ignoredItems = 0;

            for (const grade of parsed.grades) {
              if (!allowedIds.has(grade.id) || byId.has(grade.id)) {
                ignoredItems += 1;
                continue;
              }
              byId.set(grade.id, grade);
            }

            const missingRecords = records.filter((record) => !byId.has(record.id));
            const hasParseProblem =
              parsed.mode === "none" ||
              missingRecords.length > 0 ||
              parsed.invalid_count > 0 ||
              ignoredItems > 0;

            if (hasParseProblem) {
              batchDiagnostics.parse_failures += 1;
              batchDiagnostics.invalid_items += parsed.invalid_count + ignoredItems;
              if (parsed.mode === "object_scan" && byId.size > 0) {
                batchDiagnostics.object_scan_rescues += byId.size;
              }

              if (batchDiagnostics.raw_failure_samples.length < 3) {
                batchDiagnostics.raw_failure_samples.push({
                  step: stepName,
                  requested: records.length,
                  parsed: byId.size,
                  missing_ids: missingRecords.map((record) => record.id),
                  raw_response_excerpt: llmResult.content.slice(0, 4000),
                });
              }

              console.warn("[grade-evidence] incomplete LLM grade response", {
                source_id,
                batch_index: batchIdx,
                step: stepName,
                requested: records.length,
                parsed: byId.size,
                mode: parsed.mode,
                invalid_items: parsed.invalid_count + ignoredItems,
                missing_ids: missingRecords.map((record) => record.id),
                raw_response: llmResult.content,
              });
            }

            return {
              grades: Array.from(byId.values()),
              missingRecords,
            };
          }

          const gradeMap = new Map<string, GradeResult>();
          const firstPass = await requestGrades(
            batch,
            `grade-batch-${String(batchIdx + 1).padStart(4, "0")}`
          );

          for (const grade of firstPass.grades) {
            gradeMap.set(grade.id, grade);
          }

          if (firstPass.missingRecords.length > 0) {
            batchDiagnostics.missing_after_first_pass += firstPass.missingRecords.length;

            const retryChunks = chunk(firstPass.missingRecords, RETRY_BATCH_SIZE);
            for (let retryIdx = 0; retryIdx < retryChunks.length; retryIdx++) {
              batchDiagnostics.retry_calls += 1;
              const retry = await requestGrades(
                retryChunks[retryIdx],
                `grade-batch-${String(batchIdx + 1).padStart(4, "0")}-retry-${String(
                  retryIdx + 1
                ).padStart(2, "0")}`
              );

              for (const grade of retry.grades) {
                if (!gradeMap.has(grade.id)) gradeMap.set(grade.id, grade);
              }
            }
          }

          const now = new Date().toISOString();

          // Write grades and auto-trust 'trusted' records
          for (const record of batch) {
            const grade = gradeMap.get(record.id);
            if (!grade) continue;

            const updates: Record<string, unknown> = {
              ai_trust_grade: grade.grade,
              ai_trust_reason: grade.reason,
              ai_graded_at: now,
            };

            // Auto-trust: promote pending or prior AI-owned records when we have
            // real context. Human decisions stay locked.
            // Auto-exclude: weak records are noise, dismiss them automatically so the
            // review queue only shows uncertain items that genuinely need a human look.
            // Never override evidence a user has already trusted, excluded, or disputed.
            const canApplyAiTrust =
              hasContext &&
              (record.trust_scope === "pending" || record.trust_scope_source === "ai");
            if (canApplyAiTrust) {
              if (grade.grade === "trusted") {
                updates.trust_scope = "trusted";
                updates.trust_scope_source = "ai";
              } else if (grade.grade === "weak") {
                updates.trust_scope = "excluded";
                updates.trust_scope_source = "ai";
              } else if (record.trust_scope_source === "ai") {
                updates.trust_scope = "pending";
                updates.trust_scope_source = "pending";
              }
            }

            await updateEvidenceGrade({ supabase, org_id, evidence_id: grade.id, updates });

            if (grade.grade === "trusted") trusted++;
            else if (grade.grade === "uncertain") uncertain++;
            else {
              weak++;
              if (canApplyAiTrust) autoExcluded++;
            }
          }

          const missingAfterRetry = batch.filter((record) => !gradeMap.has(record.id));
          if (missingAfterRetry.length > 0) {
            batchDiagnostics.missing_after_retry += missingAfterRetry.length;
            await supabase
              .from("evidence")
              .update({
                ai_trust_grade: "uncertain",
                ai_trust_reason: FALLBACK_REASON,
                ai_graded_at: now,
              })
              .eq("org_id", org_id)
              .in("id", missingAfterRetry.map((record) => record.id));
            uncertain += missingAfterRetry.length;
          }

          return { trusted, uncertain, weak, autoExcluded, diagnostics: batchDiagnostics };
        });

        totalTrusted += batchCounts.trusted;
        totalUncertain += batchCounts.uncertain;
        totalWeak += batchCounts.weak;
        totalAutoExcluded += batchCounts.autoExcluded;
        mergeGradeDiagnostics(diagnostics, batchCounts.diagnostics);
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
              parse_diagnostics: diagnostics,
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
        parse_diagnostics: diagnostics,
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
