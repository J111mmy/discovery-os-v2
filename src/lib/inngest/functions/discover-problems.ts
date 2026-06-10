// Problem discovery — surfaces structured problem statements from synthesised themes.
// Triggered by project/problems.requested (emitted by synthesise-project after themes are written).

import { z } from "zod";
import { inngest } from "../client";
import { createServiceClient } from "@/lib/supabase/server";
import { callLLM, embedBatch } from "@/lib/llm/client";
import {
  buildProblemDiscoveryPrompt,
  PROBLEM_DISCOVERY_PROMPT_VERSION,
} from "@/lib/llm/prompts/problems";

const PROBLEM_DEDUPE_SIMILARITY_THRESHOLD = 0.86;
const MAX_THEMES_FOR_PROMPT = 24;
const MAX_EVIDENCE_PER_THEME = 8;
const MAX_EVIDENCE_FOR_PROMPT = 120;

type ThemeRow = {
  id: string;
  label: string;
  description: string | null;
  evidence_count: number;
  central_concept?: string | null;
  interpretation?: string | null;
  review_state?: string | null;
};

type ThemeEvidenceRow = {
  theme_id: string;
  evidence_id: string;
  relationship: string | null;
};

type EvidenceRow = {
  id: string;
  content: string;
  summary: string | null;
  trust_scope: string;
  themes: string[] | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

type TopicRow = {
  id: string;
  label: string;
};

type EvidenceTopicRow = {
  evidence_id: string;
  topic_id: string;
};

type ExistingProblemRow = {
  id: string;
  title: string;
  description: string | null;
  statement: string | null;
  status: "surfaced" | "acknowledged" | "active" | "resolved" | "dismissed";
};

type DedupeMethod = "new" | "normalised_title" | "embedding";

type ProblemCandidate = z.infer<typeof ProblemCandidateSchema>;

const ThemeLinkSchema = z.object({
  theme_id: z.string().uuid(),
  relationship: z.enum(["primary", "contributing"]).default("contributing"),
  rationale: z.string().trim().max(280).optional().nullable(),
});

const EvidenceLinkSchema = z.object({
  evidence_id: z.string().uuid(),
  relationship: z.enum(["supporting", "contradicting", "example", "edge_case"]),
  rationale: z.string().trim().min(1).max(360),
});

const ProblemCandidateSchema = z.object({
  title: z.string().trim().min(1).max(140),
  statement: z.string().trim().min(1).max(360),
  description: z.string().trim().min(1).max(900),
  who_affected: z.string().trim().max(220).nullable().default(null),
  what_is_hard: z.string().trim().max(320).nullable().default(null),
  why_it_matters: z.string().trim().max(320).nullable().default(null),
  current_workarounds: z.array(z.string().trim().max(160)).default([]),
  current_tools: z.array(z.string().trim().max(120)).default([]),
  severity: z.enum(["high", "medium", "low"]).default("medium"),
  confidence: z.enum(["high", "medium", "low"]).default("medium"),
  theme_links: z.array(ThemeLinkSchema).default([]),
  evidence_links: z.array(EvidenceLinkSchema).default([]),
  topic_provenance_ids: z.array(z.string().uuid()).default([]),
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
    throw new Error("Problem discovery returned no JSON array");
  }
  return JSON.parse(unfenced.slice(start, end + 1)) as unknown;
}

function normalizeProblemTitle(title: string) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function truncate(value: string, max = 900) {
  const trimmed = value.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1)}…`;
}

function problemText(problem: Pick<ExistingProblemRow, "title" | "description" | "statement">) {
  return [problem.title, problem.statement, problem.description].filter(Boolean).join(". ");
}

function candidateText(candidate: Pick<ProblemCandidate, "title" | "statement" | "description">) {
  return [candidate.title, candidate.statement, candidate.description].filter(Boolean).join(". ");
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
  if (score < 0.86) return "0.80-0.85";
  if (score < 0.9) return "0.86-0.89";
  return ">=0.90";
}

function topicLabelsForEvidence(
  evidenceId: string,
  evidenceTopics: EvidenceTopicRow[],
  topicById: Map<string, TopicRow>
) {
  return evidenceTopics
    .filter((link) => link.evidence_id === evidenceId)
    .map((link) => topicById.get(link.topic_id)?.label)
    .filter((label): label is string => Boolean(label));
}

function topicIdsForEvidence(evidenceId: string, evidenceTopics: EvidenceTopicRow[]) {
  return evidenceTopics
    .filter((link) => link.evidence_id === evidenceId)
    .map((link) => link.topic_id);
}

function formatResearchDataForPrompt({
  themes,
  themeEvidence,
  evidenceById,
  evidenceTopics,
  topicById,
}: {
  themes: ThemeRow[];
  themeEvidence: ThemeEvidenceRow[];
  evidenceById: Map<string, EvidenceRow>;
  evidenceTopics: EvidenceTopicRow[];
  topicById: Map<string, TopicRow>;
}) {
  const usedEvidenceIds = new Set<string>();
  const themeBlocks: string[] = [];
  const promptThemes = themes.slice(0, MAX_THEMES_FOR_PROMPT);

  for (const theme of promptThemes) {
    const linkedEvidence = themeEvidence
      .filter((link) => link.theme_id === theme.id)
      .map((link) => evidenceById.get(link.evidence_id))
      .filter((row): row is EvidenceRow => Boolean(row))
      .filter((row) => row.trust_scope !== "excluded")
      .slice(0, MAX_EVIDENCE_PER_THEME);

    const evidenceLines: string[] = [];
    for (const evidence of linkedEvidence) {
      if (usedEvidenceIds.size >= MAX_EVIDENCE_FOR_PROMPT && !usedEvidenceIds.has(evidence.id)) {
        continue;
      }
      usedEvidenceIds.add(evidence.id);
      const topicLabels = topicLabelsForEvidence(evidence.id, evidenceTopics, topicById);
      const topicIds = topicIdsForEvidence(evidence.id, evidenceTopics);
      evidenceLines.push(
        [
          `EVIDENCE_ID: ${evidence.id}`,
          `TRUST: ${evidence.trust_scope}`,
          topicIds.length > 0 ? `TOPIC_IDS: ${topicIds.join(", ")}` : null,
          topicLabels.length > 0 ? `TOPICS: ${topicLabels.join(", ")}` : null,
          evidence.summary ? `SUMMARY: ${truncate(evidence.summary, 240)}` : null,
          `CONTENT: ${truncate(evidence.content, 900)}`,
        ]
          .filter(Boolean)
          .join("\n")
      );
    }

    themeBlocks.push(
      [
        `THEME_ID: ${theme.id}`,
        `LABEL: ${theme.label}`,
        theme.central_concept ? `CENTRAL_CONCEPT: ${theme.central_concept}` : null,
        theme.interpretation ? `INTERPRETATION: ${theme.interpretation}` : null,
        theme.description ? `DESCRIPTION: ${theme.description}` : null,
        `EVIDENCE_COUNT: ${theme.evidence_count}`,
        evidenceLines.length > 0 ? `EVIDENCE:\n${evidenceLines.join("\n\n")}` : "EVIDENCE: none supplied",
      ]
        .filter(Boolean)
        .join("\n")
    );
  }

  const topicsUsed = Array.from(
    new Set(
      Array.from(usedEvidenceIds).flatMap((evidenceId) => topicIdsForEvidence(evidenceId, evidenceTopics))
    )
  )
    .map((topicId) => topicById.get(topicId))
    .filter((topic): topic is TopicRow => Boolean(topic));

  const topicBlock =
    topicsUsed.length > 0
      ? topicsUsed.map((topic) => `TOPIC_ID: ${topic.id}\nLABEL: ${topic.label}`).join("\n\n")
      : "No first-class topics available yet.";

  return [`TOPICS:\n${topicBlock}`, `THEMES:\n${themeBlocks.join("\n\n---\n\n")}`].join(
    "\n\n======\n\n"
  );
}

function sanitizeCandidate(
  candidate: ProblemCandidate,
  allowedThemeIds: Set<string>,
  allowedEvidenceIds: Set<string>,
  allowedTopicIds: Set<string>
) {
  const themeSeen = new Set<string>();
  const themeLinks = candidate.theme_links
    .filter((link) => allowedThemeIds.has(link.theme_id))
    .filter((link) => {
      const key = `${link.theme_id}:${link.relationship}`;
      if (themeSeen.has(key)) return false;
      themeSeen.add(key);
      return true;
    });

  if (!themeLinks.some((link) => link.relationship === "primary") && themeLinks.length > 0) {
    themeLinks[0] = { ...themeLinks[0], relationship: "primary" };
  }

  const evidenceSeen = new Set<string>();
  const evidenceLinks = candidate.evidence_links
    .filter((link) => allowedEvidenceIds.has(link.evidence_id))
    .filter((link) => {
      const key = `${link.evidence_id}:${link.relationship}`;
      if (evidenceSeen.has(key)) return false;
      evidenceSeen.add(key);
      return true;
    });

  const topicProvenanceIds = uniqueStrings(
    candidate.topic_provenance_ids.filter((id) => allowedTopicIds.has(id))
  );

  return {
    ...candidate,
    current_workarounds: uniqueStrings(candidate.current_workarounds).slice(0, 8),
    current_tools: uniqueStrings(candidate.current_tools).slice(0, 8),
    theme_links: themeLinks,
    evidence_links: evidenceLinks,
    topic_provenance_ids: topicProvenanceIds,
  };
}

async function buildDedupePlans({
  candidates,
  existingProblems,
}: {
  candidates: ProblemCandidate[];
  existingProblems: ExistingProblemRow[];
}) {
  const existingByNormalizedTitle = new Map<string, ExistingProblemRow>();
  for (const row of existingProblems) {
    const key = normalizeProblemTitle(row.title);
    if (key && !existingByNormalizedTitle.has(key)) {
      existingByNormalizedTitle.set(key, row);
    }
  }

  const plans = candidates.map((candidate) => {
    const exact = existingByNormalizedTitle.get(normalizeProblemTitle(candidate.title));
    return {
      candidate,
      existingProblem: exact ?? null,
      method: exact ? ("normalised_title" as DedupeMethod) : ("new" as DedupeMethod),
      similarity: exact ? 1 : null,
    };
  });

  const needsEmbedding = plans.some((plan) => !plan.existingProblem) && existingProblems.length > 0;
  if (!needsEmbedding) return plans;

  const candidateIndexes = plans
    .map((plan, index) => ({ plan, index }))
    .filter(({ plan }) => !plan.existingProblem);

  const texts = [
    ...candidateIndexes.map(({ plan }) => candidateText(plan.candidate)),
    ...existingProblems.map((problem) => problemText(problem)),
  ];
  const embeddings = await embedBatch(texts);
  const candidateEmbeddings = embeddings.slice(0, candidateIndexes.length);
  const existingEmbeddings = embeddings.slice(candidateIndexes.length);

  candidateIndexes.forEach(({ index }, candidateOffset) => {
    let best: { problem: ExistingProblemRow; score: number } | null = null;
    for (let existingOffset = 0; existingOffset < existingProblems.length; existingOffset++) {
      const problem = existingProblems[existingOffset];
      const score = cosineSimilarity(candidateEmbeddings[candidateOffset], existingEmbeddings[existingOffset]);
      if (!best || score > best.score) best = { problem, score };
    }

    if (best) {
      plans[index].similarity = best.score;
      if (best.score >= PROBLEM_DEDUPE_SIMILARITY_THRESHOLD) {
        plans[index].existingProblem = best.problem;
        plans[index].method = "embedding";
      }
    }
  });

  return plans;
}

function problemPayload(candidate: ProblemCandidate, agentRunId: string | null) {
  const themeIds = candidate.theme_links.map((link) => link.theme_id);
  const evidenceIds = candidate.evidence_links.map((link) => link.evidence_id);

  return {
    title: candidate.title,
    description: candidate.description,
    severity: candidate.severity,
    statement: candidate.statement,
    who_affected: candidate.who_affected,
    what_is_hard: candidate.what_is_hard,
    why_it_matters: candidate.why_it_matters,
    current_workarounds: candidate.current_workarounds,
    current_tools: candidate.current_tools,
    confidence: candidate.confidence,
    source: "ai",
    review_state: "suggested",
    agent_run_id: agentRunId,
    source_theme_ids: themeIds,
    source_evidence_ids: evidenceIds,
  };
}

async function writeTypedLinks({
  supabase,
  orgId,
  projectId,
  agentRunId,
  problemId,
  candidate,
}: {
  supabase: ReturnType<typeof createServiceClient>;
  orgId: string;
  projectId: string;
  agentRunId: string | null;
  problemId: string;
  candidate: ProblemCandidate;
}) {
  const themeRows = candidate.theme_links.map((link) => ({
    org_id: orgId,
    project_id: projectId,
    problem_id: problemId,
    theme_id: link.theme_id,
    relationship: link.relationship,
    source: "ai",
    review_state: "suggested",
    rationale: link.rationale ?? null,
    agent_run_id: agentRunId,
  }));

  const evidenceRows = candidate.evidence_links.map((link) => ({
    org_id: orgId,
    project_id: projectId,
    problem_id: problemId,
    evidence_id: link.evidence_id,
    relationship: link.relationship,
    source: "ai",
    review_state: "suggested",
    rationale: link.rationale,
    agent_run_id: agentRunId,
  }));

  const topicRows = candidate.topic_provenance_ids.map((topicId) => ({
    org_id: orgId,
    project_id: projectId,
    problem_id: problemId,
    topic_id: topicId,
    relationship: "provenance",
    source: "ai",
    review_state: "suggested",
    rationale: "AI-selected topic provenance for this problem.",
    agent_run_id: agentRunId,
  }));

  const [themeResult, evidenceResult, topicResult] = await Promise.all([
    themeRows.length > 0
      ? supabase.from("problem_themes").upsert(themeRows, {
          onConflict: "problem_id,theme_id,relationship",
        })
      : Promise.resolve({ error: null }),
    evidenceRows.length > 0
      ? supabase.from("problem_evidence").upsert(evidenceRows, {
          onConflict: "problem_id,evidence_id,relationship",
        })
      : Promise.resolve({ error: null }),
    topicRows.length > 0
      ? supabase.from("problem_topics").upsert(topicRows, {
          onConflict: "problem_id,topic_id,relationship",
        })
      : Promise.resolve({ error: null }),
  ]);

  if (themeResult.error) throw new Error(`Failed to write problem themes: ${themeResult.error.message}`);
  if (evidenceResult.error) {
    throw new Error(`Failed to write problem evidence: ${evidenceResult.error.message}`);
  }
  if (topicResult.error) throw new Error(`Failed to write problem topics: ${topicResult.error.message}`);

  return {
    themeLinks: themeRows.length,
    evidenceLinks: evidenceRows.length,
    topicLinks: topicRows.length,
  };
}

export const discoverProblems = inngest.createFunction(
  { id: "discover-problems", name: "Discover Problems", retries: 2 },
  { event: "project/problems.requested" },
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
            agent_type: dryRun ? "problem-discovery-dry-run" : "problem-discovery",
            input: {
              prompt_version: PROBLEM_DISCOVERY_PROMPT_VERSION,
              dedupe_similarity_threshold: PROBLEM_DEDUPE_SIMILARITY_THRESHOLD,
              dry_run: dryRun,
            },
          })
          .select("id")
          .single();
        if (error || !data) {
          throw new Error(`Failed to start problem discovery run: ${error?.message}`);
        }
        return data.id as string;
      });

      const context = await step.run("fetch-context", async () => {
        const [themesResult, projectResult, existingProblemsResult] = await Promise.all([
          supabase
            .from("themes")
            .select("id, label, description, evidence_count, central_concept, interpretation, review_state")
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
          supabase
            .from("problems")
            .select("id, title, description, statement, status")
            .eq("org_id", org_id)
            .eq("project_id", project_id),
        ]);

        if (themesResult.error) {
          throw new Error(`Failed to fetch themes: ${themesResult.error.message}`);
        }
        if (projectResult.error) {
          throw new Error(`Failed to fetch project: ${projectResult.error.message}`);
        }
        if (existingProblemsResult.error) {
          throw new Error(`Failed to fetch existing problems: ${existingProblemsResult.error.message}`);
        }

        const themes = (themesResult.data ?? []) as ThemeRow[];
        const themeIds = themes.map((theme) => theme.id);

        let themeEvidence: ThemeEvidenceRow[] = [];
        if (themeIds.length > 0) {
          const { data, error } = await supabase
            .from("theme_evidence")
            .select("theme_id, evidence_id, relationship")
            .eq("org_id", org_id)
            .eq("project_id", project_id)
            .in("theme_id", themeIds)
            .neq("review_state", "rejected");

          if (error) throw new Error(`Failed to fetch theme evidence: ${error.message}`);
          themeEvidence = (data ?? []) as ThemeEvidenceRow[];
        }

        const evidenceIds = Array.from(new Set(themeEvidence.map((link) => link.evidence_id)));
        let evidence: EvidenceRow[] = [];
        if (evidenceIds.length > 0) {
          const { data, error } = await supabase
            .from("evidence")
            .select("id, content, summary, trust_scope, themes, metadata, created_at")
            .eq("org_id", org_id)
            .eq("project_id", project_id)
            .in("id", evidenceIds)
            .neq("trust_scope", "excluded");

          if (error) throw new Error(`Failed to fetch evidence: ${error.message}`);
          evidence = (data ?? []) as EvidenceRow[];
        }

        let evidenceTopics: EvidenceTopicRow[] = [];
        let topics: TopicRow[] = [];
        if (evidence.length > 0) {
          const { data, error } = await supabase
            .from("evidence_topics")
            .select("evidence_id, topic_id")
            .eq("org_id", org_id)
            .eq("project_id", project_id)
            .in("evidence_id", evidence.map((row) => row.id))
            .neq("review_state", "rejected");

          if (error) throw new Error(`Failed to fetch evidence topics: ${error.message}`);
          evidenceTopics = (data ?? []) as EvidenceTopicRow[];

          const topicIds = Array.from(new Set(evidenceTopics.map((link) => link.topic_id)));
          if (topicIds.length > 0) {
            const { data: topicRows, error: topicError } = await supabase
              .from("topics")
              .select("id, label")
              .eq("org_id", org_id)
              .eq("project_id", project_id)
              .in("id", topicIds);

            if (topicError) throw new Error(`Failed to fetch topics: ${topicError.message}`);
            topics = (topicRows ?? []) as TopicRow[];
          }
        }

        return {
          themes,
          themeEvidence,
          evidence,
          evidenceTopics,
          topics,
          existingProblems: (existingProblemsResult.data ?? []) as ExistingProblemRow[],
          frame: (projectResult.data?.frame as string | null) ?? "",
        };
      });

      if (context.themes.length === 0 || context.themeEvidence.length === 0) {
        await step.run("complete-empty", async () => {
          await supabase
            .from("agent_runs")
            .update({
              status: "completed",
              output: {
                dry_run: dryRun,
                themes: context.themes.length,
                theme_evidence_links: context.themeEvidence.length,
                problems_written: 0,
              },
              completed_at: new Date().toISOString(),
            })
            .eq("org_id", org_id)
            .eq("id", agentRunId!);
        });
        return { themes: context.themes.length, problems_written: 0 };
      }

      const { candidates, model_used, dropped_candidates } = await step.run("call-llm", async () => {
        const evidenceById = new Map(context.evidence.map((row) => [row.id, row]));
        const topicById = new Map(context.topics.map((topic) => [topic.id, topic]));
        const researchData = formatResearchDataForPrompt({
          themes: context.themes,
          themeEvidence: context.themeEvidence,
          evidenceById,
          evidenceTopics: context.evidenceTopics,
          topicById,
        });

        const result = await callLLM({
          tier: "premium",
          system:
            "You surface structured product problems from research evidence. Return strict JSON only.",
          messages: [
            {
              role: "user",
              content: buildProblemDiscoveryPrompt({
                frame: context.frame || "No project frame set.",
                researchData,
              }),
            },
          ],
          timeoutMs: 120_000,
        });

        // Resilient parse: extractJsonArray still throws if the response is not a
        // parseable JSON array at all. But a single malformed candidate must not
        // fail the whole batch — validate each element individually, keep the valid
        // ones, and drop (with a warning) the invalid ones for observability.
        const rawArray = extractJsonArray(result.content);
        if (!Array.isArray(rawArray)) {
          throw new Error("Problem discovery did not return a JSON array");
        }

        let droppedCount = 0;
        const validCandidates: ProblemCandidate[] = [];
        rawArray.forEach((element, index) => {
          const parsedCandidate = ProblemCandidateSchema.safeParse(element);
          if (parsedCandidate.success) {
            validCandidates.push(parsedCandidate.data);
            return;
          }
          droppedCount += 1;
          const failingPaths = parsedCandidate.error.issues
            .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
            .join("; ");
          console.warn(
            `[discover-problems] dropped invalid problem candidate at index ${index}: ${failingPaths}`
          );
        });

        const allowedThemeIds = new Set(context.themes.map((theme) => theme.id));
        const allowedEvidenceIds = new Set(context.evidence.map((row) => row.id));
        const allowedTopicIds = new Set(context.topics.map((topic) => topic.id));
        const sanitized = validCandidates
          .map((candidate) => sanitizeCandidate(candidate, allowedThemeIds, allowedEvidenceIds, allowedTopicIds))
          .filter((candidate) =>
            candidate.evidence_links.some((link) =>
              ["supporting", "example"].includes(link.relationship)
            )
          );

        return { candidates: sanitized, model_used: result.model, dropped_candidates: droppedCount };
      });

      const plans = await step.run("dedupe-candidates", async () =>
        buildDedupePlans({
          candidates,
          existingProblems: context.existingProblems,
        })
      );

      const report = await step.run("write-problems", async () => {
        let inserted = 0;
        let updated = 0;
        let locked = 0;
        let lockedLinked = 0;
        let skipped = 0;
        let themeLinks = 0;
        let evidenceLinks = 0;
        let topicLinks = 0;
        const dedupeMethods: Record<DedupeMethod, number> = {
          new: 0,
          normalised_title: 0,
          embedding: 0,
        };
        const similarityHistogram: Record<string, number> = {
          "<0.70": 0,
          "0.70-0.79": 0,
          "0.80-0.85": 0,
          "0.86-0.89": 0,
          ">=0.90": 0,
          null: 0,
        };

        for (const plan of plans) {
          dedupeMethods[plan.method] += 1;
          similarityHistogram[similarityBucket(plan.similarity)] += 1;

          if (plan.candidate.theme_links.length === 0 || plan.candidate.evidence_links.length === 0) {
            skipped++;
            continue;
          }

          if (dryRun) continue;

          let problemId = plan.existingProblem?.id ?? null;
          if (plan.existingProblem) {
            if (plan.existingProblem.status === "surfaced") {
              const { error } = await supabase
                .from("problems")
                .update(problemPayload(plan.candidate, agentRunId))
                .eq("org_id", org_id)
                .eq("project_id", project_id)
                .eq("id", plan.existingProblem.id)
                .eq("status", "surfaced");

              if (error) {
                throw new Error(`Failed to update problem "${plan.candidate.title}": ${error.message}`);
              }
              updated++;
            } else {
              locked++;
            }
          } else {
            const { data, error } = await supabase
              .from("problems")
              .insert({
                org_id,
                project_id,
                status: "surfaced",
                ...problemPayload(plan.candidate, agentRunId),
              })
              .select("id")
              .single();

            if (error || !data) {
              throw new Error(`Failed to write problem "${plan.candidate.title}": ${error?.message}`);
            }
            problemId = data.id as string;
            inserted++;
          }

          if (!problemId) continue;
          const linkCounts = await writeTypedLinks({
            supabase,
            orgId: org_id,
            projectId: project_id,
            agentRunId,
            problemId,
            candidate: plan.candidate,
          });
          themeLinks += linkCounts.themeLinks;
          evidenceLinks += linkCounts.evidenceLinks;
          topicLinks += linkCounts.topicLinks;
          if (plan.existingProblem && plan.existingProblem.status !== "surfaced") {
            lockedLinked++;
          }
        }

        if (!dryRun) {
          await supabase
            .from("projects")
            .update({ problems_discovered_at: new Date().toISOString() })
            .eq("org_id", org_id)
            .eq("id", project_id);
        }

        return {
          dry_run: dryRun,
          threshold: PROBLEM_DEDUPE_SIMILARITY_THRESHOLD,
          candidates: candidates.length,
          inserted,
          updated,
          locked,
          locked_linked: lockedLinked,
          skipped,
          theme_links: themeLinks,
          evidence_links: evidenceLinks,
          topic_links: topicLinks,
          dedupe_methods: dedupeMethods,
          similarity_histogram: similarityHistogram,
          planned_writes: dryRun ? plans.length - skipped : 0,
        };
      });

      await step.run("complete-agent-run", async () => {
        await supabase
          .from("agent_runs")
          .update({
            status: "completed",
            output: {
              themes: context.themes.length,
              theme_evidence_links: context.themeEvidence.length,
              evidence_supplied: context.evidence.length,
              dropped_candidates,
              ...report,
            },
            model_used,
            completed_at: new Date().toISOString(),
          })
          .eq("org_id", org_id)
          .eq("id", agentRunId!);
      });

      return {
        themes: context.themes.length,
        problems_written: report.inserted + report.updated,
        dry_run: dryRun,
      };
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
