import type { ProjectEntityRole } from "@/lib/ingest/entity-resolutions";
import { z } from "zod";
import {
  parseTranscriptSpeakerLegend,
  parseTranscriptTurns,
  type TranscriptSpeakerLegendEntry,
  type TranscriptTurn,
} from "@/lib/ingest/transcript-turns";
import { inferSourceType, type SourceInference } from "@/lib/ingest/source-inference";
import { callLLM } from "@/lib/llm/client";
import { normalizeSpeakerName } from "@/lib/speakers/resolve";
import type { SourceType } from "@/types/database";

type SupabaseLike = {
  from: (table: string) => any;
};

type PersonRecord = {
  id: string;
  name: string;
  role: string | null;
  company_id: string | null;
};

type CompanyRecord = {
  id: string;
  name: string;
  domain: string | null;
};

export type PrescanPersonCandidate = {
  person_id: string;
  name: string;
  company_name: string | null;
  score: number;
};

export type PrescanOrgCandidate = {
  company_id: string;
  name: string;
  domain: string | null;
  score: number;
};

export type PrescanSpeaker = {
  id: string;
  raw_label: string;
  suggested_name: string | null;
  suggested_role: ProjectEntityRole | null;
  suggested_org_name: string | null;
  person_match_candidates: PrescanPersonCandidate[];
  org_match_candidates: PrescanOrgCandidate[];
};

export type PrescanDetectedOrg = {
  id: string;
  name: string;
  org_match_candidates: PrescanOrgCandidate[];
};

export type PrescanResult = {
  source_inference: SourceInference;
  speakers: PrescanSpeaker[];
  detected_orgs: PrescanDetectedOrg[];
};

type IdentityNote = {
  raw_label: string;
  suggested_name: string | null;
  suggested_org_name: string | null;
  role_hint: string | null;
};

type DynamicSpeakerRosterItem = {
  raw_label: string;
  suggested_name: string | null;
  suggested_role: ProjectEntityRole | null;
  suggested_org_name: string | null;
};

type SpeakerSample = {
  text: string;
  turn_count: number;
  sampled_turn_count: number;
  truncated: boolean;
};

type PrescanLLMOptions = {
  enabled: boolean;
  project_id: string;
};

const PRESCAN_LLM_MAX_HEADER_CHARS = 2400;
const PRESCAN_LLM_MAX_TURN_CHARS = 360;
const PRESCAN_LLM_FIRST_TURNS = 40;
const PRESCAN_LLM_LATER_TURNS = 8;
const PRESCAN_LLM_MAX_SAMPLE_CHARS = 12000;
const PRESCAN_LLM_MAX_TOKENS = 900;
const PRESCAN_LLM_TIMEOUT_MS = 20_000;

const DynamicSpeakerRosterSchema = z.object({
  speakers: z
    .array(
      z.object({
        label: z.string().trim().min(1).max(120),
        display_name: z.string().trim().min(1).max(120).nullable().optional(),
        role: z.enum(["customer", "internal", "interviewer"]).nullable().optional(),
        org: z.string().trim().min(1).max(160).nullable().optional(),
      })
    )
    .max(24)
    .default([]),
});

const TRANSCRIPT_LIKE_TYPES = new Set<SourceType>([
  "transcript",
  "customer_interview",
  "sales_call",
  "usability_study",
  "internal_meeting",
]);

const TOOL_OR_PRODUCT_NAMES = new Set([
  "procore",
  "sharepoint",
  "slack",
  "teams",
  "microsoft teams",
  "excel",
  "jira",
  "asana",
  "notion",
  "salesforce",
  "hubspot",
]);

const USELESS_SPEAKER_LABELS = new Set([
  "and",
  "how",
  "that",
  "what",
  "when",
  "where",
  "which",
  "who",
  "why",
]);

function clampScore(value: number) {
  return Number(Math.max(0, Math.min(1, value)).toFixed(3));
}

function tokenSet(value: string) {
  return new Set(normalizeSpeakerName(value).split(" ").filter(Boolean));
}

