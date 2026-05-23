// Entity extraction — resolves people, companies, and competitors from evidence after ingest.

import { z } from "zod";
import { inngest } from "../client";
import { createServiceClient } from "@/lib/supabase/server";
import { callLLM } from "@/lib/llm/client";
import {
  buildEntityExtractionPrompt,
  ENTITY_EXTRACTION_PROMPT_VERSION,
} from "@/lib/llm/prompts/entities";

type EvidenceForEntityExtraction = {
  id: string;
  content: string;
  metadata: Record<string, unknown>;
};

type ExistingCompany = {
  id: string;
  name: string;
};

type ExistingPerson = {
  id: string;
  name: string;
};

type ExistingCompetitor = {
  id: string;
  slug: string;
};

const EntityExtractionSchema = z.object({
  people: z
    .array(
      z.object({
        name: z.string().trim().min(1),
        role: z.string().trim().nullable().optional(),
        company: z.string().trim().nullable().optional(),
        evidence_ids: z.array(z.string().uuid()).default([]),
      })
    )
    .default([]),
  companies: z
    .array(
      z.object({
        name: z.string().trim().min(1),
        domain: z.string().trim().nullable().optional(),
        evidence_ids: z.array(z.string().uuid()).default([]),
      })
    )
    .default([]),
  competitors: z
    .array(
      z.object({
        name: z.string().trim().min(1),
        slug: z.string().trim().min(1),
        website: z.string().trim().nullable().optional(),
        evidence_ids: z.array(z.string().uuid()).default([]),
      })
    )
    .default([]),
});

type EntityExtraction = z.infer<typeof EntityExtractionSchema>;

function normalizeName(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function extractJsonObject(content: string) {
  const trimmed = content.trim();
  const unfenced = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  const start = unfenced.indexOf("{");
  const end = unfenced.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) {
    throw new Error("Entity extraction returned no JSON object");
  }
  return JSON.parse(unfenced.slice(start, end + 1)) as unknown;
}

