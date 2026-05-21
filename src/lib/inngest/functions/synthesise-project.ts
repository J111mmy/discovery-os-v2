// Project synthesis — clusters trusted evidence into reusable themes.

import { z } from "zod";
import { inngest } from "../client";
import { createServiceClient } from "@/lib/supabase/server";
import { callLLM } from "@/lib/llm/client";
import {
  buildProjectSynthesisPrompt,
  PROJECT_SYNTHESIS_PROMPT_VERSION,
} from "@/lib/llm/prompts/synthesis";

type TrustedEvidence = {
  id: string;
  content: string;
  summary: string | null;
  classification: string | null;
  sentiment: string | null;
};

type ThemeContext = {
  id: string;
  label: string;
  description: string | null;
};

const SynthesisedThemeSchema = z.object({
  label: z.string().trim().min(1).max(80),
  description: z.string().trim().min(1).max(500),
  evidence_ids: z.array(z.string().uuid()).default([]),
});

const SynthesisedThemesSchema = z.array(SynthesisedThemeSchema).default([]);

function chunk<T>(items: T[], size: number) {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    batches.push(items.slice(i, i + size));
  }
  return batches;
}

function cleanThemeLabel(label: string) {
  return label.replace(/\s+/g, " ").trim();
}

function extractJsonArray(content: string) {
  const trimmed = content.trim();
  const unfenced = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  const start = unfenced.indexOf("[");
  const end = unfenced.lastIndexOf("]");
  if (start === -1 || end === -1 || end < start) {
    throw new Error("Synthesis returned no JSON array");
  }
  return JSON.parse(unfenced.slice(start, end + 1)) as unknown;
}

function formatExistingThemes(themes: ThemeContext[]) {
  if (themes.length === 0) return "No existing themes yet.";
  return themes
    .map((theme) =>
      theme.description ? `- ${theme.label}: ${theme.description}` : `- ${theme.label}`
    )
    .join("\n");
}

function formatEvidenceBatch(evidence: TrustedEvidence[]) {
  return evidence
    .map((record) =>
      [
        `ID: ${record.id}`,
        record.classification ? `CLASSIFICATION: ${record.classification}` : null,
        record.sentiment ? `SENTIMENT: ${record.sentiment}` : null,
        record.summary ? `SUMMARY: ${record.summary}` : null,
        `CONTENT: ${record.content.slice(0, 1200)}`,
      ]
        .filter(Boolean)
        .join("\n")
    )
    .join("\n\n---\n\n");
}

async function completeRun(input: {
  agentRunId: string | null;
  org_id: string;
  project_id: string;
  output: Record<string, unknown>;
  model_used?: string | null;
}) {
  const supabase = createServiceClient();
  await Promise.all([
    input.agentRunId
      ? supabase
          .from("agent_runs")
          .update({
            status: "completed",
            output: input.output,
            model_used: input.model_used ?? null,
            completed_at: new Date().toISOString(),
          })
          .eq("org_id", input.org_id)
          .eq("id", input.agentRunId)
      : Promise.resolve(),
    supabase
      .from("projects")
      .update({
        synthesis_stale: false,
        last_synthesised_at: new Date().toISOString(),
      })
      .eq("org_id", input.org_id)
      .eq("id", input.project_id),
  ]);
}

