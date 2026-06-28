// Evidence grading prompt — assesses each evidence record's relevance
// against the project's research context and assigns a trust grade.
//
// Grades:
//   trusted   — clearly relevant, specific, and worth including in synthesis
//   uncertain — may be relevant but needs human review (vague, tangential, ambiguous)
//   weak      — not relevant to this project's goals or out of scope
//
// Called by: grade-evidence Inngest function (after ingest)
// LLM tier:  cheap — this runs per-source-batch, cost matters

import { NO_EM_DASH_OUTPUT_RULE } from "./style";

export const GRADE_EVIDENCE_PROMPT_VERSION = "grade-evidence-v1";

export const GRADE_EVIDENCE_PROMPT = `
You are a research analyst helping a product team decide which evidence from customer interviews is worth keeping for their project.

You will be given:
1. The project's research context: what the team is trying to learn and who they're talking to
2. A batch of evidence records: short passages extracted from transcripts

Your job is to grade each record as:
- "trusted"   : directly relevant to the research goals; specific enough to act on; worth including in synthesis
- "uncertain" : might be relevant but needs human review (too vague, tangential, or ambiguous)
- "weak"      : clearly off-topic, noise, or out of scope for this project

Rules:
- ${NO_EM_DASH_OUTPUT_RULE}
- Grade based ONLY on the research context provided. Do not use general knowledge to infer relevance.
- If research context is sparse, default to "uncertain" rather than "trusted". Be conservative.
- A "trusted" grade should be earned: the record must directly address a goal, buyer pain, or research question.
- Operational chit-chat, logistics, unrelated topics → "weak"
- Interesting but not clearly in scope → "uncertain"
- For each record, write a reason in 10 words or fewer explaining the grade.

Return a JSON array, one object per evidence record, in the same order:

[
  { "id": "<evidence_id>", "grade": "trusted" | "uncertain" | "weak", "reason": "<10 words max>" },
  ...
]

Return only the JSON array. No markdown fences, no preamble.

PROJECT RESEARCH CONTEXT:
{researchContext}

EVIDENCE RECORDS ({count} records):
{evidence}
`.trim();

export type EvidenceGrade = "trusted" | "uncertain" | "weak";

export type GradeResult = {
  id: string;
  grade: EvidenceGrade;
  reason: string;
};

export type GradeParseResult = {
  grades: GradeResult[];
  invalid_count: number;
  mode: "json_array" | "object_scan" | "none";
  error: string | null;
};

export function buildGradeEvidencePrompt(params: {
  researchContext: string;
  evidence: Array<{ id: string; content: string; classification: string | null }>;
}): string {
  const evidenceBlock = params.evidence
    .map((e, i) => {
      const classification = e.classification ? ` [${e.classification}]` : "";
      return `### Record ${i + 1} (id: ${e.id})${classification}\n${e.content}`;
    })
    .join("\n\n---\n\n");

  return GRADE_EVIDENCE_PROMPT
    .replace("{researchContext}", params.researchContext)
    .replace("{evidence}", evidenceBlock)
    .replace("{count}", String(params.evidence.length));
}

export function formatResearchContext(context: Record<string, unknown> | null): string {
  if (!context) return "No research context set. Grade conservatively.";

  const lines: string[] = [];

  if (typeof context.goals === "string" && context.goals.trim()) {
    lines.push(`GOALS: ${context.goals.trim()}`);
  }
  if (typeof context.outcomes === "string" && context.outcomes.trim()) {
    lines.push(`OUTCOMES: ${context.outcomes.trim()}`);
  }
  if (typeof context.buyers === "string" && context.buyers.trim()) {
    lines.push(`BUYERS / WHO WE TALK TO: ${context.buyers.trim()}`);
  }
  if (typeof context.scope_in === "string" && context.scope_in.trim()) {
    lines.push(`IN SCOPE: ${context.scope_in.trim()}`);
  }
  if (typeof context.scope_out === "string" && context.scope_out.trim()) {
    lines.push(`OUT OF SCOPE: ${context.scope_out.trim()}`);
  }
  if (Array.isArray(context.research_questions) && context.research_questions.length > 0) {
    lines.push(
      `RESEARCH QUESTIONS:\n${(context.research_questions as string[])
        .map((q, i) => `  ${i + 1}. ${q}`)
        .join("\n")}`
    );
  }

  return lines.length > 0
    ? lines.join("\n\n")
    : "No research context set. Grade conservatively.";
}