function formatEvidence(records: EvidenceForEntityExtraction[]) {
  return records
    .map((record) => {
      const speaker =
        typeof record.metadata?.speaker === "string" ? record.metadata.speaker : null;
      return [
        `ID: ${record.id}`,
        speaker ? `SPEAKER: ${speaker}` : null,
        `CONTENT: ${record.content.slice(0, 700)}`,
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n---\n\n");
}

function filterEvidenceIds(ids: string[], allowed: Set<string>) {
  return Array.from(new Set(ids.filter((id) => allowed.has(id))));
}

async function findOrCreateCompany(input: {
  org_id: string;
  name: string;
  domain?: string | null;
  existing: Map<string, ExistingCompany>;
  supabase: ReturnType<typeof createServiceClient>;
}) {
  const normalized = normalizeName(input.name);
  const existing = input.existing.get(normalized);
  if (existing) return existing.id;

  const { data, error } = await input.supabase
    .from("companies")
    .insert({
      org_id: input.org_id,
      name: input.name,
      domain: input.domain ?? null,
    })
    .select("id, name")
    .single();

  if (error || !data) {
    throw new Error(`Failed to create company ${input.name}: ${error?.message}`);
  }

  input.existing.set(normalized, { id: data.id, name: data.name });
  return data.id as string;
}

async function findOrCreatePerson(input: {
  org_id: string;
  name: string;
  role?: string | null;
  company_id?: string | null;
  existing: Map<string, ExistingPerson>;
  supabase: ReturnType<typeof createServiceClient>;
}) {
  const normalized = normalizeName(input.name);
  const existing = input.existing.get(normalized);
  if (existing) return existing.id;

  const { data, error } = await input.supabase
    .from("people")
    .insert({
      org_id: input.org_id,
      name: input.name,
      role: input.role ?? null,
      company_id: input.company_id ?? null,
      status: "interviewed",
    })
    .select("id, name")
    .single();

  if (error || !data) {
    throw new Error(`Failed to create person ${input.name}: ${error?.message}`);
  }

  input.existing.set(normalized, { id: data.id, name: data.name });
  return data.id as string;
}

async function findOrCreateCompetitor(input: {
  org_id: string;
  name: string;
  slug: string;
  website?: string | null;
  existing: Map<string, ExistingCompetitor>;
  supabase: ReturnType<typeof createServiceClient>;
}) {
  const existing = input.existing.get(input.slug);
  if (existing) return existing.id;

  const { data, error } = await input.supabase
    .from("competitors")
    .upsert(
      {
        org_id: input.org_id,
        name: input.name,
        slug: input.slug,
        website: input.website ?? null,
      },
      { onConflict: "org_id,slug" }
    )
    .select("id, slug")
    .single();

  if (error || !data) {
    throw new Error(`Failed to upsert competitor ${input.name}: ${error?.message}`);
  }

  input.existing.set(data.slug, { id: data.id, slug: data.slug });
  return data.id as string;
}

async function insertEvidenceEntity(input: {
  supabase: ReturnType<typeof createServiceClient>;
  org_id: string;
  project_id: string;
  evidence_id: string;
  entity_type: "person" | "company" | "competitor";
  entity_id: string;
  label: string;
  person_id?: string | null;
  company_id?: string | null;
  competitor_id?: string | null;
}) {
  const { error } = await input.supabase.from("evidence_entities").insert({
    org_id: input.org_id,
    project_id: input.project_id,
    evidence_id: input.evidence_id,
    entity_id: input.entity_id,
    entity_type: input.entity_type,
    label: input.label,
    person_id: input.person_id ?? null,
    company_id: input.company_id ?? null,
    competitor_id: input.competitor_id ?? null,
    relationship: "mentioned",
    metadata: {
      prompt_version: ENTITY_EXTRACTION_PROMPT_VERSION,
    },
  });

  if (error && error.code !== "23505") {
    throw new Error(`Failed to link ${input.entity_type}: ${error.message}`);
  }
}

export const extractEntities = inngest.createFunction(
  { id: "extract-entities", name: "Extract Entities", retries: 2 },
  { event: "source/entities.requested" },
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
            agent_type: "entity-extraction",
            input: { source_id },
          })
          .select("id")
          .single();

        if (error || !data) {
          throw new Error(`Failed to start entity agent run: ${error?.message}`);
        }
        return data.id as string;
      });

      const evidence = await step.run("fetch-evidence", async () => {
        const { data, error } = await supabase
          .from("evidence")
          .select("id, content, metadata")
          .eq("org_id", org_id)
          .eq("project_id", project_id)
          .eq("source_id", source_id)
          .order("created_at", { ascending: true });

        if (error) throw new Error(`Failed to fetch evidence: ${error.message}`);
        return (data ?? []) as EvidenceForEntityExtraction[];
      });

      if (evidence.length === 0) {
        await step.run("complete-empty", async () => {
          await supabase
            .from("agent_runs")
            .update({
              status: "completed",
              output: { people_resolved: 0, companies_resolved: 0, competitors_resolved: 0, links_created: 0 },
              completed_at: new Date().toISOString(),
            })
            .eq("org_id", org_id)
            .eq("id", agentRunId);
        });
        return { people: 0, companies: 0, competitors: 0, links: 0 };
      }

      const extraction = await step.run("extract-entities", async () => {
        const result = await callLLM({
          tier: "standard",
          system:
            "You extract structured entities from evidence. Return strict JSON only.",
          messages: [
            {
              role: "user",
              content: buildEntityExtractionPrompt({
                evidence: formatEvidence(evidence),
              }),
            },
          ],
          timeoutMs: 120_000,
        });

        const parsed = EntityExtractionSchema.safeParse(
          extractJsonObject(result.content)
        );

        if (!parsed.success) {
          throw new Error("Entity extraction JSON did not match expected schema");
        }

        return {
          extraction: parsed.data,
          model_used: result.model,
        };
      });

      const output = await step.run("resolve-and-link", async () => {
        const allowedEvidenceIds = new Set(evidence.map((record) => record.id));
        const [peopleResult, companiesResult, competitorsResult] = await Promise.all([
          supabase.from("people").select("id, name").eq("org_id", org_id),
          supabase.from("companies").select("id, name").eq("org_id", org_id),
          supabase.from("competitors").select("id, slug").eq("org_id", org_id),
        ]);

        if (peopleResult.error) {
          throw new Error(`Failed to fetch people: ${peopleResult.error.message}`);
        }
        if (companiesResult.error) {
          throw new Error(`Failed to fetch companies: ${companiesResult.error.message}`);
        }
        if (competitorsResult.error) {
          throw new Error(`Failed to fetch competitors: ${competitorsResult.error.message}`);
        }

        const existingPeople = new Map<string, ExistingPerson>(
          ((peopleResult.data ?? []) as ExistingPerson[]).map((person) => [
            normalizeName(person.name),
            person,
          ])
        );
        const existingCompanies = new Map<string, ExistingCompany>(
          ((companiesResult.data ?? []) as ExistingCompany[]).map((company) => [
            normalizeName(company.name),
            company,
          ])
        );
        const existingCompetitors = new Map<string, ExistingCompetitor>(
          ((competitorsResult.data ?? []) as ExistingCompetitor[]).map((c) => [
            c.slug,
            c,
          ])
        );

        const companyByName = new Map<string, string>();
        const competitorBySlug = new Map<string, string>();
        let companiesResolved = 0;
        let peopleResolved = 0;
        let competitorsResolved = 0;
        let linksCreated = 0;

        const companyInputs = [
          ...extraction.extraction.companies.map((company) => ({
            name: company.name,
            domain: company.domain ?? null,
          })),
          ...extraction.extraction.people
            .filter((person) => person.company)
            .map((person) => ({ name: person.company as string, domain: null })),
        ];

        for (const company of companyInputs) {
          const key = normalizeName(company.name);
          if (companyByName.has(key)) continue;
          const companyId = await findOrCreateCompany({
            org_id,
            name: company.name,
            domain: company.domain,
            existing: existingCompanies,
            supabase,
          });
          companyByName.set(key, companyId);
          companiesResolved += 1;

          await supabase
            .from("company_projects")
            .upsert(
              { company_id: companyId, project_id },
              { onConflict: "company_id,project_id" }
            );
        }

        for (const company of extraction.extraction.companies) {
          const companyId = companyByName.get(normalizeName(company.name));
          if (!companyId) continue;
          for (const evidenceId of filterEvidenceIds(
            company.evidence_ids,
            allowedEvidenceIds
          )) {
            await insertEvidenceEntity({
              supabase,
              org_id,
              project_id,
              evidence_id: evidenceId,
              entity_type: "company",
              entity_id: companyId,
              label: company.name,
              company_id: companyId,
            });
            linksCreated += 1;
          }
        }

        for (const person of extraction.extraction.people) {
          const companyId = person.company
            ? companyByName.get(normalizeName(person.company)) ?? null
            : null;
          const personId = await findOrCreatePerson({
            org_id,
            name: person.name,
            role: person.role ?? null,
            company_id: companyId,
            existing: existingPeople,
            supabase,
          });
          peopleResolved += 1;

          await supabase
            .from("person_projects")
            .upsert(
              { person_id: personId, project_id, status: "interviewed" },
              { onConflict: "person_id,project_id" }
            );

          for (const evidenceId of filterEvidenceIds(
            person.evidence_ids,
            allowedEvidenceIds
          )) {
            await insertEvidenceEntity({
              supabase,
              org_id,
              project_id,
              evidence_id: evidenceId,
              entity_type: "person",
              entity_id: personId,
              label: person.name,
              person_id: personId,
            });
            linksCreated += 1;
          }
        }

        // Resolve competitors
        for (const competitor of extraction.extraction.competitors) {
          const slug = competitor.slug
            .toLowerCase()
            .replace(/[^a-z0-9-]/g, "-")
            .replace(/-+/g, "-")
            .replace(/^-|-$/g, "");
          if (!slug) continue;
          if (!competitorBySlug.has(slug)) {
            const competitorId = await findOrCreateCompetitor({
              org_id,
              name: competitor.name,
              slug,
              website: competitor.website ?? null,
              existing: existingCompetitors,
              supabase,
            });
            competitorBySlug.set(slug, competitorId);
            competitorsResolved += 1;
          }

          const competitorId = competitorBySlug.get(slug);
          if (!competitorId) continue;

          for (const evidenceId of filterEvidenceIds(
            competitor.evidence_ids,
            allowedEvidenceIds
          )) {
            await insertEvidenceEntity({
              supabase,
              org_id,
              project_id,
              evidence_id: evidenceId,
              entity_type: "competitor",
              entity_id: competitorId,
              label: competitor.name,
              competitor_id: competitorId,
            });
            linksCreated += 1;
          }
        }

        return {
          people_resolved: peopleResolved,
          companies_resolved: companiesResolved,
          competitors_resolved: competitorsResolved,
          links_created: linksCreated,
        };
      });

      await step.run("complete-agent-run", async () => {
        await supabase
          .from("agent_runs")
          .update({
            status: "completed",
            output,
            model_used: extraction.model_used,
            completed_at: new Date().toISOString(),
          })
          .eq("org_id", org_id)
          .eq("id", agentRunId);
      });

      // Queue digest synthesis for any external people who have accumulated evidence.
      // Only external people produce customer evidence — internal people are skipped.
      // The synthesise-person function will check the evidence threshold itself (≥3 records).
      if (output.people_resolved > 0) {
        await step.run("queue-person-digests", async () => {
          // Find external people involved in this source who now have evidence
          const { data: involvedPeople } = await supabase
            .from("evidence_entities")
            .select("entity_id, people!inner(id, affiliation)")
            .eq("org_id", org_id)
            .eq("entity_type", "person")
            .eq("evidence.source_id", source_id)
            .neq("people.affiliation", "internal");

          const personIds = Array.from(
            new Set(
              ((involvedPeople ?? []) as Array<{ entity_id: string }>).map((r) => r.entity_id)
            )
          );

          if (personIds.length > 0) {
            await inngest.send(
              personIds.map((person_id) => ({
                name: "person/digest.requested" as const,
                data: { org_id, person_id },
              }))
            );
          }
        });
      }

      // Queue company digest synthesis for any companies resolved in this source.
      // The synthesise-company function checks the evidence threshold itself (≥3 records).
      if (output.companies_resolved > 0) {
        await step.run("queue-company-digests", async () => {
          const { data: involvedCompanies } = await supabase
            .from("evidence_entities")
            .select("entity_id")
            .eq("org_id", org_id)
            .eq("entity_type", "company")
            .eq("evidence.source_id", source_id);

          const companyIds = Array.from(
            new Set(
              ((involvedCompanies ?? []) as Array<{ entity_id: string }>).map((r) => r.entity_id)
            )
          );

          if (companyIds.length > 0) {
            await inngest.send(
              companyIds.map((company_id) => ({
                name: "company/digest.requested" as const,
                data: { org_id, company_id },
              }))
            );
          }
        });
      }

      // Queue competitor digest synthesis for any competitors resolved in this source.
      // Lower evidence threshold (≥2) since even one or two mentions are worth synthesising.
      if (output.competitors_resolved > 0) {
        await step.run("queue-competitor-digests", async () => {
          const { data: involvedCompetitors } = await supabase
            .from("evidence_entities")
            .select("entity_id")
            .eq("org_id", org_id)
            .eq("entity_type", "competitor")
            .eq("evidence.source_id", source_id);

          const competitorIds = Array.from(
            new Set(
              ((involvedCompetitors ?? []) as Array<{ entity_id: string }>).map((r) => r.entity_id)
            )
          );

          if (competitorIds.length > 0) {
            await inngest.send(
              competitorIds.map((competitor_id) => ({
                name: "competitor/digest.requested" as const,
                data: { org_id, competitor_id },
              }))
            );
          }
        });
      }

      return output;
    } catch (error) {
      // Entity extraction is background enrichment — a failure here does not
      // mean evidence was lost. Log to agent_runs for developer visibility
      // but do NOT re-throw. Surfacing this to users as a pipeline failure
      // would be misleading since the evidence records already exist.
      const message = error instanceof Error ? error.message : "Unknown entity error";
      console.error("[extract-entities] failed:", message);
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
      return { people: 0, companies: 0, competitors: 0, links: 0, skipped: true };
    }
  }
);
