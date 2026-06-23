// Action extraction — pulls commitments and feature requests from a session's evidence.
//
// Triggered by: source/actions.requested
// Fires from:  ingest-source (after every ingest that produced evidence)
//
// Two extraction targets:
//   actions         — things the internal team committed to do
//   product_requests — things external participants said they want from the product
//
// Idempotent: deletes any existing rows for this source before inserting,
// so re-running after a retry produces clean results.

import { inngest } from "../client";
import { createServiceClient } from "@/lib/supabase/server";
import { callLLM } from "@/lib/llm/client";
import {
  buildActionExtractionPrompt,
  parseActionExtractionResult,
  ACTION_EXTRACTION_PROMPT_VERSION,
} from "@/lib/llm/prompts/action-extraction";

type EvidenceRow = {
  id: string;
  content: string;
  summary: string | null;
  classification: string | null;
  metadata: Record<string, unknown>;
};

type SourceRow = {
  type: string;
  metadata: Record<string, unknown>;
};

// Minimum evidence records before attempting extraction.
// Below this, a session is too thin for meaningful action items.
const MIN_EVIDENCE_FOR_EXTRACTION = 2;

function formatEvidenceForActions(records: EvidenceRow[]): string {
  return records
    .map((record, index) => {
      const speaker =
        typeof record.metadata?.speaker === "string" && record.metadata.speaker
          ? ` [${record.metadata.speaker}]`
          : "";
      const classification = record.classification ?? "signal";
      return `### ${index + 1}. ${classification}${speaker}\n${record.content}`;
    })
    .join("\n\n---\n\n");
}

export const extractActions = inngest.createFunction(
  { id: "extract-actions", name: "Extract Actions and Requests", retries: 2 },
  { event: "source/actions.requested" },
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
            agent_type: "action-extraction",
            input: { source_id, prompt_version: ACTION_EXTRACTION_PROMPT_VERSION },
          })
          .select("id")
          .single();

        if (error || !data) {
          throw new Error(`Failed to start action extraction run: ${error?.message}`);
        }
        return data.id as string;
      });

      const { source, evidence } = await step.run("fetch-source-and-evidence", async () => {
        const [sourceResult, evidenceResult] = await Promise.all([
          supabase
            .from("sources")
            .select("type, metadata")
            .eq("org_id", org_id)
            .eq("id", source_id)
            .single(),
          supabase
            .from("evidence")
            .select("id, content, summary, classification, metadata")
            .eq("org_id", org_id)
            .eq("project_id", project_id)
            .eq("source_id", source_id)
            .order("created_at", { ascending: true }),
        ]);

        if (sourceResult.error || !sourceResult.data) {
          throw new Error(`Source not found: ${sourceResult.error?.message}`);
        }

        return {
          source: sourceResult.data as SourceRow,
          evidence: (evidenceResult.data ?? []) as EvidenceRow[],
        };
      });

      if (evidence.length < MIN_EVIDENCE_FOR_EXTRACTION) {
        await step.run("complete-skipped", async () => {
          await supabase
            .from("agent_runs")
            .update({
              status: "completed",
              output: {
                skipped: true,
                reason: "insufficient_evidence",
                evidence_count: evidence.length,
              },
              completed_at: new Date().toISOString(),
            })
            .eq("org_id", org_id)
            .eq("id", agentRunId);
        });
        return { skipped: true, reason: "insufficient_evidence", evidence_count: evidence.length };
      }

      const { result, modelUsed } = await step.run("extract", async () => {
        const sourceTitle =
          typeof source.metadata?.title === "string"
            ? source.metadata.title
            : "Research session";

        const prompt = buildActionExtractionPrompt({
          sourceTitle,
          sourceType: source.type,
          evidence: formatEvidenceForActions(evidence),
          evidenceCount: evidence.length,
        });

        const llmResult = await callLLM({
          tier: "cheap",
          system:
            "You extract action items and product requests from research session notes. Be conservative — only include clear, explicit commitments and requests. Return only valid JSON.",
          messages: [{ role: "user", content: prompt }],
          timeoutMs: 30_000,
          telemetry: {
            orgId: org_id,
            projectId: project_id,
            agentRunId,
            agentType: "action-extraction",
            step: "extract",
          },
        });

        const parsed = parseActionExtractionResult(llmResult.content);
        if (!parsed) {
          throw new Error(
            `Action extraction JSON parse failed. Raw: ${llmResult.content.slice(0, 200)}`
          );
        }

        return { result: parsed, modelUsed: llmResult.model };
      });

      const { actionsCreated, requestsCreated } = await step.run("save-results", async () => {
        // Build an evidence id lookup by quote similarity — best-effort, not guaranteed.
        // We match evidence records by checking if the evidence_quote appears in the content.
        function findEvidenceId(quote: string): string | null {
          if (!quote) return null;
          const normalized = quote.trim().toLowerCase();
          const match = evidence.find((e) =>
            e.content.toLowerCase().includes(normalized.slice(0, 60))
          );
          return match?.id ?? null;
        }

        // Idempotency: delete existing rows for this source before inserting
        await Promise.all([
          supabase.from("actions").delete().eq("org_id", org_id).eq("source_id", source_id),
          supabase
            .from("product_requests")
            .delete()
            .eq("org_id", org_id)
            .eq("source_id", source_id),
        ]);

        let actionsCreated = 0;
        let requestsCreated = 0;

        if (result.actions.length > 0) {
          const actionRows = result.actions.map((a) => ({
            org_id,
            project_id,
            source_id,
            evidence_id: findEvidenceId(a.evidence_quote),
            description: a.description,
            owner: a.owner ?? null,
            due_note: a.due_note ?? null,
            status: "open",
          }));

          const { error } = await supabase.from("actions").insert(actionRows);
          if (error) throw new Error(`Failed to insert actions: ${error.message}`);
          actionsCreated = actionRows.length;
        }

        if (result.product_requests.length > 0) {
          const requestRows = result.product_requests.map((r) => ({
            org_id,
            project_id,
            source_id,
            evidence_id: findEvidenceId(r.evidence_quote),
            description: r.description,
            requester_name: r.requester_name ?? null,
            priority_signal: r.priority_signal,
            status: "open",
          }));

          const { error } = await supabase.from("product_requests").insert(requestRows);
          if (error) throw new Error(`Failed to insert product requests: ${error.message}`);
          requestsCreated = requestRows.length;
        }

        return { actionsCreated, requestsCreated };
      });

      await step.run("complete-agent-run", async () => {
        await supabase
          .from("agent_runs")
          .update({
            status: "completed",
            output: {
              actions_created: actionsCreated,
              requests_created: requestsCreated,
              evidence_count: evidence.length,
            },
            model_used: modelUsed,
            completed_at: new Date().toISOString(),
          })
          .eq("org_id", org_id)
          .eq("id", agentRunId);
      });

      return { source_id, actions_created: actionsCreated, requests_created: requestsCreated };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown action extraction error";
      console.error("[extract-actions] failed:", message);
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
      // Never re-throw — a missed action extraction should not surface to users
      return { skipped: true, error: message };
    }
  }
);
