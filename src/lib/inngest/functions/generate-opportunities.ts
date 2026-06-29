// Opportunity generation — turns evidence-backed problems into product opportunities.
// Triggered manually by project/opportunities.requested. Real writes stay gated by
// a zero-write dry run + review before the first writing run.

import { z } from "zod";
import { NonRetriableError } from "inngest";
import { inngest } from "../client";
import { createServiceClient } from "@/lib/supabase/server";
import { callLLM, embedBatch } from "@/lib/llm/client";
import {
  buildOpportunityGenerationPrompt,
  OPPORTUNITY_GENERATION_PROMPT_VERSION,
} from "@/lib/llm/prompts/opportunities";
import { neutralizeUntrustedSourceContentFence } from "@/lib/llm/prompts/untrusted-content";
import {
  adjacentProjectHintedEvidenceIds,
  filterAdjacentProjectHintedEvidence,
} from "@/lib/evidence/adjacent-project";
import {
  filterInternalEvidence,
  loadInternalEvidenceGuardContext,
} from "@/lib/evidence/internal";

const OPPORTUNITY_DEDUPE_SIMILARITY_THRESHOLD = 0.88;
const OPPORTUNITY_PROBLEMS_PER_BATCH = 2;
const OPPORTUNITY_LLM_BATCH_TIMEOUT_MS = 50_000;
const OPPORTUNITY_BATCH_MAX_TOKENS = 3_500;
const MAX_EVIDENCE_PER_PROBLEM = 4;
const MAX_EVIDENCE_FOR_PROMPT = 90;

type ProblemRow = {
  id: string;
  title: string;
  statement: string | null;
  description: string | null;
  severity: string | null;
  status: string;
  who_affected: string | null;
  what_is_hard: string | null;
  why_it_matters: string | null;
  current_workarounds: string[] | null;
  current_tools: string[] | null;
  confidence: string | null;
  review_state: string | null;
  source_theme_ids: string[] | null;
  source_evidence_ids: string[] | null;
  created_at: string;
};

type ProblemThemeRow = {
  problem_id: string;
  theme_id: string;
  relationship: string | null;
  rationale: string | null;
};

type ProblemEvidenceRow = {
  problem_id: string;
  evidence_id: string;
  relationship: string | null;
  rationale: string | null;
};

type ThemeRow = {
  id: string;
  label: string;
  description: string | null;
  central_concept: string | null;
  interpretation: string | null;
  evidence_count: number;
};

type EvidenceRow = {
  id: string;
  source_id: string | null;
  segment_id: string | null;
  content: string;
  summary: string | null;
  trust_scope: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
  source_type?: string | null;
  segment_speaker?: string | null;
};

type ExistingOpportunityRow = {
  id: string;
  title: string;
  description: string | null;
  how_might_we: string | null;
  status: "suggested" | "accepted" | "active" | "dismissed" | "archived";
  review_state: "suggested" | "accepted" | "edited" | "rejected" | "archived";
};

type DedupeMethod = "new" | "normalised_title" | "embedding";
type OpportunityCandidate = z.infer<typeof OpportunityCandidateSchema>;

type OpportunityPromptContext = {
  problems: ProblemRow[];
  problemThemes: ProblemThemeRow[];
  problemEvidence: ProblemEvidenceRow[];
  themes: ThemeRow[];
  evidence: EvidenceRow[];
};

const PROBLEM_EVIDENCE_PROMPT_RELATIONSHIP_RANK: Record<string, number> = {
  supporting: 0,
  example: 1,
  edge_case: 2,
  contradicting: 3,
};

const ProblemLinkSchema = z.object({
  problem_id: z.string().uuid(),
  rationale: z.string().trim().min(1).max(360),
});

const OpportunityEvidenceLinkSchema = z.object({
  evidence_id: z.string().uuid(),
  relationship: z.enum(["supporting"]).default("supporting"),
  rationale: z.string().trim().min(1).max(360),
});

const OpportunityThemeLinkSchema = z.object({
  theme_id: z.string().uuid(),
  relationship: z.enum(["supporting"]).default("supporting"),
  rationale: z.string().trim().min(1).max(360),
});

const OpportunityCandidateSchema = z.object({
  title: z.string().trim().min(1).max(140),
  description: z.string().trim().min(1).max(900),
  how_might_we: z.string().trim().min(1).max(360),
  confidence: z.enum(["high", "medium", "low"]).default("medium"),
  problem_links: z.array(ProblemLinkSchema).default([]),
  evidence_links: z.array(OpportunityEvidenceLinkSchema).default([]),
  theme_links: z.array(OpportunityThemeLinkSchema).default([]),
});

function extractJsonArray(content: string) {
  const trimmed = content.trim();
  const unfenced = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  const start = unfenced.indexOf("[");
  const end = unfenced.lastIndexOf("]");
  if (start === -1 || end === -1 || end < start) {
    throw new Error("Opportunity generation returned no JSON array");
  }
  return JSON.parse(unfenced.slice(start, end + 1)) as unknown;
}

