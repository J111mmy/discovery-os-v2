// Compose artifact — durable document drafting via Inngest.
// Triggered by: artifact/compose.requested
// Replaces the synchronous Vercel route handler which hits the 60s timeout on large evidence sets.

import { inngest } from "../client";
import { createServiceClient } from "@/lib/supabase/server";
import { composeStructureDraft, type ArtifactLinkPlan } from "@/lib/compose/structure";
import { ArtifactHtmlValidationError } from "@/lib/sanitize/artifact-html";
import { markdownToSanitizedArtifactHtml } from "@/lib/sanitize/artifact-markdown";

function wordCount(text: string) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

async function assertArtifactLinkProvenanceColumns(
  supabase: ReturnType<typeof createServiceClient>
) {
  const checks = await Promise.all([
    supabase
      .from("artifact_evidence")
      .select("source, review_state, agent_run_id, rationale")
      .limit(0),
    supabase
      .from("artifact_problems")
      .select("source, review_state, agent_run_id, rationale")
      .limit(0),
    supabase
      .from("artifact_themes")
      .select("source, review_state, agent_run_id, rationale")
      .limit(0),
    supabase
      .from("artifact_opportunities")
      .select("source, review_state, agent_run_id, rationale")
      .limit(0),
  ]);

  const failure = checks.find((result) => result.error);
  if (failure?.error) {
    throw new Error(
      `Artifact link provenance columns are not ready; apply migration 0032 before structure-driven compose. ${failure.error.message}`
    );
  }
}

async function writeArtifactLinks({
  supabase,
  orgId,
  projectId,
  artifactId,
  agentRunId,
  linkPlan,
}: {
  supabase: ReturnType<typeof createServiceClient>;
  orgId: string;
  projectId: string;
  artifactId: string;
  agentRunId: string | null;
  linkPlan: ArtifactLinkPlan;
}) {
  const deleteResults = await Promise.all([
    supabase
      .from("artifact_evidence")
      .delete()
      .eq("org_id", orgId)
      .eq("project_id", projectId)
      .eq("artifact_id", artifactId),
    supabase
      .from("artifact_problems")
      .delete()
      .eq("org_id", orgId)
      .eq("project_id", projectId)
      .eq("artifact_id", artifactId),
    supabase
      .from("artifact_themes")
      .delete()
      .eq("org_id", orgId)
      .eq("project_id", projectId)
      .eq("artifact_id", artifactId),
    supabase
      .from("artifact_opportunities")
      .delete()
      .eq("org_id", orgId)
      .eq("project_id", projectId)
      .eq("artifact_id", artifactId),
  ]);

  const deleteFailure = deleteResults.find((result) => result.error);
  if (deleteFailure?.error) {
    throw new Error(`Failed to clear old artifact links: ${deleteFailure.error.message}`);
  }

  const evidenceRows = linkPlan.evidence.map((link) => ({
    org_id: orgId,
    project_id: projectId,
    artifact_id: artifactId,
    evidence_id: link.evidence_id,
    relationship: link.relationship,
    source: "ai",
    review_state: "suggested",
    agent_run_id: agentRunId,
    rationale: link.rationale,
  }));
  const problemRows = linkPlan.problems.map((link) => ({
    org_id: orgId,
    project_id: projectId,
    artifact_id: artifactId,
    problem_id: link.problem_id,
    relationship: link.relationship,
    source: "ai",
    review_state: "suggested",
    agent_run_id: agentRunId,
    rationale: link.rationale,
  }));
  const themeRows = linkPlan.themes.map((link) => ({
    org_id: orgId,
    project_id: projectId,
    artifact_id: artifactId,
    theme_id: link.theme_id,
    relationship: link.relationship,
    source: "ai",
    review_state: "suggested",
    agent_run_id: agentRunId,
    rationale: link.rationale,
  }));
  const opportunityRows = linkPlan.opportunities.map((link) => ({
    org_id: orgId,
    project_id: projectId,
    artifact_id: artifactId,
    opportunity_id: link.opportunity_id,
    relationship: link.relationship,
    source: "ai",
    review_state: "suggested",
    agent_run_id: agentRunId,
    rationale: link.rationale,
  }));

  const insertResults = await Promise.all([
    evidenceRows.length > 0
      ? supabase.from("artifact_evidence").insert(evidenceRows)
      : Promise.resolve({ error: null }),
    problemRows.length > 0
      ? supabase.from("artifact_problems").insert(problemRows)
      : Promise.resolve({ error: null }),
    themeRows.length > 0
      ? supabase.from("artifact_themes").insert(themeRows)
      : Promise.resolve({ error: null }),
    opportunityRows.length > 0
      ? supabase.from("artifact_opportunities").insert(opportunityRows)
      : Promise.resolve({ error: null }),
  ]);

  const insertFailure = insertResults.find((result) => result.error);
  if (insertFailure?.error) {
    throw new Error(`Failed to write artifact links: ${insertFailure.error.message}`);
  }

  return {
    artifact_evidence: evidenceRows.length,
    artifact_problems: problemRows.length,
    artifact_themes: themeRows.length,
    artifact_opportunities: opportunityRows.length,
  };
}

