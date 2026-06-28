// Session review — writes a human-readable post-session brief after each ingest.
// Triggered by: source/review.requested
// Output: an artifact of type 'report' linked to the source via metadata.source_id

import { inngest } from "../client";
import { createServiceClient } from "@/lib/supabase/server";
import { callLLM } from "@/lib/llm/client";
import {
  buildSessionReviewPrompt,
  SESSION_REVIEW_PROMPT_VERSION,
} from "@/lib/llm/prompts/session-review";

type EvidenceRecord = {
  id: string;
  content: string;
  summary: string | null;
  classification: string | null;
  sentiment: string | null;
  metadata: Record<string, unknown>;
};

type SourceRow = {
  title: string;
  type: string;
};

function wordCount(text: string) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function formatEvidenceForReview(records: EvidenceRecord[]): string {
  return records
    .map((record, index) => {
      const speaker =
        typeof record.metadata?.speaker === "string" && record.metadata.speaker
          ? `[${record.metadata.speaker}]`
          : null;
      const classification = record.classification ?? "signal";
      const sentiment = record.sentiment ?? "neutral";

      return [
        `### Record ${index + 1}: ${classification} / ${sentiment}`,
        speaker ? `**Speaker:** ${speaker}` : null,
        record.content,
        record.summary ? `*Summary: ${record.summary}*` : null,
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n---\n\n");
}

function formatSourceType(type: string): string {
  const labels: Record<string, string> = {
    customer_interview: "Customer interview",
    sales_call: "Sales call",
    usability_study: "Usability study",
    internal_meeting: "Internal meeting",
    transcript: "Transcript",
    document: "Document",
    note: "Note",
    survey: "Survey",
    support_ticket: "Support ticket",
    other: "Other",
  };
  return labels[type] ?? type;
}

export const sessionReview = inngest.createFunction(
  { id: "session-review", name: "Session Review", retries: 2 },
  { event: "source/review.requested" },
  async ({ event, step }) => {
    const { org_id, project_id, source_id } = event.data;
    const supabase = createServiceClient();
    let agentRunId: string | null = null;

    try {
      agentRunId = await step.run("start-agent-run", async () => {
        const { data, error } = await supabase
          .from("agent_runs")
          .insert({
            org_id,
            project_id,
            agent_type: "session-review",
            input: { source_id, prompt_version: SESSION_REVIEW_PROMPT_VERSION },
          })
          .select("id")
          .single();

        if (error || !data) {
          throw new Error(`Failed to start session review run: ${error?.message}`);
        }
        return data.id as string;
      });

      const { source, evidence } = await step.run("fetch-source-and-evidence", async () => {
        const [sourceResult, evidenceResult] = await Promise.all([
          supabase
            .from("sources")
            .select("title, type")
            .eq("org_id", org_id)
            .eq("project_id", project_id)
            .eq("id", source_id)
            .single(),
          supabase
            .from("evidence")
            .select("id, content, summary, classification, sentiment, metadata")
            .eq("org_id", org_id)
            .eq("project_id", project_id)
            .eq("source_id", source_id)
            .order("created_at", { ascending: true }),
        ]);

        if (sourceResult.error || !sourceResult.data) {
          throw new Error(`Source not found: ${sourceResult.error?.message}`);
        }
        if (evidenceResult.error) {
          throw new Error(`Failed to fetch evidence: ${evidenceResult.error.message}`);
        }

        return {
          source: sourceResult.data as SourceRow,
          evidence: (evidenceResult.data ?? []) as EvidenceRecord[],
        };
      });

      // Need enough evidence to write a useful brief — skip if sparse
      if (evidence.length < 3) {
        await step.run("complete-skipped", async () => {
          await supabase
            .from("agent_runs")
            .update({
              status: "completed",
              output: { skipped: true, reason: "insufficient_evidence", evidence_count: evidence.length },
              completed_at: new Date().toISOString(),
            })
            .eq("org_id", org_id)
            .eq("id", agentRunId);
        });
        return { skipped: true, reason: "insufficient_evidence" };
      }

      const { briefContent, modelUsed } = await step.run("generate-brief", async () => {
        const prompt = buildSessionReviewPrompt({
          sourceTitle: source.title,
          sourceType: formatSourceType(source.type),
          evidence: formatEvidenceForReview(evidence),
          evidenceCount: evidence.length,
        });

        const result = await callLLM({
          tier: "standard",
          system:
            "You write clear, human-readable research briefs. Write in prose. Return only the brief. No preamble, no meta-commentary.",
          messages: [{ role: "user", content: prompt }],
          timeoutMs: 50_000,
          telemetry: {
            orgId: org_id,
            projectId: project_id,
            agentRunId,
            agentType: "session-review",
            step: "generate-brief",
          },
        });

        return {
          briefContent: result.content.trim(),
          modelUsed: result.model,
        };
      });

      const artifactId = await step.run("save-artifact", async () => {
        const title = `Session brief: ${source.title}`;

        const { data, error } = await supabase
          .from("artifacts")
          .insert({
            org_id,
            project_id,
            type: "report",
            title,
            prompt: `Auto-generated session review for source: ${source_id}`,
            content_md: briefContent,
            version: 1,
            word_count: wordCount(briefContent),
            model_used: modelUsed,
            task_tier: "standard",
            metadata: {
              source_id,
              source_title: source.title,
              source_type: source.type,
              evidence_count: evidence.length,
              prompt_version: SESSION_REVIEW_PROMPT_VERSION,
              auto_generated: true,
            },
          })
          .select("id")
          .single();

        if (error || !data) {
          throw new Error(`Failed to save session review artifact: ${error?.message}`);
        }

        return data.id as string;
      });

      await step.run("complete-agent-run", async () => {
        await supabase
          .from("agent_runs")
          .update({
            status: "completed",
            output: {
              artifact_id: artifactId,
              evidence_count: evidence.length,
              word_count: wordCount(briefContent),
            },
            model_used: modelUsed,
            completed_at: new Date().toISOString(),
          })
          .eq("org_id", org_id)
          .eq("id", agentRunId);
      });

      return { artifact_id: artifactId, evidence_count: evidence.length };
    } catch (error) {
      // Session review is background enrichment — failure must not surface to users
      const message = error instanceof Error ? error.message : "Unknown session review error";
      console.error("[session-review] failed:", message);
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