function similarity(a: string, b: string) {
  const normalizedA = normalizeSpeakerName(a);
  const normalizedB = normalizeSpeakerName(b);
  if (!normalizedA || !normalizedB) return 0;
  if (normalizedA === normalizedB) return 1;
  if (normalizedA.includes(normalizedB) || normalizedB.includes(normalizedA)) {
    return clampScore(Math.min(normalizedA.length, normalizedB.length) / Math.max(normalizedA.length, normalizedB.length));
  }

  const tokensA = tokenSet(a);
  const tokensB = tokenSet(b);
  const intersection = Array.from(tokensA).filter((token) => tokensB.has(token)).length;
  const union = new Set([...Array.from(tokensA), ...Array.from(tokensB)]).size;
  if (union === 0) return 0;
  return clampScore(intersection / union);
}

function isUsefulLabel(label: string, options: { allowInitial?: boolean } = {}) {
  const normalized = normalizeSpeakerName(label);
  if (!normalized) return false;
  if (normalized.length < 2 && !options.allowInitial) return false;
  if (/^\d+$/.test(normalized)) return false;
  if (USELESS_SPEAKER_LABELS.has(normalized)) return false;
  return true;
}

function pushUniqueLabel(
  labels: Map<string, string>,
  label: string,
  options: { allowInitial?: boolean } = {}
) {
  const trimmed = label.trim();
  const normalized = normalizeSpeakerName(trimmed);
  if (!isUsefulLabel(trimmed, options) || labels.has(normalized)) return;
  labels.set(normalized, trimmed);
}

