// Frame draft generation — proposes a structured project frame from early evidence.
//
// Triggered by: project/frame.requested
// Fires from:  ingest-source (after first ingest, only when projects.frame IS NULL)
//              POST /api/projects/[projectId]/draft-frame (on-demand)
//
// The function writes to projects.frame_draft (jsonb) — it does NOT touch
// projects.frame. Jimmy accepts, edits, or discards the draft in the UI.

import { inngest } from "../client";
import { createServiceClient } from "@/lib/supabase/server";
import { callLLM } from "@/lib/llm/client";
import {
  buildFrameDraftPrompt,
  parseFrameDraft,
  FRAME_DRAFT_PROMPT_VERSION,
} from "@/lib/llm/prompts/frame-draft";

type ProjectRow = {
  name: string;
  frame: string | null;
};

type EvidenceRow = {
  id: string;
  content: string;
  summary: string | null;
  classification: string | null;
  sentiment: string | null;
};

type SourceRow = {
  metadata: Record<string, unknown>;
};

// Format evidence into a readable block for the prompt
function formatEvidenceForFrame(records: EvidenceRow[]): string {
  return records
    .map((record, index) => {
      const classification = record.classification ?? "signal";
      const sentiment = record.sentiment ? ` / ${record.sentiment}` : "";
      const header = `### ${index + 1}. ${classification}${sentiment}`;
      const body = record.content;
      const note = record.summary ? `*${record.summary}*` : null;
      return [header, body, note].filter(Boolean).join("\n");
    })
    .join("\n\n---\n\n");
}

// Minimum evidence records before we attempt to draft a frame.
// Below this threshold the frame would be too thin to be useful.
const MIN_EVIDENCE_FOR_FRAME = 3;

export const draftFrame = inngest.createFunction(
  { id: "draft-frame", name: "Draft Project Frame", retries: 2 },
  { event: "project/frame.requested" },
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
            agent_type: "frame-draft",
            input: { source_id, prompt_version: FRAME_DRAFT_PROMPT_VERSION },
          })
          .select("id")
          .single();

        if (error || !data) {
          throw new Error(`Failed to start frame-draft run: ${error?.message}`);
        }
        return data.id as string;
      });

      const fetchResult = await step.run(
        "fetch-project-and-evidence",
        async () => {
          const [projectResult, sourceResult, evidenceResult] = await Promise.all([
            supabase
              .from("projects")
              .select("name, frame")
              .eq("org_id", org_id)
              .eq("id", project_id)
              .single(),
            supabase
              .from("sources")
              .select("metadata")
              .eq("org_id", org_id)
              .eq("id", source_id)
              .single(),
            supabase
              .from("evidence")
              .select("id, content, summary, classification, sentiment")
              .eq("org_id", org_id)
              .eq("project_id", project_id)
              .eq("source_id", source_id)
              .order("created_at", { ascending: true })
              .limit(60), // Cap for prompt length
          ]);

          if (projectResult.error || !projectResult.data) {
            throw new Error(`Project not found: ${projectResult.error?.message}`);
          }

          // If the frame has been set since we queued this event, skip gracefully
          if (projectResult.data.frame && projectResult.data.frame.trim().length > 0) {
            return { skipped: true as const };
          }

          const source = sourceResult.data as SourceRow | null;
          const rawTitle =
            typeof source?.metadata?.title === "string"
              ? source.metadata.title
              : "first research session";

          return {
            skipped: false as const,
            project: projectResult.data as ProjectRow,
            evidence: (evidenceResult.data ?? []) as EvidenceRow[],
            sourceTitle: rawTitle,
          };
        }
      );

      // Frame was set between queue and execution — skip cleanly
      if (fetchResult.skipped) {
        await step.run("complete-skipped-frame-exists", async () => {
          await supabase
            .from("agent_runs")
            .update({
              status: "completed",
              output: { skipped: true, reason: "frame_already_set" },
              completed_at: new Date().toISOString(),
            })
            .eq("org_id", org_id)
            .eq("id", agentRunId);
        });
        return { skipped: true, reason: "frame_already_set" };
      }

      // TypeScript now knows fetchResult.skipped === false
      const { project, evidence, sourceTitle } = fetchResult;

      if (evidence.length < MIN_EVIDENCE_FOR_FRAME) {
        await step.run("complete-skipped-insufficient", async () => {
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

      const { frameDraft, modelUsed } = await step.run("generate-draft", async () => {
        const prompt = buildFrameDraftPrompt({
          projectName: project.name,
          sourceTitle,
          evidence: formatEvidenceForFrame(evidence),
          evidenceCount: evidence.length,
        });

        const result = await callLLM({
          tier: "standard",
          system:
            "You are a senior product researcher. Propose a concise, specific project frame based on the evidence provided. Return only valid JSON with the exact shape requested.",
          messages: [{ role: "user", content: prompt }],
          timeoutMs: 45_000,
        });

        const parsed = parseFrameDraft(result.content);
        if (!parsed) {
          throw new Error(`Frame draft JSON parse failed. Raw output: ${result.content.slice(0, 200)}`);
        }

        return { frameDraft: parsed, modelUsed: result.model };
      });

      await step.run("save-frame-draft", async () => {
        const { error } = await supabase
          .from("projects")
          .update({
            frame_draft: frameDraft,
            frame_draft_generated_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq("org_id", org_id)
          .eq("id", project_id);

        if (error) {
          throw new Error(`Failed to save frame draft: ${error.message}`);
        }
      });

      await step.run("complete-agent-run", async () => {
        await supabase
          .from("agent_runs")
          .update({
            status: "completed",
            output: {
              evidence_count: evidence.length,
              research_areas_count: frameDraft.research_areas.length,
            },
            model_used: modelUsed,
            completed_at: new Date().toISOString(),
          })
          .eq("org_id", org_id)
          .eq("id", agentRunId);
      });

      return { project_id, evidence_count: evidence.length, frame_draft: frameDraft };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown frame-draft error";
      console.error("[draft-frame] failed:", message);
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
      // Do not re-throw — a failed frame draft should never surface to the user
      return { skipped: true, error: message };
    }
  }
);
