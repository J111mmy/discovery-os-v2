// Project synthesis — clusters trusted evidence into reusable themes.

import { z } from "zod";
import { inngest } from "../client";
import { createServiceClient } from "@/lib/supabase/server";
import { callLLM } from "@/lib/llm/client";
import {
  buildProjectSynthesisPrompt,
  PROJECT_SYNTHESIS_PROMPT_VERSION,
} from "@/lib/llm/prompts/synthesis";
import { VISIBLE_REVIEW_STATES } from "@/lib/research-ontology/review-states";

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

const REPLACEABLE_THEME_EVIDENCE_SOURCES = ["ai", "imported"] as const;

// Resilient parse: a single malformed theme must not fail the whole batch —
// validate per-element, drop (with a warning) the invalid ones, keep the
// valid ones. Mirrors discover-problems' per-candidate parsing (issue #30).
// Returns the dropped count so the caller can audit/guard against silent
// data loss (Codex P1/P3 review of 88f77ad).
function parseSynthesisedThemes(raw: unknown): {
  themes: z.infer<typeof SynthesisedThemeSchema>[];
  dropped: number;
} {
  if (!Array.isArray(raw)) {
    throw new Error("Synthesis did not return a JSON array");
  }

  const valid: z.infer<typeof SynthesisedThemeSchema>[] = [];
  let dropped = 0;
  raw.forEach((element, index) => {
    const parsed = SynthesisedThemeSchema.safeParse(element);
    if (parsed.success) {
      valid.push(parsed.data);
      return;
    }
    dropped += 1;
    const failingPaths = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("; ");
    console.warn(
      `[synthesise-project] dropped invalid theme candidate at index ${index}: ${failingPaths}`
    );
  });
  return { themes: valid, dropped };
}

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
        let droppedThemes = 0;

        for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
          const batch = batches[batchIndex];
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
            telemetry: {
              orgId: org_id,
              projectId: project_id,
              agentRunId,
              agentType: "project-synthesis",
              step: `synthesise-batch-${String(batchIndex + 1).padStart(4, "0")}`,
            },
          });

          models.add(result.model);
          // Resilient parse: extractJsonArray still throws if the response is
          // not a parseable JSON array at all. A single malformed theme within
          // the array must not fail the whole batch — see parseSynthesisedThemes.
          const batchResult = parseSynthesisedThemes(extractJsonArray(result.content));

          themes.push(...batchResult.themes);
          droppedThemes += batchResult.dropped;
        }

        return {
          themes,
          dropped_themes: droppedThemes,
          model_used: Array.from(models).join(", "),
        };
      });

      const output = await step.run("write-themes", async () => {
        const allowedEvidenceIds = new Set(trustedEvidence.map((record) => record.id));
        const touchedThemeIds = new Set<string>();
        let linksCreated = 0;

        // FAIL CLOSED before the destructive clear (Codex P1 review of 88f77ad).
        // The resilient per-theme parse means a mostly/entirely invalid model
        // response can yield an empty (or no-writeable) theme set. If we delete
        // all existing theme_evidence first and then write nothing, a model-
        // output failure becomes silent synthesis data loss. So: compute the
        // writeable themes (valid label + at least one allowed evidence id)
        // BEFORE deleting anything, and abort the run (preserving existing
        // links, leaving synthesis_stale=true) if there are none while trusted
        // evidence exists. The throw propagates to the catch block, which marks
        // the agent run failed and never reaches complete-agent-run/completeRun
        // (so synthesis is NOT marked fresh and downstream agents do not fire).
        const writeableThemes = synthesis.themes
          .map((theme) => ({
            label: cleanThemeLabel(theme.label),
            description: theme.description,
            evidenceIds: Array.from(
              new Set(theme.evidence_ids.filter((id) => allowedEvidenceIds.has(id)))
            ),
          }))
          .filter((theme) => theme.label && theme.evidenceIds.length > 0);

        if (writeableThemes.length === 0 && trustedEvidence.length > 0) {
          throw new Error(
            `Synthesis produced no writeable themes from ${trustedEvidence.length} trusted ` +
              `evidence records (parsed ${synthesis.themes.length}, dropped ${synthesis.dropped_themes}). ` +
              `Failing closed to preserve existing theme links rather than clearing them.`
          );
        }

        if (allProjectEvidenceIds.length > 0) {
          for (const ids of chunk(allProjectEvidenceIds, 200)) {
            const { error } = await supabase
              .from("theme_evidence")
              .delete()
              .eq("org_id", org_id)
              .eq("project_id", project_id)
              .eq("relationship", "supporting")
              .eq("review_state", "suggested")
              .in("source", [...REPLACEABLE_THEME_EVIDENCE_SOURCES])
              .in("evidence_id", ids);

            if (error) throw new Error(`Failed to clear old theme links: ${error.message}`);
          }
        }

        for (const theme of writeableThemes) {
          const label = theme.label;
          const evidenceIds = theme.evidenceIds;

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
            org_id,
            project_id,
            evidence_id: evidenceId,
            theme_id: themeId,
            relationship: "supporting",
            source: "ai",
            review_state: "suggested",
            confidence: null,
            rationale: "Linked by project synthesis from trusted evidence.",
            agent_run_id: agentRunId,
          }));

          const { error: linkError } = await supabase
            .from("theme_evidence")
            .upsert(rows, {
              onConflict: "theme_id,evidence_id,relationship",
              ignoreDuplicates: true,
            });

          if (linkError) {
            throw new Error(`Failed to link evidence to ${label}: ${linkError.message}`);
          }

          linksCreated += rows.length;
        }

        const { data: projectThemes, error: projectThemesError } = await supabase
          .from("themes")
          .select("id")
          .eq("org_id", org_id)
          .eq("project_id", project_id);

        if (projectThemesError) {
          throw new Error(`Failed to load project themes for counts: ${projectThemesError.message}`);
        }

        for (const theme of (projectThemes ?? []) as Array<{ id: string }>) {
          const { data: countRows, error } = await supabase
            .from("theme_evidence")
            .select("evidence_id")
            .eq("org_id", org_id)
            .eq("project_id", project_id)
            .eq("theme_id", theme.id)
            .in("review_state", [...VISIBLE_REVIEW_STATES]);

          if (error) throw new Error(`Failed to count theme evidence: ${error.message}`);
          const evidenceCount = new Set(
            ((countRows ?? []) as Array<{ evidence_id: string }>).map((row) => row.evidence_id)
          ).size;

          const { error: updateError } = await supabase
            .from("themes")
            .update({ evidence_count: evidenceCount })
            .eq("org_id", org_id)
            .eq("project_id", project_id)
            .eq("id", theme.id);

          if (updateError) {
            throw new Error(`Failed to update theme evidence count: ${updateError.message}`);
          }
        }

        return {
          trusted_evidence: trustedEvidence.length,
          themes_created: touchedThemeIds.size,
          themes_parsed: synthesis.themes.length,
          themes_dropped: synthesis.dropped_themes,
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

      // Chain: trigger problem discovery + gap detection now that themes are fresh
      await step.run("trigger-downstream-agents", async () => {
        await inngest.send([
          {
            name: "project/problems.requested",
            data: { org_id, project_id },
          },
          {
            name: "project/synthesis.completed",
            data: { org_id, project_id },
          },
        ]);
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
