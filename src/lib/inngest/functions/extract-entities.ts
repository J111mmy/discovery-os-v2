// Entity extraction — resolves people, companies, and competitors from evidence after ingest.

import { z } from "zod";
import { inngest } from "../client";
import { createServiceClient } from "@/lib/supabase/server";
import {
  buildResolutionLookup,
  parseEntityResolutions,
  type EntityResolution,
} from "@/lib/ingest/entity-resolutions";
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

type ProjectEntityContext = {
  name: string;
  frame: string | null;
  frame_data: Record<string, unknown> | null;
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

const PersonCandidateSchema = z.object({
  name: z.string().trim().min(1),
  role: z.string().trim().nullable().optional(),
  company: z.string().trim().nullable().optional(),
  evidence_ids: z.array(z.string().uuid()).default([]),
});

const CompanyCandidateSchema = z.object({
  name: z.string().trim().min(1),
  domain: z.string().trim().nullable().optional(),
  evidence_ids: z.array(z.string().uuid()).default([]),
});

const CompetitorCandidateSchema = z.object({
  name: z.string().trim().min(1),
  slug: z.string().trim().min(1),
  website: z.string().trim().nullable().optional(),
  evidence_ids: z.array(z.string().uuid()).default([]),
});

type EntityExtraction = {
  people: z.infer<typeof PersonCandidateSchema>[];
  companies: z.infer<typeof CompanyCandidateSchema>[];
  competitors: z.infer<typeof CompetitorCandidateSchema>[];
};

type EntityDropCounts = { people: number; companies: number; competitors: number };
type EntityFilterCounts = { companies: number; competitors: number };

// Resilient parse: a single malformed person/company/competitor must not fail
// the whole extraction. Validate each element individually, drop (with a
// warning) the invalid ones, and keep the valid ones — mirrors discover-problems.
// Returns dropped counts so an apparently-successful extraction that was
// actually partial is auditable in agent_runs.output (Codex P3 review of 88f77ad).
function parseEntityExtraction(raw: unknown): {
  extraction: EntityExtraction;
  dropped: EntityDropCounts;
} {
  const root = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const dropped: EntityDropCounts = { people: 0, companies: 0, competitors: 0 };

  function parseList<T extends z.ZodTypeAny>(
    key: keyof EntityDropCounts,
    schema: T
  ): z.infer<T>[] {
    const list = root[key];
    if (!Array.isArray(list)) return [];
    const valid: z.infer<T>[] = [];
    list.forEach((element, index) => {
      const parsed = schema.safeParse(element);
      if (parsed.success) {
        valid.push(parsed.data);
        return;
      }
      dropped[key] += 1;
      const failingPaths = parsed.error.issues
        .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
        .join("; ");
      console.warn(
        `[extract-entities] dropped invalid ${key} candidate at index ${index}: ${failingPaths}`
      );
    });
    return valid;
  }

  return {
    extraction: {
      people: parseList("people", PersonCandidateSchema),
      companies: parseList("companies", CompanyCandidateSchema),
      competitors: parseList("competitors", CompetitorCandidateSchema),
    },
    dropped,
  };
}

function normalizeName(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function canonicalOrgKey(value: string) {
  return normalizeName(value)
    .replace(/\bcircle ci\b/g, "circleci")
    .replace(/\bfossa asia\b/g, "fossasia")
    .replace(/\bfossasia\s+(?:community|foundation|project|organisation|organization|team)\b/g, "fossasia")
    .replace(/\b(?:community|foundation|project|organisation|organization|team)\b$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const NON_COMPANY_ENTITY_KEYS = new Set([
  "india",
  "google summer of code",
  "gsoc",
  "dependabot",
  "apple watch",
]);

const PRODUCT_OR_TOOL_ENTITY_KEYS = new Set([
  "black",
  "circleci",
  "circle ci",
  "dependabot",
  "github actions",
  "apple watch",
  "jboss",
]);

function isRejectedCompanyName(name: string) {
  const normalized = normalizeName(name);
  const canonical = canonicalOrgKey(name);
  if (!normalized || normalized.length < 2) return true;
  if (NON_COMPANY_ENTITY_KEYS.has(normalized) || NON_COMPANY_ENTITY_KEYS.has(canonical)) {
    return true;
  }
  if (PRODUCT_OR_TOOL_ENTITY_KEYS.has(normalized) || PRODUCT_OR_TOOL_ENTITY_KEYS.has(canonical)) {
    return true;
  }
  if (/\b(?:bot|dependabot)\b/i.test(name)) return true;
  if (/\b(?:summer of code|programme|program|grant|conference|event)\b/i.test(name)) {
    return true;
  }
  return false;
}

function isRejectedCompetitorName(name: string) {
  const normalized = normalizeName(name);
  const canonical = canonicalOrgKey(name);
  if (!normalized || normalized.length < 2) return true;
  if (NON_COMPANY_ENTITY_KEYS.has(normalized) || NON_COMPANY_ENTITY_KEYS.has(canonical)) {
    return true;
  }
  return /\b(?:bot|dependabot)\b/i.test(name);
}

function formatProjectFrame(project: ProjectEntityContext) {
  const frameData =
    project.frame_data && Object.keys(project.frame_data).length > 0
      ? JSON.stringify(project.frame_data, null, 2)
      : "";
  const frame = project.frame?.trim() ?? "";
  const parts = [
    `Project: ${project.name}`,
    frame ? `Frame text:\n${frame}` : null,
    frameData ? `Structured frame:\n${frameData}` : null,
  ].filter(Boolean);

  return parts.length > 0
    ? parts.join("\n\n")
    : "No project frame is set. Treat this as no product context for competitor extraction.";
}

function hasProductCompetitionContext(project: ProjectEntityContext) {
  const fields = [
    project.name,
    project.frame ?? "",
    project.frame_data ? JSON.stringify(project.frame_data) : "",
  ].join(" ");
  const normalized = normalizeName(fields);
  if (!normalized) return false;

  const hasProductObject =
    /\b(product|platform|app|application|software|tool|service|solution|workflow|prototype|offering)\b/.test(
      normalized
    );
  const hasResearchOrMarketContext =
    /\b(competitor|competition|alternative|replace|replacement|current solution|prior solution|users|customers|buyers|market|using today|currently use|our|we|build|building)\b/.test(
      normalized
    );

  return hasProductObject && hasResearchOrMarketContext;
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

function filterExtractionForProject(input: {
  extraction: EntityExtraction;
  hasCompetitorContext: boolean;
}) {
  const filtered: EntityExtraction = {
    people: input.extraction.people,
    companies: [],
    competitors: [],
  };
  const dropped: EntityFilterCounts = { companies: 0, competitors: 0 };
  const companyKeys = new Set<string>();
  const competitorKeys = new Set<string>();

  for (const company of input.extraction.companies) {
    const key = canonicalOrgKey(company.name);
    if (!key || isRejectedCompanyName(company.name)) {
      dropped.companies += 1;
      continue;
    }
    if (companyKeys.has(key)) {
      dropped.companies += 1;
      continue;
    }
    companyKeys.add(key);
    filtered.companies.push(company);
  }

  if (!input.hasCompetitorContext) {
    dropped.competitors += input.extraction.competitors.length;
    return { extraction: filtered, dropped };
  }

  for (const competitor of input.extraction.competitors) {
    const key = canonicalOrgKey(competitor.name);
    if (!key || isRejectedCompetitorName(competitor.name)) {
      dropped.competitors += 1;
      continue;
    }
    if (competitorKeys.has(key)) {
      dropped.competitors += 1;
      continue;
    }
    competitorKeys.add(key);
    filtered.competitors.push(competitor);
  }

  return { extraction: filtered, dropped };
}

function evidenceIdsForResolution(
  evidence: EvidenceForEntityExtraction[],
  resolution: EntityResolution
) {
  const labels = [
    resolution.raw_label,
    resolution.resolved_name ?? null,
  ]
    .map((label) => (label ? normalizeName(label) : ""))
    .filter(Boolean);

  return evidence
    .filter((record) => {
      const metadataSpeaker =
        typeof record.metadata?.speaker === "string" ? record.metadata.speaker : null;
      const originalSpeaker =
        typeof record.metadata?.speaker_original_label === "string"
          ? record.metadata.speaker_original_label
          : null;
      const speakerLabels = [metadataSpeaker, originalSpeaker]
        .map((label) => (label ? normalizeName(label) : ""))
        .filter(Boolean);
      return speakerLabels.some((label) => labels.includes(label));
    })
    .map((record) => record.id);
}

async function findOrCreateCompany(input: {
  org_id: string;
  name: string;
  domain?: string | null;
  existing: Map<string, ExistingCompany>;
  supabase: ReturnType<typeof createServiceClient>;
}) {
  const normalized = canonicalOrgKey(input.name);
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

  input.existing.set(canonicalOrgKey(data.name), { id: data.id, name: data.name });
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

      const entityResolutions = await step.run("fetch-entity-resolutions", async () => {
        const { data, error } = await supabase
          .from("sources")
          .select("metadata")
          .eq("org_id", org_id)
          .eq("project_id", project_id)
          .eq("id", source_id)
          .single();

        if (error) {
          throw new Error(`Failed to fetch source resolutions: ${error.message}`);
        }

        return parseEntityResolutions(
          (data as { metadata?: Record<string, unknown> } | null)?.metadata
            ?.entity_resolutions
        );
      });

      const project = await step.run("fetch-project-frame", async () => {
        const { data, error } = await supabase
          .from("projects")
          .select("name, frame, frame_data")
          .eq("org_id", org_id)
          .eq("id", project_id)
          .single();

        if (error || !data) {
          throw new Error(
            `Failed to fetch project frame for entity extraction: ${error?.message ?? "missing project"}`
          );
        }

        return data as ProjectEntityContext;
      });
      const projectFrame = formatProjectFrame(project);
      const hasCompetitorContext = hasProductCompetitionContext(project);

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
          // Standard tier defaults to 2048 output tokens, which truncates on
          // evidence-dense sources with many people/companies/competitors.
          // Bump the cap for this call only — see issue #30.
          maxTokens: 4096,
          system:
            "You extract structured entities from evidence. Return strict JSON only.",
          messages: [
            {
              role: "user",
              content: buildEntityExtractionPrompt({
                evidence: formatEvidence(evidence),
                projectFrame,
              }),
            },
          ],
          timeoutMs: 120_000,
          telemetry: {
            orgId: org_id,
            projectId: project_id,
            agentRunId,
            agentType: "entity-extraction",
            step: "extract-entities",
          },
        });

        // Resilient parse: a truncated/malformed people/companies/competitors
        // entry must not fail the whole extraction — see parseEntityExtraction.
        const { extraction: parsedExtraction, dropped } = parseEntityExtraction(
          extractJsonObject(result.content)
        );
        const filtered = filterExtractionForProject({
          extraction: parsedExtraction,
          hasCompetitorContext,
        });

        return {
          extraction: filtered.extraction,
          dropped,
          filtered: filtered.dropped,
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
        const existingPeopleById = new Map<string, ExistingPerson>(
          ((peopleResult.data ?? []) as ExistingPerson[]).map((person) => [
            person.id,
            person,
          ])
        );
        const existingCompanies = new Map<string, ExistingCompany>(
          ((companiesResult.data ?? []) as ExistingCompany[]).map((company) => [
            canonicalOrgKey(company.name),
            company,
          ])
        );
        const existingCompaniesById = new Map<string, ExistingCompany>(
          ((companiesResult.data ?? []) as ExistingCompany[]).map((company) => [
            company.id,
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
        const resolutionByLabel = buildResolutionLookup(entityResolutions);
        const toolOrProductOrgNames = new Set(
          entityResolutions
            .filter((resolution) => resolution.is_tool_or_product)
            .map((resolution) => canonicalOrgKey(resolution.org_name ?? ""))
            .filter(Boolean)
        );
        let companiesResolved = 0;
        let peopleResolved = 0;
        let competitorsResolved = 0;
        let linksCreated = 0;

        for (const resolution of entityResolutions) {
          if (resolution.is_tool_or_product || !resolution.company_id) continue;
          const company = existingCompaniesById.get(resolution.company_id);
          if (company) {
            companyByName.set(canonicalOrgKey(resolution.org_name ?? company.name), company.id);
          }
        }

        const companyInputs = [
          ...entityResolutions
            .filter(
              (resolution) =>
                !resolution.is_tool_or_product && Boolean(resolution.org_name?.trim())
            )
            .map((resolution) => ({
              name: resolution.org_name as string,
              domain: null,
            })),
          ...extraction.extraction.companies.map((company) => ({
            name: company.name,
            domain: company.domain ?? null,
          })),
          ...extraction.extraction.people
            .filter((person) => person.company)
            .map((person) => ({ name: person.company as string, domain: null })),
        ];

        for (const company of companyInputs) {
          const key = canonicalOrgKey(company.name);
          if (!key || isRejectedCompanyName(company.name) || toolOrProductOrgNames.has(key)) continue;
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
          const key = canonicalOrgKey(company.name);
          if (toolOrProductOrgNames.has(key) || isRejectedCompanyName(company.name)) continue;
          const companyId = companyByName.get(key);
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

        const peopleInputs = [
          ...entityResolutions
            .filter((resolution) => resolution.resolved_name || resolution.person_id)
            .map((resolution) => ({
              name: resolution.resolved_name ?? resolution.raw_label,
              role: null as string | null,
              company: resolution.is_tool_or_product
                ? null
                : resolution.org_name ?? null,
              evidence_ids: evidenceIdsForResolution(evidence, resolution),
              resolution,
            })),
          ...extraction.extraction.people.map((person) => ({
            ...person,
            resolution:
              resolutionByLabel.get(normalizeName(person.name)) ??
              (person.company
                ? entityResolutions.find(
                    (resolution) =>
                      !resolution.is_tool_or_product &&
                      normalizeName(resolution.org_name ?? "") ===
                        normalizeName(person.company ?? "")
                  ) ?? null
                : null),
          })),
        ];

        for (const person of peopleInputs) {
          const resolution = person.resolution;
          const resolvedName = resolution?.resolved_name ?? person.name;
          const companyName = resolution?.is_tool_or_product
            ? null
            : resolution?.org_name ?? person.company ?? null;
          const companyId = resolution?.company_id
            ? resolution.company_id
            : companyName
              ? companyByName.get(canonicalOrgKey(companyName)) ?? null
              : null;
          const existingById = resolution?.person_id
            ? existingPeopleById.get(resolution.person_id)
            : null;
          const personId = existingById
            ? existingById.id
            : await findOrCreatePerson({
                org_id,
                name: resolvedName,
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
              label: resolvedName,
              person_id: personId,
            });
            linksCreated += 1;
          }
        }

        // Resolve competitors
        for (const competitor of extraction.extraction.competitors) {
          if (isRejectedCompetitorName(competitor.name)) continue;
          const canonicalName = canonicalOrgKey(competitor.name);
          const slug = (canonicalName || competitor.slug)
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
            // Persist partial-drop counts so an apparently-successful extraction
            // that silently dropped malformed entities is auditable (Codex P3
            // review of 88f77ad).
            output: {
              ...output,
              entities_dropped: extraction.dropped,
              entities_filtered: extraction.filtered,
              competitor_context_present: hasCompetitorContext,
            },
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
