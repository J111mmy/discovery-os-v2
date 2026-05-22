// Problem discovery — surfaces structured problem statements from synthesised themes.
// Triggered by project/problems.requested (emitted by synthesise-project after themes are written).

import { z } from "zod";
import { inngest } from "../client";
import { createServiceClient } from "@/lib/supabase/server";
import { callLLM } from "@/lib/llm/client";
import {
  buildProblemDiscoveryPrompt,
  PROBLEM_DISCOVERY_PROMPT_VERSION,
} from "@/lib/llm/prompts/problems";

type ThemeRow = {
  id: string;
  label: string;
  description: string | null;
  evidence_count: number;
};

const ProblemSchema = z.object({
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().min(1).max(800),
  severity: z.enum(["high", "medium", "low"]).default("medium"),
  theme_ids: z.array(z.string().uuid()).default([]),
});

const ProblemsSchema = z.array(ProblemSchema).default([]);

function extractJsonArray(content: string) {
  const trimmed = content.trim();
  const unfenced = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  const start = unfenced.indexOf("[");
  const end = unfenced.lastIndexOf("]");
  if (start === -1 || end === -1 || end < start) {
    throw new Error("Problem discovery returned no JSON array");
  }
  return JSON.parse(unfenced.slice(start, end + 1)) as unknown;
}

function formatThemesForPrompt(themes: ThemeRow[]) {
  return themes
    .map((t) => {
      const lines = [`ID: ${t.id}`, `LABEL: ${t.label}`];
      if (t.description) lines.push(`DESCRIPTION: ${t.description}`);
      lines.push(`EVIDENCE COUNT: ${t.evidence_count}`);
      return lines.join("\n");
    })
    .join("\n\n---\n\n");
}

export const discoverProblems = inngest.createFunction(
  { id: "discover-problems", name: "Discover Problems", retries: 2 },
  { event: "project/problems.requested" },
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
            agent_type: "problem-discovery",
            input: { prompt_version: PROBLEM_DISCOVERY_PROMPT_VERSION },
          })
          .select("id")
          .single();
        if (error || !data) {
          throw new Error(`Failed to start problem discovery run: ${error?.message}`);
        }
        return data.id as string;
      });

      const { themes, frame } = await step.run("fetch-context", async () => {
        const [themesResult, projectResult] = await Promise.all([
          supabase
            .from("themes")
            .select("id, label, description, evidence_count")
            .eq("org_id", org_id)
            .eq("project_id", project_id)
            .order("evidence_count", { ascending: false })
            .limit(40),
          supabase
            .from("projects")
            .select("frame")
            .eq("org_id", org_id)
            .eq("id", project_id)
            .single(),
        ]);

        if (themesResult.error) {
          throw new Error(`Failed to fetch themes: ${themesResult.error.message}`);
        }
        if (projectResult.error) {
          throw new Error(`Failed to fetch project: ${projectResult.error.message}`);
        }

        return {
          themes: (themesResult.data ?? []) as ThemeRow[],
          frame: (projectResult.data?.frame as string | null) ?? "",
        };
      });

      if (themes.length === 0) {
        await step.run("complete-empty", async () => {
          await supabase
            .from("agent_runs")
            .update({
              status: "completed",
              output: { themes: 0, problems_written: 0 },
              completed_at: new Date().toISOString(),
            })
            .eq("org_id", org_id)
            .eq("id", agentRunId!);
        });
        return { themes: 0, problems_written: 0 };
      }

      const { problems, model_used } = await step.run("call-llm", async () => {
        const result = await callLLM({
          tier: "premium",
          system:
            "You surface structured product problems from research themes. Return strict JSON only.",
          messages: [
            {
              role: "user",
              content: buildProblemDiscoveryPrompt({
                frame: frame || "No project frame set.",
                themes: formatThemesForPrompt(themes),
              }),
            },
          ],
          timeoutMs: 120_000,
        });

        const parsed = ProblemsSchema.safeParse(extractJsonArray(result.content));
        if (!parsed.success) {
          throw new Error("Problem discovery JSON did not match expected schema");
        }

        return { problems: parsed.data, model_used: result.model };
      });

      const { problems_written } = await step.run("write-problems", async () => {
        const allowedThemeIds = new Set(themes.map((t) => t.id));
        let written = 0;

        // Collect evidence IDs for each problem via its themes
        const themeToEvidenceIds = new Map<string, string[]>();
        if (themes.length > 0) {
          const { data: links } = await supabase
            .from("evidence_themes")
            .select("theme_id, evidence_id")
            .eq("org_id", org_id)
            .in("theme_id", themes.map((t) => t.id));

          for (const link of links ?? []) {
            const existing = themeToEvidenceIds.get(link.theme_id) ?? [];
            existing.push(link.evidence_id);
            themeToEvidenceIds.set(link.theme_id, existing);
          }
        }

        for (const problem of problems) {
          if (!problem.title.trim()) continue;

          const validThemeIds = problem.theme_ids.filter((id) => allowedThemeIds.has(id));

          // Collect unique evidence IDs from supporting themes
          const evidenceIdSet = new Set<string>();
          for (const tid of validThemeIds) {
            for (const eid of themeToEvidenceIds.get(tid) ?? []) {
              evidenceIdSet.add(eid);
            }
          }

          const { error } = await supabase.from("problems").upsert(
            {
              org_id,
              project_id,
              title: problem.title,
              description: problem.description,
              severity: problem.severity,
              status: "surfaced",
              source_theme_ids: validThemeIds,
              source_evidence_ids: Array.from(evidenceIdSet),
            },
            { onConflict: "org_id,project_id,title" }
          );

          if (error) {
            throw new Error(`Failed to write problem "${problem.title}": ${error.message}`);
          }
          written++;
        }

        // Stamp the project
        await supabase
          .from("projects")
          .update({ problems_discovered_at: new Date().toISOString() })
          .eq("org_id", org_id)
          .eq("id", project_id);

        return { problems_written: written };
      });

      await step.run("complete-agent-run", async () => {
        await supabase
          .from("agent_runs")
          .update({
            status: "completed",
            output: { themes: themes.length, problems_written },
            model_used,
            completed_at: new Date().toISOString(),
          })
          .eq("org_id", org_id)
          .eq("id", agentRunId!);
      });

      return { themes: themes.length, problems_written };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
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