export const synthesiseProject = inngest.createFunction(
  { id: "synthesise-project", name: "Synthesise Project", retries: 2 },
  { event: "project/synthesis.requested" },
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
            agent_type: "project-synthesis",
            input: { prompt_version: PROJECT_SYNTHESIS_PROMPT_VERSION },
          })
          .select("id")
          .single();

        if (error || !data) {
          throw new Error(`Failed to start synthesis run: ${error?.message}`);
        }
        return data.id as string;
      });

      const { trustedEvidence, allProjectEvidenceIds, existingThemes } = await step.run(
        "fetch-context",
        async () => {
          const [trustedResult, allEvidenceResult, themesResult] = await Promise.all([
            supabase
              .from("evidence")
              .select("id, content, summary, classification, sentiment")
              .eq("org_id", org_id)
              .eq("project_id", project_id)
              .eq("trust_scope", "trusted")
              .order("created_at", { ascending: true }),
            supabase
              .from("evidence")
              .select("id")
              .eq("org_id", org_id)
              .eq("project_id", project_id),
            supabase
              .from("themes")
              .select("id, label, description")
              .eq("org_id", org_id)
              .order("evidence_count", { ascending: false })
              .limit(200),
          ]);

          if (trustedResult.error) {
            throw new Error(`Failed to fetch trusted evidence: ${trustedResult.error.message}`);
          }
          if (allEvidenceResult.error) {
            throw new Error(`Failed to fetch project evidence IDs: ${allEvidenceResult.error.message}`);
          }
          if (themesResult.error) {
            throw new Error(`Failed to fetch themes: ${themesResult.error.message}`);
          }

          return {
            trustedEvidence: (trustedResult.data ?? []) as TrustedEvidence[],
            allProjectEvidenceIds: ((allEvidenceResult.data ?? []) as Array<{ id: string }>).map(
              (record) => record.id
            ),
            existingThemes: (themesResult.data ?? []) as ThemeContext[],
          };
        }
      );

      if (trustedEvidence.length === 0) {
        await step.run("complete-empty", async () => {
          await completeRun({
            agentRunId,
            org_id,
            project_id,
            output: { trusted_evidence: 0, themes_created: 0, links_created: 0 },
          });
        });
        return { trusted_evidence: 0, themes_created: 0, links_created: 0 };
      }

      const synthesis = await step.run("synthesise-batches", async () => {
        const batches = chunk(trustedEvidence, 30);
        const themes: z.infer<typeof SynthesisedThemeSchema>[] = [];
        const models = new Set<string>();

        for (const batch of batches) {
          const result = await callLLM({
            tier: "premium",
            system:
              "You cluster trusted research evidence into concise themes. Return strict JSON only.",
            messages: [
              {
                role: "user",
                content: buildProjectSynthesisPrompt({
                  themes: formatExistingThemes(existingThemes),
                  evidence: formatEvidenceBatch(batch),
                }),
              },
            ],
            timeoutMs: 180_000,
          });

          models.add(result.model);
          const parsed = SynthesisedThemesSchema.safeParse(
            extractJsonArray(result.content)
          );

          if (!parsed.success) {
            throw new Error("Synthesis JSON did not match expected schema");
          }

          themes.push(...parsed.data);
        }

        return {
          themes,
          model_used: Array.from(models).join(", "),
        };
      });

      const output = await step.run("write-themes", async () => {
        const allowedEvidenceIds = new Set(trustedEvidence.map((record) => record.id));
        const touchedThemeIds = new Set<string>();
        let linksCreated = 0;

        if (allProjectEvidenceIds.length > 0) {
          for (const ids of chunk(allProjectEvidenceIds, 200)) {
            const { error } = await supabase
              .from("evidence_themes")
              .delete()
              .eq("org_id", org_id)
              .in("evidence_id", ids);

            if (error) throw new Error(`Failed to clear old theme links: ${error.message}`);
          }
        }

        for (const theme of synthesis.themes) {
          const label = cleanThemeLabel(theme.label);
          if (!label) continue;

          const evidenceIds = Array.from(
            new Set(theme.evidence_ids.filter((id) => allowedEvidenceIds.has(id)))
          );
          if (evidenceIds.length === 0) continue;

          const { data, error } = await supabase
            .from("themes")
            .upsert(
              {
                org_id,
                project_id,
                label,
                description: theme.description,
              },
              { onConflict: "project_id,label" }
            )
            .select("id")
            .single();

          if (error || !data) {
            throw new Error(`Failed to upsert theme ${label}: ${error?.message}`);
          }

          const themeId = data.id as string;
          touchedThemeIds.add(themeId);

          const rows = evidenceIds.map((evidenceId) => ({
            evidence_id: evidenceId,
            theme_id: themeId,
            org_id,
            confidence: null,
          }));

          const { error: linkError } = await supabase
            .from("evidence_themes")
            .upsert(rows, { onConflict: "evidence_id,theme_id" });

          if (linkError) {
            throw new Error(`Failed to link evidence to ${label}: ${linkError.message}`);
          }

          linksCreated += rows.length;
        }

        for (const themeId of Array.from(touchedThemeIds)) {
          const { count, error } = await supabase
            .from("evidence_themes")
            .select("*", { count: "exact", head: true })
            .eq("org_id", org_id)
            .eq("theme_id", themeId);

          if (error) throw new Error(`Failed to count theme evidence: ${error.message}`);

          const { error: updateError } = await supabase
            .from("themes")
            .update({ evidence_count: count ?? 0 })
            .eq("org_id", org_id)
            .eq("project_id", project_id)
            .eq("id", themeId);

          if (updateError) {
            throw new Error(`Failed to update theme evidence count: ${updateError.message}`);
          }
        }

        return {
          trusted_evidence: trustedEvidence.length,
          themes_created: touchedThemeIds.size,
          links_created: linksCreated,
        };
      });

      await step.run("complete-agent-run", async () => {
        await completeRun({
          agentRunId,
          org_id,
          project_id,
          output,
          model_used: synthesis.model_used,
        });
      });

      return output;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown synthesis error";
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
