// Company digest synthesis — generates an AI narrative profile for a company
// from all evidence linked to it across every project in the org.
//
// Triggered by: company/digest.requested
// Fires from:  extract-entities (after companies are resolved)
//              POST /api/companies/[companyId]/synthesise (on-demand refresh)

import { inngest } from "../client";
import { createServiceClient } from "@/lib/supabase/server";
import { callLLM } from "@/lib/llm/client";
import {
  buildCompanyDigestPrompt,
  COMPANY_DIGEST_PROMPT_VERSION,
} from "@/lib/llm/prompts/company-digest";

type CompanyRow = {
  name: string;
  domain: string | null;
  industry: string | null;
};

type PersonRow = {
  id: string;
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

function formatEvidenceForCompany(
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

// Minimum evidence records before generating a company digest
const MIN_EVIDENCE_FOR_DIGEST = 3;

export const synthesiseCompany = inngest.createFunction(
  { id: "synthesise-company", name: "Synthesise Company", retries: 2 },
  { event: "company/digest.requested" },
  async ({ event, step }) => {
    const { org_id, company_id } = event.data as { org_id: string; company_id: string };
    const supabase = createServiceClient();
    let agentRunId: string | null = null;

    try {
      agentRunId = await step.run("start-agent-run", async () => {
        const { data, error } = await supabase
          .from("agent_runs")
          .insert({
            org_id,
            project_id: null, // company digest is not project-scoped
            agent_type: "company-digest",
            input: { company_id, prompt_version: COMPANY_DIGEST_PROMPT_VERSION },
          })
          .select("id")
          .single();

        if (error || !data) {
          throw new Error(`Failed to start company digest run: ${error?.message}`);
        }
        return data.id as string;
      });

      const { company, evidence, projects, people } = await step.run(
        "fetch-company-and-evidence",
        async () => {
          const [companyResult, evidenceResult, peopleResult] = await Promise.all([
            supabase
              .from("companies")
              .select("name, domain, industry")
              .eq("org_id", org_id)
              .eq("id", company_id)
              .single(),
            supabase
              .from("evidence_entities")
              .select("evidence(id, content, summary, classification, sentiment, metadata, project_id)")
              .eq("org_id", org_id)
              .eq("entity_type", "company")
              .eq("entity_id", company_id),
            supabase
              .from("people")
              .select("id, name, role")
              .eq("org_id", org_id)
              .eq("company_id", company_id),
          ]);

          if (companyResult.error || !companyResult.data) {
            throw new Error(`Company not found: ${companyResult.error?.message}`);
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

          // Fetch project names for all referenced projects
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
            company: companyResult.data as CompanyRow,
            evidence,
            projects: (projectsResult.data ?? []) as ProjectRecord[],
            people: (peopleResult.data ?? []) as PersonRow[],
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

      const { digest, modelUsed } = await step.run("generate-digest", async () => {
        const projectNames = new Map(projects.map((p) => [p.id, p.name]));
        const uniqueProjectCount = projects.length;

        const peopleList =
          people.length > 0
            ? people
                .map((p) => `- ${p.name}${p.role ? ` (${p.role})` : ""}`)
                .join("\n")
            : "- No named people resolved from this company yet";

        const prompt = buildCompanyDigestPrompt({
          companyName: company.name,
          domain: company.domain,
          industry: company.industry,
          people: peopleList,
          evidence: formatEvidenceForCompany(evidence, projectNames),
          evidenceCount: evidence.length,
          projectCount: uniqueProjectCount,
        });

        const result = await callLLM({
          tier: "standard",
          system:
            "You write clear, direct intelligence profiles of customer companies for a product team. Write in prose — no headings, no bullets. Return only the profile text.",
          messages: [{ role: "user", content: prompt }],
          timeoutMs: 60_000,
        });

        return { digest: result.content.trim(), modelUsed: result.model };
      });

      await step.run("save-digest", async () => {
        const { error } = await supabase
          .from("companies")
          .update({
            digest,
            digest_updated_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq("org_id", org_id)
          .eq("id", company_id);

        if (error) {
          throw new Error(`Failed to save company digest: ${error.message}`);
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
              digest_length: digest.length,
            },
            model_used: modelUsed,
            completed_at: new Date().toISOString(),
          })
          .eq("org_id", org_id)
          .eq("id", agentRunId);
      });

      return { company_id, evidence_count: evidence.length, project_count: projects.length };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown company digest error";
      console.error("[synthesise-company] failed:", message);
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