export const composeArtifact = inngest.createFunction(
  { id: "compose-artifact", name: "Compose Artifact", retries: 1 },
  { event: "artifact/compose.requested" },
  async ({ event, step }) => {
    const { org_id, project_id, artifact_id, prompt, limit } = event.data;
    const dryRun = Boolean(event.data.dry_run);
    const supabase = createServiceClient();
    let agentRunId: string | null = null;

    try {
      if (!dryRun && !artifact_id) {
        throw new Error("artifact_id is required for non-dry-run compose.");
      }

      await step.run("assert-provenance-schema", async () => {
        await assertArtifactLinkProvenanceColumns(supabase);
      });

      if (!dryRun) {
        agentRunId = await step.run("start-agent-run", async () => {
          const { data, error } = await supabase
            .from("agent_runs")
            .insert({
              org_id,
              project_id,
              agent_type: "structure-compose",
              input: {
                prompt,
                limit: limit ?? 18,
                compose_source: "structure_v1",
                dry_run: false,
              },
            })
            .select("id")
            .single();

          if (error || !data) {
            throw new Error(`Failed to start compose agent run: ${error?.message}`);
          }
          return data.id as string;
        });
      }

      const draft = await step.run("generate-draft", async () => {
        return composeStructureDraft({
          org_id,
          project_id,
          prompt,
          limit: limit ?? 18,
          dry_run: dryRun,
        });
      });

      if (dryRun) {
        return draft.report;
      }

      await step.run("save-draft", async () => {
        const contentMd = [
          `# ${draft.title}`,
          "",
          ...draft.sections.map((s) => `## ${s.heading}\n\n${s.content}`),
        ].join("\n\n");
        let contentHtml: string;

        try {
          contentHtml = markdownToSanitizedArtifactHtml(contentMd);
        } catch (error) {
          if (error instanceof ArtifactHtmlValidationError) {
            throw new Error("Generated artifact content did not satisfy the HTML safety contract.");
          }
          throw error;
        }

        const { error } = await supabase
          .from("artifacts")
          .update({
            title: draft.title,
            content_md: contentMd,
            content_html: contentHtml,
            word_count: wordCount(contentMd),
            model_used: draft.model_used,
            task_tier: draft.task_tier,
            metadata: {
              compose_status: "done",
              compose_source: "structure_v1",
              evidence_ids: draft.evidence_ids,
              citation_map: draft.citation_map,
              structure_trace: draft.structure_trace,
              compose_report: draft.report,
              prompt,
            },
            verification_status: "unverified",
            verification_run_at: null,
            verification_summary: null,
            updated_at: new Date().toISOString(),
          })
          .eq("org_id", org_id)
          .eq("project_id", project_id)
          .eq("id", artifact_id);

        if (error) {
          throw new Error(`Failed to save composed artifact: ${error.message}`);
        }

        const linkCounts = await writeArtifactLinks({
          supabase,
          orgId: org_id,
          projectId: project_id,
          artifactId: artifact_id!,
          agentRunId,
          linkPlan: draft.link_plan,
        });

        await supabase
          .from("agent_runs")
          .update({
            status: "completed",
            output: {
              ...draft.report,
              link_counts: linkCounts,
            },
            model_used: draft.model_used,
            completed_at: new Date().toISOString(),
          })
          .eq("org_id", org_id)
          .eq("id", agentRunId!);
      });

      await step.run("queue-verification", async () => {
        await inngest.send({
          name: "artifact/claim.verification.requested",
          data: {
            org_id,
            project_id,
            artifact_id: artifact_id!,
          },
        });
      });

      return { artifact_id, title: draft.title, evidence_count: draft.evidence_ids.length };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown compose error";
      console.error("[compose-artifact] failed:", message);

      // Mark the stub as failed so the client can show an error state
      if (artifact_id) {
        await supabase
          .from("artifacts")
          .update({
            metadata: {
              compose_status: "failed",
              compose_error: message,
              prompt,
            },
            updated_at: new Date().toISOString(),
          })
          .eq("org_id", org_id)
          .eq("id", artifact_id);
      }

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

      throw error; // Re-throw so Inngest marks the run as failed
    }
  }
);