function normalizeOpportunityTitle(title: string) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function truncate(value: string, max = 900) {
  const trimmed = value.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1)}…`;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function isTimeoutError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /\b(timed out|timeout|aborted|deadline)\b/i.test(message);
}

function chunkArray<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function mergeByKey<T>(items: T[], getKey: (item: T) => string) {
  const seen = new Set<string>();
  const merged: T[] = [];
  for (const item of items) {
    const key = getKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(item);
  }
  return merged;
}

function mergeCandidatesByNormalizedTitle(candidates: OpportunityCandidate[]) {
  const indexByTitle = new Map<string, number>();
  const merged: OpportunityCandidate[] = [];
  let mergedDuplicates = 0;

  for (const candidate of candidates) {
    const key = normalizeOpportunityTitle(candidate.title);
    const existingIndex = key ? indexByTitle.get(key) : undefined;

    if (existingIndex == null) {
      if (key) indexByTitle.set(key, merged.length);
      merged.push(candidate);
      continue;
    }

    const existing = merged[existingIndex];
    merged[existingIndex] = {
      ...existing,
      problem_links: mergeByKey(
        [...existing.problem_links, ...candidate.problem_links],
        (link) => link.problem_id
      ),
      evidence_links: mergeByKey(
        [...existing.evidence_links, ...candidate.evidence_links],
        (link) => `${link.evidence_id}:${link.relationship}`
      ),
      theme_links: mergeByKey(
        [...existing.theme_links, ...candidate.theme_links],
        (link) => `${link.theme_id}:${link.relationship}`
      ),
    };
    mergedDuplicates += 1;
  }

  return { candidates: merged, merged_duplicates: mergedDuplicates };
}

function opportunityText(
  opportunity: Pick<ExistingOpportunityRow, "title" | "description" | "how_might_we">
) {
  return [opportunity.title, opportunity.how_might_we, opportunity.description]
    .filter(Boolean)
    .join(". ");
}

function candidateText(candidate: Pick<OpportunityCandidate, "title" | "description" | "how_might_we">) {
  return [candidate.title, candidate.how_might_we, candidate.description].filter(Boolean).join(". ");
}

function cosineSimilarity(left: number[], right: number[]) {
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;

  for (let i = 0; i < Math.min(left.length, right.length); i++) {
    dot += left[i] * right[i];
    leftNorm += left[i] * left[i];
    rightNorm += right[i] * right[i];
  }

  if (leftNorm === 0 || rightNorm === 0) return 0;
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

function similarityBucket(score: number | null) {
  if (score == null) return "null";
  if (score < 0.7) return "<0.70";
  if (score < 0.8) return "0.70-0.79";
  if (score < 0.88) return "0.80-0.87";
  if (score < 0.92) return "0.88-0.91";
  return ">=0.92";
}

function rankProblemEvidenceForPrompt(
  a: { link: ProblemEvidenceRow | null; row: EvidenceRow },
  b: { link: ProblemEvidenceRow | null; row: EvidenceRow }
) {
  const relationshipA = PROBLEM_EVIDENCE_PROMPT_RELATIONSHIP_RANK[a.link?.relationship ?? ""] ?? 99;
  const relationshipB = PROBLEM_EVIDENCE_PROMPT_RELATIONSHIP_RANK[b.link?.relationship ?? ""] ?? 99;
  if (relationshipA !== relationshipB) return relationshipA - relationshipB;

  if (Boolean(a.row.summary) !== Boolean(b.row.summary)) {
    return a.row.summary ? -1 : 1;
  }

  const createdA = Date.parse(a.row.created_at);
  const createdB = Date.parse(b.row.created_at);
  if (!Number.isNaN(createdA) && !Number.isNaN(createdB) && createdA !== createdB) {
    return createdB - createdA;
  }

  return a.row.id.localeCompare(b.row.id);
}

function formatResearchDataForPrompt({
  problems,
  problemThemes,
  problemEvidence,
  themeById,
  evidenceById,
}: {
  problems: ProblemRow[];
  problemThemes: ProblemThemeRow[];
  problemEvidence: ProblemEvidenceRow[];
  themeById: Map<string, ThemeRow>;
  evidenceById: Map<string, EvidenceRow>;
}) {
  const usedEvidenceIds = new Set<string>();
  const blocks: string[] = [];

  for (const problem of problems.slice(0, OPPORTUNITY_PROBLEMS_PER_BATCH)) {
    const typedThemeIds = problemThemes
      .filter((link) => link.problem_id === problem.id)
      .map((link) => link.theme_id);
    const themeIds = uniqueStrings([...typedThemeIds, ...asStringArray(problem.source_theme_ids)]);

    const typedEvidenceIds = problemEvidence
      .filter((link) => link.problem_id === problem.id)
      .map((link) => link.evidence_id);
    const evidenceIds = uniqueStrings([...typedEvidenceIds, ...asStringArray(problem.source_evidence_ids)]);

    const themeLines = themeIds
      .map((themeId) => themeById.get(themeId))
      .filter((theme): theme is ThemeRow => Boolean(theme))
      .map((theme) =>
        [
          `THEME_ID: ${theme.id}`,
          `LABEL: ${theme.label}`,
          theme.central_concept ? `CENTRAL_CONCEPT: ${theme.central_concept}` : null,
          theme.interpretation ? `INTERPRETATION: ${theme.interpretation}` : null,
          theme.description ? `DESCRIPTION: ${theme.description}` : null,
        ]
          .filter(Boolean)
          .join("\n")
      );

    const rankedEvidence = evidenceIds
      .map((evidenceId) => {
        const row = evidenceById.get(evidenceId);
        if (!row || row.trust_scope === "excluded") return null;
        const link =
          problemEvidence.find(
            (candidateLink) =>
              candidateLink.problem_id === problem.id && candidateLink.evidence_id === row.id
          ) ?? null;
        return { link, row };
      })
      .filter((item): item is { link: ProblemEvidenceRow | null; row: EvidenceRow } => Boolean(item))
      .sort(rankProblemEvidenceForPrompt);

    const evidenceLines: string[] = [];
    for (const { link: typedLink, row: evidence } of rankedEvidence) {
      if (usedEvidenceIds.size >= MAX_EVIDENCE_FOR_PROMPT && !usedEvidenceIds.has(evidence.id)) {
        continue;
      }
      usedEvidenceIds.add(evidence.id);
      const content = neutralizeUntrustedSourceContentFence(evidence.content);
      evidenceLines.push(
        [
          `EVIDENCE_ID: ${evidence.id}`,
          typedLink?.relationship ? `PROBLEM_RELATIONSHIP: ${typedLink.relationship}` : null,
          typedLink?.rationale ? `PROBLEM_LINK_RATIONALE: ${truncate(typedLink.rationale, 220)}` : null,
          evidence.summary ? `SUMMARY: ${truncate(evidence.summary, 260)}` : null,
          `CONTENT:\n<untrusted_source_content>\n${truncate(content, 900)}\n</untrusted_source_content>`,
        ]
          .filter(Boolean)
          .join("\n")
      );
      if (evidenceLines.length >= MAX_EVIDENCE_PER_PROBLEM) break;
    }

    blocks.push(
      [
        `PROBLEM_ID: ${problem.id}`,
        `TITLE: ${problem.title}`,
        problem.status ? `STATUS: ${problem.status}` : null,
        problem.severity ? `SEVERITY: ${problem.severity}` : null,
        problem.confidence ? `CONFIDENCE: ${problem.confidence}` : null,
        problem.statement ? `STATEMENT: ${problem.statement}` : null,
        problem.description ? `DESCRIPTION: ${problem.description}` : null,
        problem.who_affected ? `WHO_AFFECTED: ${problem.who_affected}` : null,
        problem.what_is_hard ? `WHAT_IS_HARD: ${problem.what_is_hard}` : null,
        problem.why_it_matters ? `WHY_IT_MATTERS: ${problem.why_it_matters}` : null,
        problem.current_tools?.length ? `CURRENT_TOOLS: ${problem.current_tools.join(", ")}` : null,
        problem.current_workarounds?.length
          ? `CURRENT_WORKAROUNDS: ${problem.current_workarounds.join(", ")}`
          : null,
        themeLines.length > 0 ? `THEMES:\n${themeLines.join("\n\n")}` : "THEMES: none supplied",
        evidenceLines.length > 0 ? `EVIDENCE:\n${evidenceLines.join("\n\n")}` : "EVIDENCE: none supplied",
      ]
        .filter(Boolean)
        .join("\n")
    );
  }

  return `PROBLEMS:\n${blocks.join("\n\n---\n\n")}`;
}

function buildPromptContextForProblems(
  context: OpportunityPromptContext,
  problems: ProblemRow[]
): OpportunityPromptContext {
  const problemIds = new Set(problems.map((problem) => problem.id));
  const problemThemes = context.problemThemes.filter((link) => problemIds.has(link.problem_id));
  const problemEvidence = context.problemEvidence.filter((link) => problemIds.has(link.problem_id));

  const themeIds = new Set(
    uniqueStrings([
      ...problemThemes.map((link) => link.theme_id),
      ...problems.flatMap((problem) => asStringArray(problem.source_theme_ids)),
    ])
  );
  const evidenceIds = new Set(
    uniqueStrings([
      ...problemEvidence.map((link) => link.evidence_id),
      ...problems.flatMap((problem) => asStringArray(problem.source_evidence_ids)),
    ])
  );

  return {
    problems,
    problemThemes,
    problemEvidence,
    themes: context.themes.filter((theme) => themeIds.has(theme.id)),
    evidence: context.evidence.filter((row) => evidenceIds.has(row.id)),
  };
}

function sanitizeCandidate(
  candidate: OpportunityCandidate,
  allowedProblemIds: Set<string>,
  allowedEvidenceIds: Set<string>,
  allowedThemeIds: Set<string>
) {
  const problemSeen = new Set<string>();
  const problemLinks = candidate.problem_links
    .filter((link) => allowedProblemIds.has(link.problem_id))
    .filter((link) => {
      if (problemSeen.has(link.problem_id)) return false;
      problemSeen.add(link.problem_id);
      return true;
    });

  const evidenceSeen = new Set<string>();
  const evidenceLinks = candidate.evidence_links
    .filter((link) => allowedEvidenceIds.has(link.evidence_id))
    .filter((link) => {
      const key = `${link.evidence_id}:${link.relationship}`;
      if (evidenceSeen.has(key)) return false;
      evidenceSeen.add(key);
      return true;
    });

  const themeSeen = new Set<string>();
  const themeLinks = candidate.theme_links
    .filter((link) => allowedThemeIds.has(link.theme_id))
    .filter((link) => {
      const key = `${link.theme_id}:${link.relationship}`;
      if (themeSeen.has(key)) return false;
      themeSeen.add(key);
      return true;
    });

  return {
    ...candidate,
    problem_links: problemLinks,
    evidence_links: evidenceLinks,
    theme_links: themeLinks,
  };
}

async function buildDedupePlans({
  candidates,
  existingOpportunities,
}: {
  candidates: OpportunityCandidate[];
  existingOpportunities: ExistingOpportunityRow[];
}) {
  const existingByNormalizedTitle = new Map<string, ExistingOpportunityRow>();
  for (const row of existingOpportunities) {
    const key = normalizeOpportunityTitle(row.title);
    if (key && !existingByNormalizedTitle.has(key)) {
      existingByNormalizedTitle.set(key, row);
    }
  }

  const plans = candidates.map((candidate) => {
    const exact = existingByNormalizedTitle.get(normalizeOpportunityTitle(candidate.title));
    return {
      candidate,
      existingOpportunity: exact ?? null,
      method: exact ? ("normalised_title" as DedupeMethod) : ("new" as DedupeMethod),
      similarity: exact ? 1 : null,
    };
  });

  const needsEmbedding =
    plans.some((plan) => !plan.existingOpportunity) && existingOpportunities.length > 0;
  if (!needsEmbedding) return plans;

  const candidateIndexes = plans
    .map((plan, index) => ({ plan, index }))
    .filter(({ plan }) => !plan.existingOpportunity);

  const texts = [
    ...candidateIndexes.map(({ plan }) => candidateText(plan.candidate)),
    ...existingOpportunities.map((opportunity) => opportunityText(opportunity)),
  ];
  const embeddings = await embedBatch(texts);
  const candidateEmbeddings = embeddings.slice(0, candidateIndexes.length);
  const existingEmbeddings = embeddings.slice(candidateIndexes.length);

  candidateIndexes.forEach(({ index }, candidateOffset) => {
    let best: { opportunity: ExistingOpportunityRow; score: number } | null = null;
    for (let existingOffset = 0; existingOffset < existingOpportunities.length; existingOffset++) {
      const opportunity = existingOpportunities[existingOffset];
      const score = cosineSimilarity(
        candidateEmbeddings[candidateOffset],
        existingEmbeddings[existingOffset]
      );
      if (!best || score > best.score) best = { opportunity, score };
    }

    if (best) {
      plans[index].similarity = best.score;
      if (best.score >= OPPORTUNITY_DEDUPE_SIMILARITY_THRESHOLD) {
        plans[index].existingOpportunity = best.opportunity;
        plans[index].method = "embedding";
      }
    }
  });

  return plans;
}

function opportunityPayload(candidate: OpportunityCandidate, agentRunId: string | null) {
  return {
    title: candidate.title,
    description: candidate.description,
    how_might_we: candidate.how_might_we,
    confidence: candidate.confidence,
    status: "suggested",
    source: "ai",
    review_state: "suggested",
    agent_run_id: agentRunId,
  };
}

async function writeTypedLinks({
  supabase,
  orgId,
  projectId,
  opportunityId,
  candidate,
}: {
  supabase: ReturnType<typeof createServiceClient>;
  orgId: string;
  projectId: string;
  opportunityId: string;
  candidate: OpportunityCandidate;
}) {
  const problemRows = candidate.problem_links.map((link) => ({
    org_id: orgId,
    project_id: projectId,
    problem_id: link.problem_id,
    opportunity_id: opportunityId,
    relationship: "created_from",
    source: "ai",
    review_state: "suggested",
    rationale: link.rationale,
  }));

  const evidenceRows = candidate.evidence_links.map((link) => ({
    org_id: orgId,
    project_id: projectId,
    opportunity_id: opportunityId,
    evidence_id: link.evidence_id,
    relationship: link.relationship,
    rationale: link.rationale,
  }));

  const themeRows = candidate.theme_links.map((link) => ({
    org_id: orgId,
    project_id: projectId,
    opportunity_id: opportunityId,
    theme_id: link.theme_id,
    relationship: link.relationship,
    rationale: link.rationale,
  }));

  const [problemResult, evidenceResult, themeResult] = await Promise.all([
    problemRows.length > 0
      ? supabase.from("problem_opportunities").upsert(problemRows, {
          onConflict: "problem_id,opportunity_id,relationship",
        })
      : Promise.resolve({ error: null }),
    evidenceRows.length > 0
      ? supabase.from("opportunity_evidence").upsert(evidenceRows, {
          onConflict: "opportunity_id,evidence_id,relationship",
        })
      : Promise.resolve({ error: null }),
    themeRows.length > 0
      ? supabase.from("opportunity_themes").upsert(themeRows, {
          onConflict: "opportunity_id,theme_id,relationship",
        })
      : Promise.resolve({ error: null }),
  ]);

  if (problemResult.error) {
    throw new Error(`Failed to write problem opportunities: ${problemResult.error.message}`);
  }
  if (evidenceResult.error) {
    throw new Error(`Failed to write opportunity evidence: ${evidenceResult.error.message}`);
  }
  if (themeResult.error) {
    throw new Error(`Failed to write opportunity themes: ${themeResult.error.message}`);
  }

  return {
    problemLinks: problemRows.length,
    evidenceLinks: evidenceRows.length,
    themeLinks: themeRows.length,
  };
}

function canUpdateOpportunity(opportunity: ExistingOpportunityRow) {
  return opportunity.status === "suggested" && opportunity.review_state === "suggested";
}

function canLinkOpportunity(opportunity: ExistingOpportunityRow) {
  return !["dismissed", "archived"].includes(opportunity.status) &&
    !["rejected", "archived"].includes(opportunity.review_state);
}

export const generateOpportunities = inngest.createFunction(
  {
    id: "generate-opportunities",
    name: "Generate Opportunities",
    retries: 1,
    concurrency: { limit: 1, key: "event.data.project_id" },
  },
  { event: "project/opportunities.requested" },
  async ({ event, step }) => {
    const { org_id, project_id } = event.data;
    const dryRun = Boolean(event.data.dry_run);
    const supabase = createServiceClient();
    let agentRunId: string | null = null;

    try {
      agentRunId = await step.run("start-agent-run", async () => {
        const { data, error } = await supabase
          .from("agent_runs")
          .insert({
            org_id,
            project_id,
            agent_type: dryRun ? "opportunity-generation-dry-run" : "opportunity-generation",
            input: {
              prompt_version: OPPORTUNITY_GENERATION_PROMPT_VERSION,
              dedupe_similarity_threshold: OPPORTUNITY_DEDUPE_SIMILARITY_THRESHOLD,
              dry_run: dryRun,
              batch_size: OPPORTUNITY_PROBLEMS_PER_BATCH,
              batch_timeout_ms: OPPORTUNITY_LLM_BATCH_TIMEOUT_MS,
              batch_max_tokens: OPPORTUNITY_BATCH_MAX_TOKENS,
            },
          })
          .select("id")
          .single();

        if (error || !data) {
          throw new Error(`Failed to start opportunity generation run: ${error?.message}`);
        }
        return data.id as string;
      });

      const context = await step.run("fetch-context", async () => {
        const [problemsResult, projectResult, existingOpportunitiesResult] = await Promise.all([
          supabase
            .from("problems")
            .select(
              [
                "id",
                "title",
                "statement",
                "description",
                "severity",
                "status",
                "who_affected",
                "what_is_hard",
                "why_it_matters",
                "current_workarounds",
                "current_tools",
                "confidence",
                "review_state",
                "source_theme_ids",
                "source_evidence_ids",
                "created_at",
              ].join(", ")
            )
            .eq("org_id", org_id)
            .eq("project_id", project_id)
            .neq("status", "dismissed")
            .neq("status", "resolved")
            .neq("review_state", "rejected")
            .order("created_at", { ascending: false })
            .limit(40),
          supabase
            .from("projects")
            .select("frame")
            .eq("org_id", org_id)
            .eq("id", project_id)
            .single(),
          supabase
            .from("opportunities")
            .select("id, title, description, how_might_we, status, review_state")
            .eq("org_id", org_id)
            .eq("project_id", project_id),
        ]);

        if (problemsResult.error) {
          throw new Error(`Failed to fetch problems: ${problemsResult.error.message}`);
        }
        if (projectResult.error) {
          throw new Error(`Failed to fetch project: ${projectResult.error.message}`);
        }
        if (existingOpportunitiesResult.error) {
          throw new Error(`Failed to fetch existing opportunities: ${existingOpportunitiesResult.error.message}`);
        }

        const problems = (problemsResult.data ?? []) as ProblemRow[];
        const problemIds = problems.map((problem) => problem.id);

        let problemThemes: ProblemThemeRow[] = [];
        let problemEvidence: ProblemEvidenceRow[] = [];
        if (problemIds.length > 0) {
          const [themeLinkResult, evidenceLinkResult] = await Promise.all([
            supabase
              .from("problem_themes")
              .select("problem_id, theme_id, relationship, rationale")
              .eq("org_id", org_id)
              .eq("project_id", project_id)
              .in("problem_id", problemIds)
              .neq("review_state", "rejected"),
            supabase
              .from("problem_evidence")
              .select("problem_id, evidence_id, relationship, rationale")
              .eq("org_id", org_id)
              .eq("project_id", project_id)
              .in("problem_id", problemIds)
              .neq("review_state", "rejected"),
          ]);

          if (themeLinkResult.error) {
            throw new Error(`Failed to fetch problem themes: ${themeLinkResult.error.message}`);
          }
          if (evidenceLinkResult.error) {
            throw new Error(`Failed to fetch problem evidence: ${evidenceLinkResult.error.message}`);
          }

          problemThemes = (themeLinkResult.data ?? []) as ProblemThemeRow[];
          problemEvidence = (evidenceLinkResult.data ?? []) as ProblemEvidenceRow[];
        }

        const themeIds = uniqueStrings([
          ...problemThemes.map((link) => link.theme_id),
          ...problems.flatMap((problem) => asStringArray(problem.source_theme_ids)),
        ]);
        const evidenceIds = uniqueStrings([
          ...problemEvidence.map((link) => link.evidence_id),
          ...problems.flatMap((problem) => asStringArray(problem.source_evidence_ids)),
        ]);

        let themes: ThemeRow[] = [];
        if (themeIds.length > 0) {
          const { data, error } = await supabase
            .from("themes")
            .select("id, label, description, central_concept, interpretation, evidence_count")
            .eq("org_id", org_id)
            .eq("project_id", project_id)
            .in("id", themeIds);

          if (error) throw new Error(`Failed to fetch themes: ${error.message}`);
          themes = (data ?? []) as ThemeRow[];
        }

        let evidence: EvidenceRow[] = [];
        let adjacentEvidenceExcluded = 0;
        let internalEvidenceExcluded = 0;
        if (evidenceIds.length > 0) {
          const { data, error } = await supabase
            .from("evidence")
            .select("id, source_id, segment_id, content, summary, trust_scope, metadata, created_at")
            .eq("org_id", org_id)
            .eq("project_id", project_id)
            .in("id", evidenceIds)
            .neq("trust_scope", "excluded");

          if (error) throw new Error(`Failed to fetch evidence: ${error.message}`);
          const allEvidence = (data ?? []) as EvidenceRow[];
          const sourceIds = Array.from(
            new Set(allEvidence.map((row) => row.source_id).filter((id): id is string => Boolean(id)))
          );
          const segmentIds = Array.from(
            new Set(allEvidence.map((row) => row.segment_id).filter((id): id is string => Boolean(id)))
          );
          const [sourcesResult, segmentsResult, internalGuardContext] = await Promise.all([
            sourceIds.length > 0
              ? supabase
                  .from("sources")
                  .select("id, type")
                  .eq("org_id", org_id)
                  .eq("project_id", project_id)
                  .in("id", sourceIds)
              : Promise.resolve({ data: [], error: null }),
            segmentIds.length > 0
              ? supabase
                  .from("source_segments")
                  .select("id, speaker")
                  .eq("org_id", org_id)
                  .in("id", segmentIds)
              : Promise.resolve({ data: [], error: null }),
            loadInternalEvidenceGuardContext({ supabase, org_id }),
          ]);

          if (sourcesResult.error) {
            throw new Error(`Failed to fetch evidence sources: ${sourcesResult.error.message}`);
          }
          if (segmentsResult.error) {
            throw new Error(`Failed to fetch evidence segments: ${segmentsResult.error.message}`);
          }

          const sourceTypeById = new Map(
            ((sourcesResult.data ?? []) as Array<{ id: string; type: string | null }>).map((source) => [
              source.id,
              source.type,
            ])
          );
          const segmentSpeakerById = new Map(
            ((segmentsResult.data ?? []) as Array<{ id: string; speaker: string | null }>).map((segment) => [
              segment.id,
              segment.speaker,
            ])
          );

          for (const row of allEvidence) {
            row.source_type = row.source_id ? sourceTypeById.get(row.source_id) ?? null : null;
            row.segment_speaker = row.segment_id ? segmentSpeakerById.get(row.segment_id) ?? null : null;
          }

          const adjacentEvidenceIds = adjacentProjectHintedEvidenceIds(allEvidence);
          adjacentEvidenceExcluded = adjacentEvidenceIds.size;
          const adjacentFilteredEvidence = filterAdjacentProjectHintedEvidence(allEvidence);
          evidence = filterInternalEvidence(adjacentFilteredEvidence, internalGuardContext);
          internalEvidenceExcluded = adjacentFilteredEvidence.length - evidence.length;
          const visibleEvidenceIds = new Set(evidence.map((row) => row.id));
          problemEvidence = problemEvidence.filter((link) => visibleEvidenceIds.has(link.evidence_id));
        }

        return {
          problems,
          problemThemes,
          problemEvidence,
          themes,
          evidence,
          existingOpportunities: (existingOpportunitiesResult.data ?? []) as ExistingOpportunityRow[],
          frame: (projectResult.data?.frame as string | null) ?? "",
          adjacentEvidenceExcluded,
          internalEvidenceExcluded,
        };
      });

      if (
        context.problems.length === 0 ||
        context.themes.length === 0 ||
        context.evidence.length === 0
      ) {
        await step.run("complete-empty", async () => {
          await supabase
            .from("agent_runs")
            .update({
              status: "completed",
              output: {
                dry_run: dryRun,
                batch_size: OPPORTUNITY_PROBLEMS_PER_BATCH,
                batch_timeout_ms: OPPORTUNITY_LLM_BATCH_TIMEOUT_MS,
                batch_max_tokens: OPPORTUNITY_BATCH_MAX_TOKENS,
                problems: context.problems.length,
                problem_evidence_links: context.problemEvidence.length,
                evidence_supplied: context.evidence.length,
                adjacent_evidence_excluded: context.adjacentEvidenceExcluded,
                internal_evidence_excluded: context.internalEvidenceExcluded,
                opportunities_written: 0,
              },
              completed_at: new Date().toISOString(),
            })
            .eq("org_id", org_id)
            .eq("id", agentRunId!);
        });
        return { dry_run: dryRun, opportunities_written: 0 };
      }

      const problemBatches = chunkArray(context.problems, OPPORTUNITY_PROBLEMS_PER_BATCH);
      const batchReports: Array<{
        batch: number;
        problems: number;
        problem_ids: string[];
        themes_supplied: number;
        evidence_supplied: number;
        candidates: number;
        dropped_candidates: number;
        model_used: string | null;
        duration_ms?: number;
        estimated_usd?: number;
        input_tokens?: number;
        output_tokens?: number;
        cache_write_tokens?: number;
        cache_read_tokens?: number;
        skipped_reason?: string;
      }> = [];
      const allCandidates: OpportunityCandidate[] = [];

      for (let batchIndex = 0; batchIndex < problemBatches.length; batchIndex += 1) {
        const batchProblems = problemBatches[batchIndex];
        const batchNumber = batchIndex + 1;
        const batchContext = buildPromptContextForProblems(context, batchProblems);

        if (batchContext.themes.length === 0 || batchContext.evidence.length === 0) {
          batchReports.push({
            batch: batchNumber,
            problems: batchContext.problems.length,
            problem_ids: batchContext.problems.map((problem) => problem.id),
            themes_supplied: batchContext.themes.length,
            evidence_supplied: batchContext.evidence.length,
            candidates: 0,
            dropped_candidates: 0,
            model_used: null,
            skipped_reason:
              batchContext.themes.length === 0 ? "no_supported_themes" : "no_supported_evidence",
          });
          continue;
        }

        const batchResult = await step.run(`call-llm-batch-${batchNumber}`, async () => {
          const themeById = new Map(batchContext.themes.map((theme) => [theme.id, theme]));
          const evidenceById = new Map(batchContext.evidence.map((row) => [row.id, row]));
          const researchData = formatResearchDataForPrompt({
            problems: batchContext.problems,
            problemThemes: batchContext.problemThemes,
            problemEvidence: batchContext.problemEvidence,
            themeById,
            evidenceById,
          });

          let result: Awaited<ReturnType<typeof callLLM>>;
          const batchStartedAt = Date.now();
          try {
            result = await callLLM({
              tier: "premium",
              temperature: 0.25,
              maxTokens: OPPORTUNITY_BATCH_MAX_TOKENS,
              system:
                "You generate evidence-backed product opportunities from research problems. Return strict JSON only.",
              messages: [
                {
                  role: "user",
                  content: `${buildOpportunityGenerationPrompt({
                    frame: context.frame || "No project frame set.",
                    researchData,
                  })}

