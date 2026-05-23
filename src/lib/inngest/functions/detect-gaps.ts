// Gap detection — identifies research areas with no evidence coverage.
// Triggered by project/synthesis.completed after themes are written and problems discovered.

import { z } from "zod";
import { inngest } from "../client";
import { createServiceClient } from "@/lib/supabase/server";
import { callLLM } from "@/lib/llm/client";
import {
  buildGapDetectionPrompt,
  GAP_DETECTION_PROMPT_VERSION,
} from "@/lib/llm/prompts/gaps";

const GapSchema = z.object({
  area: z.string().trim().min(1).max(200),
  description: z.string().trim().min(1).max(500),
  severity: z.enum(["high", "medium", "low"]).default("medium"),
  suggested_action: z.string().trim().min(1).max(300),
});

const GapsSchema = z.array(GapSchema).default([]);

function extractJsonArray(content: string) {
  const trimmed = content.trim();
  const unfenced = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  const start = unfenced.indexOf("[");
  const end = unfenced.lastIndexOf("]");
  if (start === -1 || end === -1 || end < start) return [];
  try {
    return JSON.parse(unfenced.slice(start, end + 1)) as unknown[];
  } catch {
    return [];
  }
}

export const detectGaps = inngest.createFunction(
  { id: "detect-gaps", name: "Detect Research Gaps", retries: 1 },
  { event: "project/synthesis.completed" },
  async ({ event, step }) => {
    const { org_id, project_id } = event.data;
    const supabase = createServiceClient();

    const { frame, themes } = await step.run("fetch-context", async () => {
      const [projectResult, themesResult] = await Promise.all([
        supabase
          .from("projects")
          .select("frame")
          .eq("org_id", org_id)
          .eq("id", project_id)
          .single(),
        supabase
          .from("themes")
          .select("label, description, evidence_count")
          .eq("org_id", org_id)
          .eq("project_id", project_id)
          .order("evidence_count", { ascending: false })
          .limit(20),
      ]);

      const projectFrame = (projectResult.data?.frame as string | null) ?? "";
      const themeRows = (themesResult.data ?? []) as Array<{
        label: string;
        description: string | null;
        evidence_count: number;
      }>;

      const themesFormatted =
        themeRows.length > 0
          ? themeRows
              .map(
                (t) =>
                  `- ${t.label} (${t.evidence_count} records)${t.description ? `: ${t.description}` : ""}`
              )
              .join("\n")
          : "No themes discovered yet.";

      return { frame: projectFrame, themes: themesFormatted };
    });

    // Skip if there's nothing to assess
    if (!frame.trim() && themes === "No themes discovered yet.") {
      return { gaps_detected: 0, skipped: true };
    }

    const { gaps, model_used } = await step.run("call-llm", async () => {
      const result = await callLLM({
        tier: "standard",
        system:
          "You identify research coverage gaps. Return strict JSON only.",
        messages: [
          {
            role: "user",
            content: buildGapDetectionPrompt({
              frame: frame || "No project frame set — this itself may be a gap.",
              themes,
            }),
          },
        ],
        timeoutMs: 60_000,
      });

      const parsed = GapsSchema.safeParse(extractJsonArray(result.content));
      return {
        gaps: parsed.success ? parsed.data : [],
        model_used: result.model,
      };
    });

    await step.run("write-gaps", async () => {
      await supabase
        .from("projects")
        .update({
          gap_signals: gaps,
          gaps_detected_at: new Date().toISOString(),
        })
        .eq("org_id", org_id)
        .eq("id", project_id);

      await supabase.from("agent_runs").insert({
        org_id,
        project_id,
        agent_type: "gap-detection",
        status: "completed",
        input: { prompt_version: GAP_DETECTION_PROMPT_VERSION },
        output: { gaps_detected: gaps.length },
        model_used,
        completed_at: new Date().toISOString(),
      });
    });

    return { gaps_detected: gaps.length };
  }
);
