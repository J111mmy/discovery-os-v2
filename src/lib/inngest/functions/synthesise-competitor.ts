// Competitor digest synthesis — generates structured competitive intelligence
// from all evidence mentioning a competitor across every project in the org.
//
// Triggered by: competitor/digest.requested
// Fires from:  extract-entities (after competitors are resolved)
//              POST /api/competitors/[competitorId]/synthesise (on-demand)
//
// Writes to:
//   competitors.digest              — prose narrative
//   competitors.digest_updated_at   — timestamp
//   competitors.battle_card         — structured 5-field battle card (3 AI fields)
//   competitors.positioning         — updates from evidence
//   competitors.known_strengths     — updates from evidence
//   competitors.known_gaps          — updates from evidence
//   competitors.last_researched     — set to today

import { inngest } from "../client";
import { createServiceClient } from "@/lib/supabase/server";
import { callLLM } from "@/lib/llm/client";
import {
  buildCompetitorDigestPrompt,
  parseCompetitorDigestResult,
  COMPETITOR_DIGEST_PROMPT_VERSION,
} from "@/lib/llm/prompts/competitor-digest";

type CompetitorRow = {
  name: string;
  website: string | null;
};

type EvidenceRecord = {
  id: string;
  content: string;
  summary: string | null;
  classification: string | null;
  sentiment: string | null;
  metadata: Record<string, unknown>;
  project_id: string;
};

type ProjectRecord = {
  id: string;
  name: string;
};

function formatEvidenceForCompetitor(
  records: EvidenceRecord[],
  projectNames: Map<string, string>
): string {
  return records
    .map((record, index) => {
      const speaker =
        typeof record.metadata?.speaker === "string" && record.metadata.speaker
          ? ` [${record.metadata.speaker}]`
          : "";
      const project = projectNames.get(record.project_id) ?? "Unknown project";
      const classification = record.classification ?? "signal";
      const sentiment = record.sentiment ? ` / ${record.sentiment}` : "";
      const header = `### Record ${index + 1}: ${classification}${sentiment} · ${project}${speaker}`;

      return [header, record.content, record.summary ? `*${record.summary}*` : null]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n---\n\n");
}

const MIN_EVIDENCE_FOR_DIGEST = 2; // Lower bar than person/company — even 2 mentions is useful for competitive intel

export const synthesiseCompetitor = inngest.createFunction(
  { id: "synthesise-competitor", name: "Synthesise Competitor", retries: 2 },
  { event: "competitor/digest.requested" },
  async ({ event, step }) => {
    const { org_id, competitor_id } = event.data as {
      org_id: string;
      competitor_id: string;
    };

    const supabase = createServiceClient();
    let agentRunId: string | null = null;

    try {
      agentRunId = await step.run("start-agent-run", async () => {
        const { data, error } = await supabase
          .from("agent_runs")
          .insert({
            org_id,
            project_id: null, // competitor digest is not project-scoped
            agent_type: "competitor-digest",
            input: { competitor_id, prompt_version: COMPETITOR_DIGEST_PROMPT_VERSION },
          })
          .select("id")
          .single();

        if (error || !data) {
          throw new Error(`Failed to start competitor digest run: ${error?.message}`);
        }
        return data.id as string;
      });

      const { competitor, evidence, projects } = await step.run(
        "fetch-competitor-and-evidence",
        async () => {
          const [competitorResult, evidenceResult] = await Promise.all([
            supabase
              .from("competitors")
              .select("name, website")
              .eq("org_id", org_id)
              .eq("id", competitor_id)
              .single(),
            supabase
              .from("evidence_entities")
              .select("evidence(id, content, summary, classification, sentiment, metadata, project_id)")
              .eq("org_id", org_id)
              .eq("entity_type", "competitor")
              .eq("entity_id", competitor_id),
          ]);

          if (competitorResult.error || !competitorResult.data) {
            throw new Error(`Competitor not found: ${competitorResult.error?.message}`);
          }
          if (evidenceResult.error) {
            throw new Error(`Failed to fetch evidence: ${evidenceResult.error.message}`);
          }

          // Flatten nested join
          type RawRow = { evidence: EvidenceRecord | EvidenceRecord[] | null };
          const rawEvidence = ((evidenceResult.data ?? []) as RawRow[])
            .flatMap((row) => {
              const e = row.evidence;
              if (!e) return [] as EvidenceRecord[];
              return Array.isArray(e) ? e : [e];
            })
            .filter((e): e is EvidenceRecord => Boolean(e?.content));

          // Deduplicate by evidence id
          const seen = new Set<string>();
          const evidence = rawEvidence.filter((e) => {
            if (seen.has(e.id)) return false;
            seen.add(e.id);
            return true;
          });

          // Fetch project names
          const projectIds = Array.from(new Set(evidence.map((e) => e.project_id)));
          const projectsResult =
            projectIds.length > 0
              ? await supabase
                  .from("projects")
                  .select("id, name")
                  .eq("org_id", org_id)
                  .in("id", projectIds)
              : { data: [] };

          return {
            competitor: competitorResult.data as CompetitorRow,
            evidence,
            projects: (projectsResult.data ?? []) as ProjectRecord[],
          };
        }
      );

      if (evidence.length < MIN_EVIDENCE_FOR_DIGEST) {
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

      const { result, modelUsed } = await step.run("generate-digest", async () => {
        const projectNames = new Map(projects.map((p) => [p.id, p.name]));

        const prompt = buildCompetitorDigestPrompt({
          competitorName: competitor.name,
          website: competitor.website,
          evidence: formatEvidenceForCompetitor(evidence, projectNames),
          evidenceCount: evidence.length,
          projectCount: projects.length,
        });

        const llmResult = await callLLM({
          tier: "standard",
          system:
            "You are a competitive intelligence analyst. Extract structured competitive intelligence from customer evidence. Be specific and evidence-driven. Return only valid JSON.",
          messages: [{ role: "user", content: prompt }],
          timeoutMs: 50_000,
          telemetry: {
            orgId: org_id,
            agentRunId,
            agentType: "competitor-digest",
            step: "generate-digest",
          },
        });

        const parsed = parseCompetitorDigestResult(llmResult.content);
        if (!parsed) {
          throw new Error(
            `Competitor digest JSON parse failed. Raw: ${llmResult.content.slice(0, 200)}`
          );
        }

        return { result: parsed, modelUsed: llmResult.model };
      });

      await step.run("save-digest", async () => {
        const { error } = await supabase
          .from("competitors")
          .update({
            digest: result.digest,
            digest_updated_at: new Date().toISOString(),
            battle_card: result.battle_card,
            positioning: result.positioning,
            known_strengths: result.known_strengths,
            known_gaps: result.known_gaps,
            last_researched: new Date().toISOString().slice(0, 10), // date only
            updated_at: new Date().toISOString(),
          })
          .eq("org_id", org_id)
          .eq("id", competitor_id);

        if (error) {
          throw new Error(`Failed to save competitor digest: ${error.message}`);
        }
      });

      await step.run("complete-agent-run", async () => {
        await supabase
          .from("agent_runs")
          .update({
            status: "completed",
            output: {
              evidence_count: evidence.length,
              project_count: projects.length,
              digest_length: result.digest.length,
            },
            model_used: modelUsed,
            completed_at: new Date().toISOString(),
          })
          .eq("org_id", org_id)
          .eq("id", agentRunId);
      });

      return { competitor_id, evidence_count: evidence.length, project_count: projects.length };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown competitor digest error";
      console.error("[synthesise-competitor] failed:", message);
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