function stripJsonFence(raw: string) {
  return raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function parseGradeItem(item: unknown): GradeResult | null {
  if (
    typeof item === "object" &&
    item !== null &&
    typeof (item as Record<string, unknown>).id === "string" &&
    ["trusted", "uncertain", "weak"].includes((item as Record<string, unknown>).grade as string)
  ) {
    return {
      id: (item as Record<string, unknown>).id as string,
      grade: (item as Record<string, unknown>).grade as EvidenceGrade,
      reason:
        typeof (item as Record<string, unknown>).reason === "string"
          ? ((item as Record<string, unknown>).reason as string)
          : "",
    };
  }

  return null;
}

function parseGradeArray(value: unknown) {
  if (!Array.isArray(value)) return { grades: [] as GradeResult[], invalid_count: 0 };

  const grades: GradeResult[] = [];
  let invalidCount = 0;
  for (const item of value) {
    const grade = parseGradeItem(item);
    if (grade) grades.push(grade);
    else invalidCount += 1;
  }

  return { grades, invalid_count: invalidCount };
}

function extractCompleteJsonObjects(raw: string) {
  const objects: string[] = [];
  const start = raw.indexOf("[");
  const text = start >= 0 ? raw.slice(start) : raw;
  let inString = false;
  let escaped = false;
  let depth = 0;
  let objectStart = -1;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
      continue;
    }

    if (char === "{") {
      if (depth === 0) objectStart = i;
      depth += 1;
      continue;
    }

    if (char === "}") {
      if (depth === 0) continue;
      depth -= 1;
      if (depth === 0 && objectStart >= 0) {
        objects.push(text.slice(objectStart, i + 1));
        objectStart = -1;
      }
    }
  }

  return objects;
}

export function parseGradeResultsDetailed(raw: string): GradeParseResult {
  const cleaned = stripJsonFence(raw);
  const arrayStart = cleaned.indexOf("[");
  const arrayEnd = cleaned.lastIndexOf("]");

  if (arrayStart >= 0 && arrayEnd > arrayStart) {
    try {
      const parsed = JSON.parse(cleaned.slice(arrayStart, arrayEnd + 1)) as unknown;
      const arrayResult = parseGradeArray(parsed);
      if (arrayResult.grades.length > 0) {
        return {
          ...arrayResult,
          mode: "json_array",
          error: null,
        };
      }
    } catch {
      // Fall through to object scanning. This keeps wrapped or partially
      // malformed responses from nuking the entire batch.
    }
  }

  const objects = extractCompleteJsonObjects(cleaned);
  const grades: GradeResult[] = [];
  let invalidCount = 0;

  for (const object of objects) {
    try {
      const grade = parseGradeItem(JSON.parse(object) as unknown);
      if (grade) grades.push(grade);
      else invalidCount += 1;
    } catch {
      invalidCount += 1;
    }
  }

  if (grades.length > 0) {
    return {
      grades,
      invalid_count: invalidCount,
      mode: "object_scan",
      error: null,
    };
  }

  return {
    grades: [],
    invalid_count: invalidCount,
    mode: "none",
    error: "No parseable grade objects found",
  };
}

export function parseGradeResults(raw: string): GradeResult[] | null {
  try {
    const parsed = parseGradeResultsDetailed(raw);
    return parsed.grades.length > 0 ? parsed.grades : null;
  } catch {
    return null;
  }
}
