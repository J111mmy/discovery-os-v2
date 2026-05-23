// Person digest synthesis — generates an AI narrative profile for a person
// from all their linked evidence records across every project in the org.
//
// Triggered by: person/digest.requested
// Fires from: extract-entities (after people are resolved, if evidence ≥ threshold)
//             POST /api/people/[personId]/synthesise (on-demand refresh)

import { inngest } from "../client";
import { createServiceClient } from "@/lib/supabase/server";
import { callLLM } from "@/lib/llm/client";
import {
  buildPersonDigestPrompt,
  PERSON_DIGEST_PROMPT_VERSION,
} from "@/lib/llm/prompts/person-digest";

type PersonRow = {
  name: string;
  role: string | null;
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

function formatEvidenceForDigest(
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
      const header = `### Record ${index + 1} — ${classification}${sentiment} · ${project}${speaker}`;

      return [header, record.content, record.summary ? `*${record.summary}*` : null]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n---\n\n");
}

// Minimum evidence records needed before generating a digest — avoids
// thin profiles that would just say "not enough information"
const MIN_EVIDENCE_FOR_DIGEST = 3;

export const synthesisePerson = inngest.createFunction(
  { id: "synthesise-person", name: "Synthesise Person", retries: 2 },
  { event: "person/digest.requested" },
  async ({ event, step }) => {
    const { org_id, person_id } = event.data;
    const supabase = createServiceClient();
    let agentRunId: string | null = null;

    try {
      agentRunId = await step.run("start-agent-run", async () => {
        const { data, error } = await supabase
          .from("agent_runs")
          .insert({
            org_id,
            // person digest is not project-scoped — use null project_id
            project_id: null,
            agent_type: "person-digest",
            input: { person_id, prompt_version: PERSON_DIGEST_PROMPT_VERSION },
          })
          .select("id")
          .single();

        if (error || !data) {
          throw new Error(`Failed to start person digest run: ${error?.message}`);
        }
        return data.id as string;
      });

      const { person, evidence, projects } = await step.run("fetch-person-and-evidence", async () => {
        const [personResult, evidenceResult] = await Promise.all([
          supabase
            .from("people")
            .select("name, role")
            .eq("org_id", org_id)
            .eq("id", person_id)
            .single(),
          supabase
            .from("evidence_entities")
            .select("evidence(id, content, summary, classification, sentiment, metadata, project_id)")
            .eq("org_id", org_id)
            .eq("entity_type", "person")
            .eq("entity_id", person_id),
        ]);

        if (personResult.error || !personResult.data) {
          throw new Error(`Person not found: ${personResult.error?.message}`);
        }
        if (evidenceResult.error) {
          throw new Error(`Failed to fetch evidence: ${evidenceResult.error.message}`);
        }

        // Flatten the nested join result
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

        // Fetch project names for all referenced projects
        const projectIds = Array.from(new Set(evidence.map((e) => e.project_id)));
        const projectsResult = projectIds.length > 0
          ? await supabase
              .from("projects")
              .select("id, name")
              .eq("org_id", org_id)
              .in("id", projectIds)
          : { data: [] };

        return {
          person: personResult.data as PersonRow,
          evidence,
          projects: (projectsResult.data ?? []) as ProjectRecord[],
        };
      });

      if (evidence.length < MIN_EVIDENCE_FOR_DIGEST) {
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
        return { skipped: true, reason: "insufficient_evidence", evidence_count: evidence.length };
      }

      const { digest, modelUsed } = await step.run("generate-digest", async () => {
        const projectNames = new Map(projects.map((p) => [p.id, p.name]));
        const uniqueProjectNames = projects.map((p) => p.name);

        const prompt = buildPersonDigestPrompt({
          personName: person.name,
          personRole: person.role,
          projects: uniqueProjectNames,
          evidence: formatEvidenceForDigest(evidence, projectNames),
          evidenceCount: evidence.length,
        });

        const result = await callLLM({
          tier: "standard",
          system:
            "You write clear, direct intelligence profiles of research participants. Write in prose — no headings, no bullets. Return only the profile text.",
          messages: [{ role: "user", content: prompt }],
          timeoutMs: 60_000,
        });

        return { digest: result.content.trim(), modelUsed: result.model };
      });

      await step.run("save-digest", async () => {
        const { error } = await supabase
          .from("people")
          .update({
            digest,
            digest_updated_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq("org_id", org_id)
          .eq("id", person_id);

        if (error) {
          throw new Error(`Failed to save digest: ${error.message}`);
        }
      });

      await step.run("complete-agent-run", async () => {
        await supabase
          .from("agent_runs")
          .update({
            status: "completed",
            output: { evidence_count: evidence.length, digest_length: digest.length },
            model_used: modelUsed,
            completed_at: new Date().toISOString(),
          })
          .eq("org_id", org_id)
          .eq("id", agentRunId);
      });

      return { person_id, evidence_count: evidence.length };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown digest error";
      console.error("[synthesise-person] failed:", message);
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