function clipText(value: string, maxChars: number) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, maxChars).trim()}...`;
}

function uniqueTurnIndexes(turns: TranscriptTurn[]) {
  const indexes = new Set<number>();
  const firstCount = Math.min(PRESCAN_LLM_FIRST_TURNS, turns.length);

  for (let i = 0; i < firstCount; i++) indexes.add(i);

  const remaining = turns.length - firstCount;
  if (remaining > 0) {
    const sampleCount = Math.min(PRESCAN_LLM_LATER_TURNS, remaining);
    for (let i = 1; i <= sampleCount; i++) {
      indexes.add(firstCount + Math.floor((i * remaining) / (sampleCount + 1)));
    }
  }

  return Array.from(indexes).sort((a, b) => a - b);
}

export function buildPrescanSpeakerSample(rawText: string): SpeakerSample {
  const turns = parseTranscriptTurns(rawText);
  const firstTurnStart = turns[0]?.char_start ?? rawText.length;
  const header = rawText.slice(0, Math.min(firstTurnStart, PRESCAN_LLM_MAX_HEADER_CHARS)).trim();
  const lines: string[] = [];

  if (header) {
    lines.push("HEADER");
    lines.push(clipText(header, PRESCAN_LLM_MAX_HEADER_CHARS));
  }

  if (turns.length > 0) {
    lines.push("SAMPLED_TURNS");
    for (const turnIndex of uniqueTurnIndexes(turns)) {
      const turn = turns[turnIndex];
      if (!turn) continue;
      const time = turn.start_time ? ` ${turn.start_time}` : "";
      lines.push(
        `[${turnIndex + 1}]${time} ${turn.speaker}: ${clipText(
          turn.content,
          PRESCAN_LLM_MAX_TURN_CHARS
        )}`
      );
    }
  } else {
    lines.push("TEXT_SAMPLE");
    lines.push(clipText(rawText, PRESCAN_LLM_MAX_SAMPLE_CHARS));
  }

  const full = lines.join("\n");
  const truncated = full.length > PRESCAN_LLM_MAX_SAMPLE_CHARS;
  return {
    text: truncated ? full.slice(0, PRESCAN_LLM_MAX_SAMPLE_CHARS).trim() : full,
    turn_count: turns.length,
    sampled_turn_count: turns.length > 0 ? uniqueTurnIndexes(turns).length : 0,
    truncated,
  };
}

function parseTranscriptSpeakerLabels(rawText: string, type: SourceType) {
  const labels = new Map<string, string>();
  const legend = parseTranscriptSpeakerLegend(rawText);
  const legendLabels = new Set(legend.map((entry) => normalizeSpeakerName(entry.label)));
  const counts = new Map<string, number>();
  const turns = parseTranscriptTurns(rawText);

  for (const turn of turns) {
    const normalized = normalizeSpeakerName(turn.speaker);
    if (!normalized) continue;
    counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
    if (!labels.has(normalized)) labels.set(normalized, turn.speaker);
  }

  for (const [normalized, label] of Array.from(labels.entries())) {
    const count = counts.get(normalized) ?? 0;
    if (count >= 2 || legendLabels.has(normalized)) continue;
    labels.delete(normalized);
  }

  for (const entry of legend) {
    pushUniqueLabel(labels, entry.label, { allowInitial: true });
  }

  if (!TRANSCRIPT_LIKE_TYPES.has(type) && labels.size < 2) return [];
  return Array.from(labels.values());
}

function extractJsonObject(value: string) {
  const start = value.indexOf("{");
  const end = value.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  return value.slice(start, end + 1);
}

export function parseDynamicSpeakerRoster(value: string): DynamicSpeakerRosterItem[] {
  const json = extractJsonObject(value);
  if (!json) return [];

  try {
    const parsed = DynamicSpeakerRosterSchema.safeParse(JSON.parse(json));
    if (!parsed.success) return [];
    return parsed.data.speakers
      .map((speaker) => ({
        raw_label: speaker.label.trim(),
        suggested_name: cleanName(speaker.display_name ?? null),
        suggested_role: speaker.role ?? null,
        suggested_org_name: cleanOrgName(speaker.org ?? null),
      }))
      .filter((speaker) => isUsefulLabel(speaker.raw_label, { allowInitial: true }));
  } catch {
    return [];
  }
}

function cleanName(value: string | null | undefined) {
  if (!value) return null;
  const cleaned = value
    .replace(/\b(?:and|who|that|which)\b.*$/i, "")
    .replace(/[.;:]+$/g, "")
    .trim();
  return cleaned || null;
}

function cleanOrgName(value: string | null | undefined) {
  const cleaned = cleanName(value);
  if (!cleaned) return null;

  const sentenceBounded = cleaned
    .replace(/[.!?]\s+.*$/g, "")
    .replace(/\s+\b(?:so|this|these|those|there|it|it's|i|we|you|they)\b.*$/i, "")
    .replace(/[.;:]+$/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();

  return sentenceBounded || null;
}

function parseInlineIdentityNotes(rawText: string) {
  const notes = new Map<string, IdentityNote>();
  const sentences = rawText
    .replace(/\r/g, "")
    .split(/(?<=[.!?])\s+|\n+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);

  for (const sentence of sentences) {
    const called = sentence.match(
      /(?:this\s+person\s+)?([A-Za-z0-9_@.'-]{2,80})\s+is\s+called\s+([A-Za-z][A-Za-z .'’-]{1,80})/i
    );
    const directName = sentence.match(
      /(?:speaker|participant|person)\s+([A-Za-z0-9_@.'-]{2,80})\s+is\s+([A-Za-z][A-Za-z .'’-]{1,80})/i
    );
    const rawLabel = called?.[1] ?? directName?.[1] ?? null;
    const suggestedName = cleanName(called?.[2] ?? directName?.[2] ?? null);
    if (!rawLabel || !suggestedName) continue;

    const orgMatch = sentence.match(
      /\b(?:works\s+(?:for|at)|from|at)\s+([A-Za-z][A-Za-z0-9 &'’.-]{1,80})/i
    );
    const roleMatch = sentence.match(
      /,\s*([A-Za-z][A-Za-z0-9 /&'-]{2,80})\s*\.?$/i
    );
    const note: IdentityNote = {
      raw_label: rawLabel.trim(),
      suggested_name: suggestedName,
      suggested_org_name: cleanOrgName(orgMatch?.[1] ?? null),
      role_hint: cleanName(roleMatch?.[1] ?? null),
    };
    notes.set(normalizeSpeakerName(note.raw_label), note);
  }

  return notes;
}

function detectMentionedOrgs(rawText: string, identityNotes: IdentityNote[]) {
  const orgs = new Map<string, string>();

  for (const note of identityNotes) {
    if (!note.suggested_org_name) continue;
    const key = normalizeSpeakerName(note.suggested_org_name);
    if (key && !TOOL_OR_PRODUCT_NAMES.has(key)) orgs.set(key, note.suggested_org_name);
  }

  const orgPatterns = [
    /\b(?:company|organisation|organization|employer)\s+(?:is|was|called|named)\s+([A-Z][A-Za-z0-9 &'’.-]{1,80})/g,
  ];

  for (const pattern of orgPatterns) {
    for (const match of Array.from(rawText.matchAll(pattern))) {
      const name = cleanOrgName(match[1]);
      if (!name) continue;
      const key = normalizeSpeakerName(name);
      if (!key || TOOL_OR_PRODUCT_NAMES.has(key)) continue;
      orgs.set(key, name);
    }
  }

  return Array.from(orgs.values());
}

function roleFromType(type: SourceType): ProjectEntityRole | null {
  if (type === "internal_meeting") return "internal";
  if (
    type === "transcript" ||
    type === "customer_interview" ||
    type === "sales_call" ||
    type === "usability_study"
  ) {
    return "customer";
  }
  return null;
}

function formatLegendForPrompt(legend: TranscriptSpeakerLegendEntry[]) {
  if (legend.length === 0) return "None detected.";
  return legend
    .slice(0, 20)
    .map((entry) => `${entry.label}: ${entry.name}${entry.role ? ` (${entry.role})` : ""}`)
    .join("\n");
}

async function identifySpeakersWithLLM(input: {
  org_id: string;
  project_id: string;
  raw_text: string;
  type: SourceType;
  deterministic_labels: string[];
  legend: TranscriptSpeakerLegendEntry[];
}) {
  const sample = buildPrescanSpeakerSample(input.raw_text);
  if (!sample.text.trim()) return [];

  try {
    const result = await callLLM({
      tier: "cheap",
      system: [
        "You identify speakers for a pre-ingest transcript review.",
        "Return strict JSON only, no markdown.",
        "Use only the supplied bounded sample. Do not invent people or organisations.",
        "A speaker is a participant in the conversation, not a metadata key or export heading.",
        "Classify interviewer, researcher, moderator, or facilitator as role \"interviewer\".",
        "Classify the person being interviewed, respondent, participant, customer, buyer, or user as role \"customer\".",
        "Use role \"internal\" only when the sample clearly says the speaker belongs to the product team or internal company.",
        "If a label is a shorthand such as I, P, Q, or A, keep it as label and put the expanded identity in display_name when clear.",
        "Output shape: {\"speakers\":[{\"label\":\"raw label\",\"display_name\":\"name or role label\",\"role\":\"customer|internal|interviewer\",\"org\":\"org or null\"}]}",
      ].join("\n"),
      messages: [
        {
          role: "user",
          content: [
            `SOURCE_TYPE: ${input.type}`,
            `TURN_COUNT: ${sample.turn_count}`,
            `SAMPLED_TURN_COUNT: ${sample.sampled_turn_count}`,
            `SAMPLE_TRUNCATED: ${sample.truncated ? "yes" : "no"}`,
            "",
            "DETERMINISTIC_LABEL_CANDIDATES",
            input.deterministic_labels.length
              ? input.deterministic_labels.slice(0, 30).join("\n")
              : "None detected.",
            "",
            "LEGEND",
            formatLegendForPrompt(input.legend),
            "",
            "BOUNDED_TRANSCRIPT_SAMPLE",
            sample.text,
          ].join("\n"),
        },
      ],
      maxTokens: PRESCAN_LLM_MAX_TOKENS,
      timeoutMs: PRESCAN_LLM_TIMEOUT_MS,
      temperature: 0,
      telemetry: {
        orgId: input.org_id,
        projectId: input.project_id,
        agentType: "ingest-prescan",
        step: "identify-speakers",
      },
    });

    return parseDynamicSpeakerRoster(result.content);
  } catch (error) {
    console.error("[ingest/prescan] speaker LLM pass failed; using deterministic prescan only", {
      message: error instanceof Error ? error.message : String(error),
      project_id: input.project_id,
    });
    return [];
  }
}

function personCandidates(
  label: string,
  people: PersonRecord[],
  companyById: Map<string, CompanyRecord>
) {
  return people
    .map((person) => ({
      person_id: person.id,
      name: person.name,
      company_name: person.company_id ? companyById.get(person.company_id)?.name ?? null : null,
      score: similarity(label, person.name),
    }))
    .filter((candidate) => candidate.score >= 0.5)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, 3);
}

function orgCandidates(label: string | null, companies: CompanyRecord[]) {
  if (!label) return [];
  return companies
    .map((company) => ({
      company_id: company.id,
      name: company.name,
      domain: company.domain,
      score: Math.max(similarity(label, company.name), company.domain ? similarity(label, company.domain) : 0),
    }))
    .filter((candidate) => candidate.score >= 0.5)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, 3);
}

export async function prescanSourceEntities(input: {
  supabase: SupabaseLike;
  org_id: string;
  type?: SourceType;
  raw_text: string;
  llm?: PrescanLLMOptions;
}): Promise<PrescanResult> {
  const sourceInference = inferSourceType(input.raw_text);
  const effectiveType = input.type ?? sourceInference.type;
  const [peopleResult, companiesResult] = await Promise.all([
    input.supabase
      .from("people")
      .select("id, name, role, company_id")
      .eq("org_id", input.org_id)
      .order("name", { ascending: true }),
    input.supabase
      .from("companies")
      .select("id, name, domain")
      .eq("org_id", input.org_id)
      .order("name", { ascending: true }),
  ]);

  if (peopleResult.error) {
    throw new Error(`Failed to load people for prescan: ${peopleResult.error.message}`);
  }
  if (companiesResult.error) {
    throw new Error(`Failed to load companies for prescan: ${companiesResult.error.message}`);
  }

  const people = (peopleResult.data ?? []) as PersonRecord[];
  const companies = (companiesResult.data ?? []) as CompanyRecord[];
  const companyById = new Map(companies.map((company) => [company.id, company]));
  const identityNotes = parseInlineIdentityNotes(input.raw_text);
  const legendEntries = parseTranscriptSpeakerLegend(input.raw_text);
  const speakerLegend = new Map(
    legendEntries.map((entry) => [
      normalizeSpeakerName(entry.label),
      entry,
    ])
  );
  const labels = new Map<string, string>();

  for (const label of parseTranscriptSpeakerLabels(input.raw_text, effectiveType)) {
    pushUniqueLabel(labels, label, { allowInitial: speakerLegend.has(normalizeSpeakerName(label)) });
  }
  for (const note of Array.from(identityNotes.values())) {
    pushUniqueLabel(labels, note.raw_label);
  }

  const dynamicRoster =
    input.llm?.enabled && input.llm.project_id
      ? await identifySpeakersWithLLM({
          org_id: input.org_id,
          project_id: input.llm.project_id,
          raw_text: input.raw_text,
          type: effectiveType,
          deterministic_labels: Array.from(labels.values()),
          legend: legendEntries,
        })
      : [];
  const dynamicRosterByLabel = new Map(
    dynamicRoster.map((speaker) => [normalizeSpeakerName(speaker.raw_label), speaker])
  );

  for (const speaker of dynamicRoster) {
    pushUniqueLabel(labels, speaker.raw_label, { allowInitial: true });
  }

  const speakers = Array.from(labels.values()).map((rawLabel, index) => {
    const normalizedRawLabel = normalizeSpeakerName(rawLabel);
    const note = identityNotes.get(normalizedRawLabel) ?? null;
    const legendEntry = speakerLegend.get(normalizedRawLabel) ?? null;
    const dynamic = dynamicRosterByLabel.get(normalizedRawLabel) ?? null;
    const suggestedName =
      note?.suggested_name ?? legendEntry?.name ?? dynamic?.suggested_name ?? rawLabel;
    const suggestedOrg = note?.suggested_org_name ?? dynamic?.suggested_org_name ?? null;
    const suggestedRole =
      (legendEntry?.role === "interviewer"
        ? "interviewer"
        : legendEntry?.role === "customer"
          ? "customer"
          : dynamic?.suggested_role ?? roleFromType(effectiveType));

    return {
      id: `speaker-${index + 1}`,
      raw_label: rawLabel,
      suggested_name: suggestedName,
      suggested_role: suggestedRole,
      suggested_org_name: suggestedOrg,
      person_match_candidates: personCandidates(suggestedName, people, companyById),
      org_match_candidates: orgCandidates(suggestedOrg, companies),
    };
  });

  const detectedOrgNames = new Map<string, string>();
  for (const orgName of detectMentionedOrgs(input.raw_text, Array.from(identityNotes.values()))) {
    detectedOrgNames.set(normalizeSpeakerName(orgName), orgName);
  }
  for (const speaker of dynamicRoster) {
    if (!speaker.suggested_org_name) continue;
    detectedOrgNames.set(normalizeSpeakerName(speaker.suggested_org_name), speaker.suggested_org_name);
  }

  const detectedOrgs = Array.from(detectedOrgNames.values())
    .filter((orgName) => !speakers.some((speaker) => speaker.suggested_org_name === orgName))
    .map((orgName, index) => ({
      id: `org-${index + 1}`,
      name: orgName,
      org_match_candidates: orgCandidates(orgName, companies),
    }));

  return { source_inference: sourceInference, speakers, detected_orgs: detectedOrgs };
}