BATCH EXECUTION:
- This is batch ${batchNumber} of ${problemBatches.length}.
- Generate 1-2 high-quality opportunities for this batch only.
- Do not return more than 2 opportunities in this batch.
- Other batches cover other problems; do not compensate for missing project-wide context.
- Return strict JSON only.`,
                },
              ],
              timeoutMs: OPPORTUNITY_LLM_BATCH_TIMEOUT_MS,
              telemetry: {
                orgId: org_id,
                projectId: project_id,
                agentRunId,
                agentType: dryRun ? "opportunity-generation-dry-run" : "opportunity-generation",
                step: `call-llm-batch-${batchNumber}`,
              },
            });
          } catch (error) {
            if (isTimeoutError(error)) {
              throw new NonRetriableError(
                `Opportunity generation LLM batch ${batchNumber} timed out; not retrying to avoid duplicate premium spend.`,
                { cause: error }
              );
            }
            throw error;
          }
          const durationMs = Date.now() - batchStartedAt;

          const rawArray = extractJsonArray(result.content);
          if (!Array.isArray(rawArray)) {
            throw new Error(`Opportunity generation batch ${batchNumber} did not return a JSON array`);
          }

          let droppedCount = 0;
          const validCandidates: OpportunityCandidate[] = [];
          rawArray.forEach((element, index) => {
            const parsedCandidate = OpportunityCandidateSchema.safeParse(element);
            if (parsedCandidate.success) {
              validCandidates.push(parsedCandidate.data);
              return;
            }
            droppedCount += 1;
            const failingPaths = parsedCandidate.error.issues
              .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
              .join("; ");
            console.warn(
              `[generate-opportunities] dropped invalid opportunity candidate in batch ${batchNumber} at index ${index}: ${failingPaths}`
            );
          });

          const allowedProblemIds = new Set(batchContext.problems.map((problem) => problem.id));
          const allowedEvidenceIds = new Set(batchContext.evidence.map((row) => row.id));
          const allowedThemeIds = new Set(batchContext.themes.map((theme) => theme.id));
          const sanitized = validCandidates
            .map((candidate) =>
              sanitizeCandidate(candidate, allowedProblemIds, allowedEvidenceIds, allowedThemeIds)
            )
            .filter(
              (candidate) =>
                candidate.problem_links.length > 0 &&
                candidate.evidence_links.length > 0 &&
                candidate.theme_links.length > 0
            );

          return {
            candidates: sanitized,
            model_used: result.model,
            dropped_candidates: droppedCount,
            duration_ms: durationMs,
            estimated_usd: result.estimatedCostUsd ?? 0,
            input_tokens: result.inputTokens,
            output_tokens: result.outputTokens,
            cache_write_tokens: result.cacheCreationInputTokens ?? 0,
            cache_read_tokens: result.cacheReadInputTokens ?? 0,
          };
        });

        allCandidates.push(...batchResult.candidates);
        batchReports.push({
          batch: batchNumber,
          problems: batchContext.problems.length,
          problem_ids: batchContext.problems.map((problem) => problem.id),
          themes_supplied: batchContext.themes.length,
          evidence_supplied: batchContext.evidence.length,
          candidates: batchResult.candidates.length,
          dropped_candidates: batchResult.dropped_candidates,
          model_used: batchResult.model_used,
          duration_ms: batchResult.duration_ms,
          estimated_usd: batchResult.estimated_usd,
          input_tokens: batchResult.input_tokens,
          output_tokens: batchResult.output_tokens,
          cache_write_tokens: batchResult.cache_write_tokens,
          cache_read_tokens: batchResult.cache_read_tokens,
        });
      }

      const mergedCandidates = mergeCandidatesByNormalizedTitle(allCandidates);
      const candidates = mergedCandidates.candidates;
      const model_used = uniqueStrings(
        batchReports.map((report) => report.model_used).filter((model): model is string => Boolean(model))
      ).join(", ");
      const dropped_candidates = batchReports.reduce(
        (total, report) => total + report.dropped_candidates,
        0
      );
      const measuredBatchReports = batchReports.filter(
        (report) => typeof report.duration_ms === "number"
      );
      const batch_total_duration_ms = measuredBatchReports.reduce(
        (total, report) => total + (report.duration_ms ?? 0),
        0
      );
      const slowest_batch_duration_ms = measuredBatchReports.reduce(
        (max, report) => Math.max(max, report.duration_ms ?? 0),
        0
      );
      const batch_total_estimated_usd = Number(
        measuredBatchReports
          .reduce((total, report) => total + (report.estimated_usd ?? 0), 0)
          .toFixed(6)
      );

      const plans = await step.run("dedupe-candidates", async () =>
        buildDedupePlans({
          candidates,
          existingOpportunities: context.existingOpportunities,
        })
      );

      const report = await step.run("write-opportunities", async () => {
        let inserted = 0;
        let updated = 0;
        let locked = 0;
        let lockedLinked = 0;
        let skipped = 0;
        let problemLinks = 0;
        let evidenceLinks = 0;
        let themeLinks = 0;
        let plannedInserted = 0;
        let plannedUpdated = 0;
        let plannedLocked = 0;
        let plannedLockedLinked = 0;
        let plannedLinkRows = 0;
        const dedupeMethods: Record<DedupeMethod, number> = {
          new: 0,
          normalised_title: 0,
          embedding: 0,
        };
        const similarityHistogram: Record<string, number> = {
          "<0.70": 0,
          "0.70-0.79": 0,
          "0.80-0.87": 0,
          "0.88-0.91": 0,
          ">=0.92": 0,
          null: 0,
        };

        for (const plan of plans) {
          dedupeMethods[plan.method] += 1;
          similarityHistogram[similarityBucket(plan.similarity)] += 1;

          const candidateLinkRows =
            plan.candidate.problem_links.length +
            plan.candidate.evidence_links.length +
            plan.candidate.theme_links.length;

          if (
            plan.candidate.problem_links.length === 0 ||
            plan.candidate.evidence_links.length === 0 ||
            plan.candidate.theme_links.length === 0
          ) {
            skipped++;
            continue;
          }

          if (plan.existingOpportunity) {
            if (canUpdateOpportunity(plan.existingOpportunity)) {
              plannedUpdated++;
            } else if (canLinkOpportunity(plan.existingOpportunity)) {
              plannedLocked++;
              plannedLockedLinked++;
            } else {
              skipped++;
              continue;
            }
          } else {
            plannedInserted++;
          }
          plannedLinkRows += candidateLinkRows;

          if (dryRun) continue;

          let opportunityId = plan.existingOpportunity?.id ?? null;
          if (plan.existingOpportunity) {
            if (canUpdateOpportunity(plan.existingOpportunity)) {
              const { error } = await supabase
                .from("opportunities")
                .update(opportunityPayload(plan.candidate, agentRunId))
                .eq("org_id", org_id)
                .eq("project_id", project_id)
                .eq("id", plan.existingOpportunity.id)
                .eq("status", "suggested")
                .eq("review_state", "suggested");

              if (error) {
                throw new Error(`Failed to update opportunity "${plan.candidate.title}": ${error.message}`);
              }
              updated++;
            } else {
              locked++;
            }
          } else {
            const { data, error } = await supabase
              .from("opportunities")
              .insert({
                org_id,
                project_id,
                ...opportunityPayload(plan.candidate, agentRunId),
              })
              .select("id")
              .single();

            if (error || !data) {
              throw new Error(`Failed to write opportunity "${plan.candidate.title}": ${error?.message}`);
            }
            opportunityId = data.id as string;
            inserted++;
          }

          if (!opportunityId) continue;
          const linkCounts = await writeTypedLinks({
            supabase,
            orgId: org_id,
            projectId: project_id,
            opportunityId,
            candidate: plan.candidate,
          });
          problemLinks += linkCounts.problemLinks;
          evidenceLinks += linkCounts.evidenceLinks;
          themeLinks += linkCounts.themeLinks;
          if (plan.existingOpportunity && !canUpdateOpportunity(plan.existingOpportunity)) {
            lockedLinked++;
          }
        }

        return {
          dry_run: dryRun,
          threshold: OPPORTUNITY_DEDUPE_SIMILARITY_THRESHOLD,
          candidates: candidates.length,
          inserted,
          updated,
          locked,
          locked_linked: lockedLinked,
          skipped,
          problem_links: problemLinks,
          evidence_links: evidenceLinks,
          theme_links: themeLinks,
          dedupe_methods: dedupeMethods,
          similarity_histogram: similarityHistogram,
          planned_inserted: plannedInserted,
          planned_updated: plannedUpdated,
          planned_locked: plannedLocked,
          planned_locked_linked: plannedLockedLinked,
          planned_link_rows: plannedLinkRows,
          planned_writes: dryRun ? plannedInserted + plannedUpdated + plannedLockedLinked : 0,
          problem_batches: problemBatches.length,
          batch_size: OPPORTUNITY_PROBLEMS_PER_BATCH,
          batch_timeout_ms: OPPORTUNITY_LLM_BATCH_TIMEOUT_MS,
          batch_max_tokens: OPPORTUNITY_BATCH_MAX_TOKENS,
          measured_batches: measuredBatchReports.length,
          batch_total_duration_ms,
          slowest_batch_duration_ms,
          batch_total_estimated_usd,
          batch_reports: batchReports,
          merged_duplicate_candidates: mergedCandidates.merged_duplicates,
          adjacent_evidence_excluded: context.adjacentEvidenceExcluded,
          internal_evidence_excluded: context.internalEvidenceExcluded,
        };
      });

      await step.run("complete-agent-run", async () => {
        await supabase
          .from("agent_runs")
          .update({
            status: "completed",
            output: {
              problems: context.problems.length,
              problem_theme_links: context.problemThemes.length,
              problem_evidence_links: context.problemEvidence.length,
              themes_supplied: context.themes.length,
              evidence_supplied: context.evidence.length,
              dropped_candidates,
              ...report,
            },
            model_used: model_used || null,
            completed_at: new Date().toISOString(),
          })
          .eq("org_id", org_id)
          .eq("id", agentRunId!);
      });

      return {
        dry_run: dryRun,
        opportunities_written: report.inserted + report.updated,
        candidates: report.candidates,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown opportunity generation error";
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
