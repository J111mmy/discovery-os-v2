// Ingest pipeline — runs as an Inngest background function.
// Deterministic parsing creates source segments; AI extraction creates evidence.

import { z } from "zod";
import { inngest } from "../client";
import { createServiceClient } from "@/lib/supabase/server";
import { callLLM, embedBatch } from "@/lib/llm/client";
import { PROCESSED_MARKER_ERROR, looksLikeProcessedMarker } from "@/lib/ingest/quality";
import { redactPII } from "@/lib/llm/pii";
import {
  buildIngestExtractionPrompt,
  INGEST_EXTRACTION_PROMPT_VERSION,
} from "@/lib/llm/prompts/ingest";
import type {
  Affiliation,
  EvidenceClassification,
  EvidenceSentiment,
  SourceType,
} from "@/types/database";

type RawSegment = {
  speaker: string | null;
  content: string;
  conversation_unit_id: string;
  segment_index: number;
  char_start: number;
  char_end: number;
  start_time: string | null;
  end_time: string | null;
};

type TranscriptTurn = {
  speaker: string;
  content: string;
  char_start: number;
  char_end: number;
  start_time: string | null;
  end_time: string | null;
};

type TextLine = {
  raw: string;
  trimmed: string;
  start: number;
  end: number;
  trimmedStart: number;
  trimmedEnd: number;
};

type StoredSegment = {
  id: string;
  segment_index: number;
  speaker: string | null;
  redacted_content: string | null;
  conversation_unit_id: string | null;
};

type ConversationUnit = {
  id: string;
  segments: StoredSegment[];
  content: string;
};

type ProjectContext = {
  id?: string;
  name: string;
  frame: string | null;
  frame_data: Record<string, unknown> | null;
};

type ThemeContext = {
  label: string;
  description: string | null;
};

type InternalSpeaker = {
  name: string;
  role: string | null;
};

type SourceSpeaker = {
  id: string;
  name: string;
  role: string | null;
  affiliation: Affiliation;
};

const MAX_TURN_TOKENS = 800;
const DEFAULT_MAX_CLAIMS_PER_SOURCE = 200;

const ExtractedClaimSchema = z.object({
  content: z.string().trim().min(1),
  summary: z.string().trim().nullable().optional(),
  classification: z.enum(["insight", "verbatim", "data_point", "signal"]),
  sentiment: z.enum(["positive", "negative", "neutral", "mixed"]),
  speaker: z.string().trim().nullable().optional(),
  themes: z.array(z.string().trim().min(1)).optional().default([]),
  adjacent_project_hint: z.string().trim().nullable().optional(),
  adjacent_project_reason: z.string().trim().nullable().optional(),
});

type ExtractedClaim = z.infer<typeof ExtractedClaimSchema>;

function normalizedText(text: string) {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function wordCount(text: string) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function titleFromHint(value: string) {
  return value
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[.!?]+$/g, "")
    .slice(0, 120);
}

function normalizeName(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenEstimate(text: string) {
  return Math.ceil(wordCount(text) * 1.3);
}

function maxClaimsPerSource() {
  const configured = Number(process.env.INGEST_MAX_CLAIMS_PER_SOURCE);
  return Number.isInteger(configured) && configured > 0
    ? configured
    : DEFAULT_MAX_CLAIMS_PER_SOURCE;
}

function isTimestamp(value: string) {
  return /^\[?\d{1,2}:\d{2}(?::\d{2})?\]?$/.test(value.trim());
}

function isInitialLine(value: string) {
  return /^[A-Z]{1,4}$/.test(value.trim());
}

function isSpeakerNameLine(value: string) {
  const trimmed = value.trim();
  return (
    trimmed.length >= 2 &&
    trimmed.length <= 80 &&
    !isInitialLine(trimmed) &&
    !isTimestamp(trimmed) &&
    /^[A-Z][A-Za-z .'-]+$/.test(trimmed)
  );
}

function getLines(text: string): TextLine[] {
  const lines: TextLine[] = [];
  const normalized = normalizedText(text);
  const pattern = /[^\n]*(?:\n|$)/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(normalized))) {
    if (match[0] === "") break;

    const rawWithBreak = match[0];
    const raw = rawWithBreak.endsWith("\n")
      ? rawWithBreak.slice(0, -1)
      : rawWithBreak;
    const start = match.index;
    const end = start + raw.length;
    const leading = raw.match(/^\s*/)?.[0].length ?? 0;
    const trailing = raw.match(/\s*$/)?.[0].length ?? 0;
    const trimmedStart = start + leading;
    const trimmedEnd = Math.max(trimmedStart, end - trailing);

    lines.push({
      raw,
      trimmed: raw.trim(),
      start,
      end,
      trimmedStart,
      trimmedEnd,
    });
  }

  return lines;
}

function parseTranscriptTurns(text: string): TranscriptTurn[] {
  const lines = getLines(text);
  const speakerColonLine =
    /^(?:\[?(\d{1,2}:\d{2}(?::\d{2})?)\]?\s+)?([A-Za-z][^:\n]{0,80}):\s*(.*)$/;
  const timestampSpeakerLine =
    /^\[?(\d{1,2}:\d{2}(?::\d{2})?)\]?\s+([A-Za-z][A-Za-z .'-]{1,80})(?::)?\s*(.*)$/;
  const speakerTimestampLine =
    /^([A-Za-z][A-Za-z .'-]{1,80})\s+\[?(\d{1,2}:\d{2}(?::\d{2})?)\]?\s*(.*)$/;

  const turns: TranscriptTurn[] = [];
  let curSpeaker: string | null = null;
  let curStartTime: string | null = null;
  let curLines: Array<{ text: string; start: number; end: number }> = [];

  function flushTurn(nextStartTime: string | null = null) {
    if (curSpeaker && curLines.length > 0) {
      turns.push({
        speaker: curSpeaker,
        content: curLines.map((line) => line.text).join("\n"),
        char_start: curLines[0].start,
        char_end: curLines[curLines.length - 1].end,
        start_time: curStartTime,
        end_time: nextStartTime,
      });
    }
    curLines = [];
  }

  function startTurn(
    speaker: string,
    time: string | null,
    firstContent: string,
    firstLine: TextLine
  ) {
    flushTurn(time);
    curSpeaker = speaker.trim();
    curStartTime = time;
    curLines = [];

    const content = firstContent.trim();
    if (content) {
      const start = firstLine.trimmedEnd - content.length;
      curLines.push({ text: content, start, end: firstLine.trimmedEnd });
    }
  }

  function addContentLine(line: TextLine) {
    if (!curSpeaker || !line.trimmed) return;
    curLines.push({
      text: line.trimmed,
      start: line.trimmedStart,
      end: line.trimmedEnd,
    });
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trimmed) continue;

    const speakerColonMatch = line.trimmed.match(speakerColonLine);
    if (speakerColonMatch?.[2]) {
      startTurn(
        speakerColonMatch[2],
        speakerColonMatch[1] ?? null,
        speakerColonMatch[3] ?? "",
        line
      );
      continue;
    }

    const timestampSpeakerMatch = line.trimmed.match(timestampSpeakerLine);
    if (timestampSpeakerMatch?.[2]) {
      startTurn(
        timestampSpeakerMatch[2],
        timestampSpeakerMatch[1] ?? null,
        timestampSpeakerMatch[3] ?? "",
        line
      );
      continue;
    }

    const speakerTimestampMatch = line.trimmed.match(speakerTimestampLine);
    if (
      speakerTimestampMatch?.[1] &&
      isSpeakerNameLine(speakerTimestampMatch[1])
    ) {
      startTurn(
        speakerTimestampMatch[1],
        speakerTimestampMatch[2] ?? null,
        speakerTimestampMatch[3] ?? "",
        line
      );
      continue;
    }

    const next = lines[i + 1];
    const afterNext = lines[i + 2];
    if (
      isInitialLine(line.trimmed) &&
      next &&
      afterNext &&
      isSpeakerNameLine(next.trimmed) &&
      isTimestamp(afterNext.trimmed)
    ) {
      startTurn(next.trimmed, afterNext.trimmed.replace(/^\[|\]$/g, ""), "", afterNext);
      i += 2;
      continue;
    }

    if (isSpeakerNameLine(line.trimmed) && next && isTimestamp(next.trimmed)) {
      startTurn(line.trimmed, next.trimmed.replace(/^\[|\]$/g, ""), "", next);
      i += 1;
      continue;
    }

    if (isTimestamp(line.trimmed)) continue;
    addContentLine(line);
  }

  flushTurn(null);
  return turns;
}

function splitOversizedTurn(turn: TranscriptTurn): TranscriptTurn[] {
  if (tokenEstimate(turn.content) <= MAX_TURN_TOKENS) return [turn];

  const sentences = Array.from(
    turn.content.matchAll(/[^.!?]+[.!?]+(?:\s+|$)|[^.!?]+$/g)
  )
    .map((match) => ({
      text: match[0].trim(),
      start: match.index ?? 0,
      end: (match.index ?? 0) + match[0].length,
    }))
    .filter((sentence) => sentence.text);

  if (sentences.length === 0) return [turn];

  const splitTurns: TranscriptTurn[] = [];
  let buffer: typeof sentences = [];

  function flush() {
    if (buffer.length === 0) return;
    const content = buffer.map((sentence) => sentence.text).join(" ");
    splitTurns.push({
      ...turn,
      content,
      char_start: turn.char_start + buffer[0].start,
      char_end: turn.char_start + buffer[buffer.length - 1].end,
    });
    buffer = [];
  }

  for (const sentence of sentences) {
    const candidate = [...buffer, sentence]
      .map((entry) => entry.text)
      .join(" ");
    if (buffer.length > 0 && tokenEstimate(candidate) > MAX_TURN_TOKENS) {
      flush();
    }
    buffer.push(sentence);
  }

  flush();
  return splitTurns;
}

function chooseInterviewer(turns: TranscriptTurn[]) {
  const scores = new Map<string, { questions: number; turns: number; firstIndex: number }>();

  turns.forEach((turn, index) => {
    const current = scores.get(turn.speaker) ?? {
      questions: 0,
      turns: 0,
      firstIndex: index,
    };
    current.questions += (turn.content.match(/\?/g) ?? []).length;
    current.turns += 1;
    scores.set(turn.speaker, current);
  });

  const ranked = Array.from(scores.entries()).sort((a, b) => {
    const questionDelta = b[1].questions - a[1].questions;
    if (questionDelta !== 0) return questionDelta;
    return a[1].firstIndex - b[1].firstIndex;
  });

  return ranked[0]?.[0] ?? turns[0]?.speaker ?? "";
}

function assignConversationUnits(turns: TranscriptTurn[]): RawSegment[] {
  const expandedTurns = turns.flatMap(splitOversizedTurn);
  if (expandedTurns.length === 0) return [];

  const interviewer = chooseInterviewer(expandedTurns);
  let unitIndex = 0;

  return expandedTurns.map((turn, index) => {
    if (index > 0 && turn.speaker === interviewer) unitIndex += 1;

    return {
      speaker: turn.speaker,
      content: turn.content,
      conversation_unit_id: `cu-${String(unitIndex + 1).padStart(4, "0")}`,
      segment_index: index,
      char_start: turn.char_start,
      char_end: turn.char_end,
      start_time: turn.start_time,
      end_time: turn.end_time,
    };
  });
}

function looksLikeTranscriptTurns(turns: TranscriptTurn[]) {
  if (turns.length < 4) return false;

  const speakerCounts = new Map<string, number>();
  for (const turn of turns) {
    speakerCounts.set(turn.speaker, (speakerCounts.get(turn.speaker) ?? 0) + 1);
  }

  return speakerCounts.size >= 2 && Array.from(speakerCounts.values()).some((count) => count >= 2);
}

function segmentDocument(text: string): RawSegment[] {
  const normalized = normalizedText(text);
  const matches = Array.from(normalized.matchAll(/\S[\s\S]*?(?=\n{2,}\S|$)/g));

  return matches
    .map((match, index) => {
      const raw = match[0];
      const leading = raw.match(/^\s*/)?.[0].length ?? 0;
      const trailing = raw.match(/\s*$/)?.[0].length ?? 0;
      const content = raw.trim();
      const start = (match.index ?? 0) + leading;
      const end = (match.index ?? 0) + raw.length - trailing;

      return {
        speaker: null,
        content,
        conversation_unit_id: `doc-${String(index + 1).padStart(4, "0")}`,
        segment_index: index,
        char_start: start,
        char_end: end,
        start_time: null,
        end_time: null,
      };
    })
    .filter((segment) => segment.content);
}

const TRANSCRIPT_LIKE_TYPES = new Set<SourceType>([
  "transcript",
  "customer_interview",
  "sales_call",
  "usability_study",
  "internal_meeting",
]);

function uniqueSpeakerNames(segments: RawSegment[]) {
  const speakers = new Map<string, string>();

  for (const segment of segments) {
    const speaker = segment.speaker?.trim();
    if (!speaker) continue;

    const normalized = normalizeName(speaker);
    if (!normalized) continue;
    if (!speakers.has(normalized)) speakers.set(normalized, speaker);
  }

  return Array.from(speakers.values());
}

function inferInternalSpeakerNames(segments: RawSegment[], type: SourceType) {
  const speakers = uniqueSpeakerNames(segments);
  if (speakers.length === 0) return [];
  if (type === "internal_meeting") return speakers;

  const scores = new Map<string, { questions: number; turns: number; firstIndex: number; name: string }>();

  segments.forEach((segment, index) => {
    if (!segment.speaker) return;
    const key = normalizeName(segment.speaker);
    if (!key) return;
    const current = scores.get(key) ?? {
      questions: 0,
      turns: 0,
      firstIndex: index,
      name: segment.speaker.trim(),
    };
    current.questions += (segment.content.match(/\?/g) ?? []).length;
    current.turns += 1;
    scores.set(key, current);
  });

  const ranked = Array.from(scores.values()).sort((a, b) => {
    const questionDelta = b.questions - a.questions;
    if (questionDelta !== 0) return questionDelta;
    const turnDelta = b.turns - a.turns;
    if (turnDelta !== 0) return turnDelta;
    return a.firstIndex - b.firstIndex;
  });

  const facilitator = ranked[0];
  return facilitator && facilitator.questions > 0 ? [facilitator.name] : [];
}

function segmentText(text: string, type: SourceType): RawSegment[] {
  const transcriptTurns = parseTranscriptTurns(text);

  if (TRANSCRIPT_LIKE_TYPES.has(type)) {
    const transcriptSegments = assignConversationUnits(transcriptTurns);
    if (transcriptSegments.length > 0) return transcriptSegments;
  }

  if (looksLikeTranscriptTurns(transcriptTurns)) {
    return assignConversationUnits(transcriptTurns);
  }

  return segmentDocument(text);
}

function formatFrame(project: ProjectContext) {
  if (project.frame_data && Object.keys(project.frame_data).length > 0) {
    return JSON.stringify(project.frame_data, null, 2);
  }
  return project.frame?.trim() || `Project: ${project.name}`;
}

function formatThemes(themes: ThemeContext[]) {
  if (themes.length === 0) return "No existing themes yet.";
  return themes
    .map((theme) =>
      theme.description ? `- ${theme.label}: ${theme.description}` : `- ${theme.label}`
    )
    .join("\n");
}

function formatInternalSpeakers(speakers: InternalSpeaker[]) {
  if (speakers.length === 0) return null;
  return speakers
    .map((s) => (s.role ? `- ${s.name} (${s.role})` : `- ${s.name}`))
    .join("\n");
}

function mergeInternalSpeakers(
  knownInternalSpeakers: InternalSpeaker[],
  sourceSpeakers: SourceSpeaker[]
): InternalSpeaker[] {
  const byName = new Map<string, InternalSpeaker>();

  for (const speaker of knownInternalSpeakers) {
    byName.set(normalizeName(speaker.name), speaker);
  }

  for (const speaker of sourceSpeakers) {
    if (speaker.affiliation !== "internal") continue;
    const key = normalizeName(speaker.name);
    if (!byName.has(key)) {
      byName.set(key, { name: speaker.name, role: speaker.role });
    }
  }

  return Array.from(byName.values());
}

async function syncSourceSpeakers(input: {
  supabase: ReturnType<typeof createServiceClient>;
  org_id: string;
  project_id: string;
  segments: RawSegment[];
  inferredInternalSpeakerNames: string[];
}) {
  const speakerNames = uniqueSpeakerNames(input.segments);
  if (speakerNames.length === 0) return [];

  const inferredInternal = new Set(input.inferredInternalSpeakerNames.map(normalizeName));

  const { data: existingPeople, error } = await input.supabase
    .from("people")
    .select("id, name, role, affiliation")
    .eq("org_id", input.org_id);

  if (error) throw new Error(`Failed to fetch source speakers: ${error.message}`);

  const existingByName = new Map<string, SourceSpeaker>(
    ((existingPeople ?? []) as SourceSpeaker[]).map((person) => [
      normalizeName(person.name),
      person,
    ])
  );
  const synced: SourceSpeaker[] = [];

  for (const speakerName of speakerNames) {
    const key = normalizeName(speakerName);
    if (!key) continue;

    const desiredAffiliation: Affiliation = inferredInternal.has(key) ? "internal" : "unknown";
    const existing = existingByName.get(key);
    let person: SourceSpeaker;

    if (existing) {
      person = existing;
      if (desiredAffiliation === "internal" && existing.affiliation === "unknown") {
        const { data: updated, error: updateError } = await input.supabase
          .from("people")
          .update({
            affiliation: "internal",
            updated_at: new Date().toISOString(),
          })
          .eq("org_id", input.org_id)
          .eq("id", existing.id)
          .select("id, name, role, affiliation")
          .single();

        if (updateError || !updated) {
          throw new Error(`Failed to update speaker ${speakerName}: ${updateError?.message}`);
        }

        person = updated as SourceSpeaker;
        existingByName.set(key, person);
      }
    } else {
      const { data: inserted, error: insertError } = await input.supabase
        .from("people")
        .insert({
          org_id: input.org_id,
          name: speakerName,
          role: null,
          status: "interviewed",
          affiliation: desiredAffiliation,
        })
        .select("id, name, role, affiliation")
        .single();

      if (insertError || !inserted) {
        throw new Error(`Failed to create speaker ${speakerName}: ${insertError?.message}`);
      }

      person = inserted as SourceSpeaker;
      existingByName.set(key, person);
    }

    await input.supabase
      .from("person_projects")
      .upsert(
        {
          person_id: person.id,
          project_id: input.project_id,
          status: person.affiliation === "internal" ? "facilitator" : "interviewed",
        },
        { onConflict: "person_id,project_id" }
      );

    synced.push(person);
  }

  return synced;
}

function extractJsonArray(content: string) {
  const trimmed = content.trim();
  const unfenced = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  const start = unfenced.indexOf("[");
  if (start === -1) {
    throw new Error("Ingest extraction returned no JSON array");
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < unfenced.length; i++) {
    const char = unfenced[i];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === "\\") {
      escaped = true;
      continue;
    }

    if (char === "\"") {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (char === "[") depth += 1;
    if (char === "]") {
      depth -= 1;
      if (depth === 0) {
        return JSON.parse(unfenced.slice(start, i + 1)) as unknown;
      }
    }
  }

  throw new Error("Ingest extraction returned incomplete JSON array");
}

function normalizeClaim(value: unknown): ExtractedClaim | null {
  const parsed = ExtractedClaimSchema.safeParse(value);
  if (!parsed.success) return null;
  if (
    parsed.data.classification !== "data_point" &&
    wordCount(parsed.data.content) < 5
  ) {
    return null;
  }
  return parsed.data;
}

function resolveAdjacentProject(
  hint: string | null | undefined,
  otherProjects: Array<{ id: string; name: string; frame: string | null }>
) {
  const hintSlug = slugify(hint ?? "");
  if (!hintSlug) return null;

  return (
    otherProjects.find((project) => {
      const projectSlug = slugify(project.name);
      return (
        projectSlug === hintSlug ||
        hintSlug.includes(projectSlug) ||
        projectSlug.includes(hintSlug)
      );
    }) ?? null
  );
}

function buildConversationUnits(segments: StoredSegment[]): ConversationUnit[] {
  const byUnit = new Map<string, StoredSegment[]>();

  for (const segment of segments) {
    const unitId = segment.conversation_unit_id ?? `segment-${segment.segment_index}`;
    const group = byUnit.get(unitId) ?? [];
    group.push(segment);
    byUnit.set(unitId, group);
  }

  return Array.from(byUnit.entries()).map(([id, unitSegments]) => {
    const content = unitSegments
      .map((segment) => {
        const body = segment.redacted_content?.trim() ?? "";
        return segment.speaker ? `${segment.speaker}: ${body}` : body;
      })
      .filter(Boolean)
      .join("\n\n");

    return {
      id,
      segments: unitSegments,
      content,
    };
  });
}

export const ingestSource = inngest.createFunction(
  {
    id: "ingest-source",
    name: "Ingest Source",
    retries: 3,
    concurrency: { limit: 1, key: "event.data.org_id", scope: "env" },
  },
  { event: "source/ingest.requested" },
  async ({ event, step }) => {
    const { org_id, project_id, source_id, job_id } = event.data;
    const supabase = createServiceClient();

    try {
      await step.run("mark-processing", async () => {
        await supabase
          .from("ingest_jobs")
          .update({ status: "processing", started_at: new Date().toISOString() })
          .eq("org_id", org_id)
          .eq("id", job_id);
      });

      const source = await step.run("fetch-source", async () => {
        const { data, error } = await supabase
          .from("sources")
          .select("*")
          .eq("org_id", org_id)
          .eq("project_id", project_id)
          .eq("id", source_id)
          .single();
        if (error) throw new Error(`Source not found: ${error.message}`);
        return data as { type: SourceType; metadata: Record<string, unknown> };
      });

      const [project, themes, problems, otherProjects, internalSpeakers] = await step.run("fetch-context", async () => {
        const [projectResult, themesResult, problemsResult, otherProjectsResult, internalPeopleResult] = await Promise.all([
          supabase
            .from("projects")
            .select("id, name, frame, frame_data")
            .eq("org_id", org_id)
            .eq("id", project_id)
            .single(),
          supabase
            .from("themes")
            .select("label, description")
            .eq("org_id", org_id)
            .eq("project_id", project_id)
            .order("label", { ascending: true }),
          // Known problems — agent checks if evidence supports or contradicts these
          supabase
            .from("problems")
            .select("title")
            .eq("org_id", org_id)
            .eq("project_id", project_id)
            .in("status", ["surfaced", "acknowledged", "active"])
            .limit(20),
          // Other active projects — for adjacent signal detection
          supabase
            .from("projects")
            .select("id, name, frame")
            .eq("org_id", org_id)
            .neq("id", project_id)
            .eq("archived", false)
            .limit(10),
          // Internal speakers — their turns are context, not customer evidence
          supabase
            .from("people")
            .select("name, role")
            .eq("org_id", org_id)
            .eq("affiliation", "internal")
            .order("name", { ascending: true }),
        ]);

        if (projectResult.error || !projectResult.data) {
          throw new Error(
            `Project context not found: ${projectResult.error?.message ?? "missing project"}`
          );
        }

        return [
          projectResult.data as ProjectContext,
          (themesResult.data ?? []) as ThemeContext[],
          (problemsResult.data ?? []) as Array<{ title: string }>,
          (otherProjectsResult.data ?? []) as Array<{ id: string; name: string; frame: string | null }>,
          (internalPeopleResult.data ?? []) as InternalSpeaker[],
        ] as const;
      });

      const rawText = await step.run("extract-text", async () => {
        const text = source.metadata?.raw_text as string | undefined;
        if (!text || text.trim().length < 20) {
          throw new Error("Source has no extractable text");
        }
        if (looksLikeProcessedMarker(text)) {
          throw new Error(PROCESSED_MARKER_ERROR);
        }
        return text;
      });

      const rawSegments = await step.run("segment-text", async () => {
        const segments = segmentText(rawText, source.type);
        if (segments.length === 0) {
          throw new Error("Source produced no segments");
        }
        return segments;
      });

      const inferredInternalSpeakerNames = await step.run("infer-internal-speakers", async () =>
        inferInternalSpeakerNames(rawSegments, source.type)
      );

      const segments = await step.run("store-segments", async () => {
        const records = rawSegments.map((segment) => ({
          org_id,
          source_id,
          segment_index: segment.segment_index,
          speaker: segment.speaker,
          conversation_unit_id: segment.conversation_unit_id,
          char_start: segment.char_start,
          char_end: segment.char_end,
          start_time: segment.start_time,
          end_time: segment.end_time,
          raw_content: segment.content,
          redacted_content: redactPII(segment.content),
          word_count: wordCount(segment.content),
        }));

        const { data, error } = await supabase
          .from("source_segments")
          .insert(records)
          .select("id, segment_index, speaker, redacted_content, conversation_unit_id")
          .order("segment_index", { ascending: true });

        if (error) throw new Error(`Failed to store segments: ${error.message}`);
        return (data ?? []) as StoredSegment[];
      });

      const sourceSpeakers = await step.run("sync-source-speakers", async () =>
        syncSourceSpeakers({
          supabase,
          org_id,
          project_id,
          segments: rawSegments,
          inferredInternalSpeakerNames,
        })
      );
      const sourceInternalSpeakers = mergeInternalSpeakers(internalSpeakers, sourceSpeakers);

      const units = await step.run("build-conversation-units", async () =>
        buildConversationUnits(segments).filter((unit) => unit.content.trim())
      );

      const extractedClaims: Array<ExtractedClaim & { segment_id: string; unit_id: string }> = [];
      const extractionErrors: string[] = [];

      for (let unitIndex = 0; unitIndex < units.length; unitIndex++) {
        const unit = units[unitIndex];
        if (!unit) continue;

        const unitResult = await step.run(
          `extract-evidence-${String(unitIndex + 1).padStart(4, "0")}`,
          async () => {
            const prompt = buildIngestExtractionPrompt({
              content: unit.content,
              frame: formatFrame(project),
              themes: formatThemes(themes),
              problems: problems.length > 0
                ? problems.map((p) => `- ${p.title}`).join("\n")
                : "No problems identified yet.",
              otherProjects: otherProjects.length > 0
                ? otherProjects.map((p) => `- ${p.name}${p.frame ? `: ${p.frame.slice(0, 120)}` : ""}`).join("\n")
                : "No other active projects.",
              internalSpeakers: formatInternalSpeakers(sourceInternalSpeakers),
            });

            const result = await callLLM({
              tier: "standard",
              system:
                "You extract structured customer evidence. Return strict JSON only.",
              messages: [{ role: "user", content: prompt }],
              timeoutMs: 120_000,
            });

            let parsed: unknown;
            try {
              parsed = extractJsonArray(result.content);
            } catch (error) {
              const message =
                error instanceof Error ? error.message : "Unknown JSON parse error";
              console.warn("Skipping malformed ingest extraction response", {
                source_id,
                unit_id: unit.id,
                message,
              });
              return { claims: [], error: `${unit.id}: ${message}` };
            }

            const array = Array.isArray(parsed) ? parsed : [];
            const primarySegmentId = unit.segments[0]?.id;
            if (!primarySegmentId) return { claims: [], error: null };

            const claims: Array<ExtractedClaim & { segment_id: string; unit_id: string }> = [];
            for (const item of array) {
              const claim = normalizeClaim(item);
              if (!claim) continue;
              claims.push({ ...claim, segment_id: primarySegmentId, unit_id: unit.id });
            }

            return { claims, error: null };
          }
        );

        extractedClaims.push(
          ...(unitResult.claims.filter(Boolean) as Array<
            ExtractedClaim & { segment_id: string; unit_id: string }
          >)
        );
        if (unitResult.error) extractionErrors.push(unitResult.error);
      }

      if (extractedClaims.length === 0 && extractionErrors.length > 0) {
        throw new Error(
          `Ingest extraction failed for all conversation units: ${extractionErrors[0]}`
        );
      }

      const claimCap = maxClaimsPerSource();
      const claimsToStore = extractedClaims.slice(0, claimCap);
      if (extractedClaims.length > claimsToStore.length) {
        console.warn("Trimming extracted claims to source cap", {
          source_id,
          extracted_claim_count: extractedClaims.length,
          stored_claim_count: claimsToStore.length,
          cap: claimCap,
        });
      }

      const evidenceRecords = await step.run("embed-and-store", async () => {
        if (claimsToStore.length === 0) return [];

        const batchSize = 20;
        const stored: Array<{ id: string; metadata: Record<string, unknown> | null }> = [];

        for (let i = 0; i < claimsToStore.length; i += batchSize) {
          const batch = claimsToStore.slice(i, i + batchSize);
          const embeddings = await embedBatch(batch.map((claim) => claim.content));

          const evidenceBatch = batch.map((claim, idx) => {
            const adjacentHint = titleFromHint(claim.adjacent_project_hint ?? "");
            const adjacentProject = resolveAdjacentProject(adjacentHint, otherProjects);

            return {
              org_id,
              project_id,
              source_id,
              segment_id: claim.segment_id,
              content: claim.content,
              summary: claim.summary ?? null,
              classification: claim.classification as EvidenceClassification,
              sentiment: claim.sentiment as EvidenceSentiment,
              themes: claim.themes,
              metadata: {
                speaker: claim.speaker ?? null,
                conversation_unit_id: claim.unit_id,
                prompt_version: INGEST_EXTRACTION_PROMPT_VERSION,
                adjacent_project_hint: adjacentHint || null,
                adjacent_project_reason: claim.adjacent_project_reason ?? null,
                adjacent_project_id: adjacentProject?.id ?? null,
                adjacent_project_name: adjacentProject?.name ?? null,
                adjacent_project_status: adjacentHint
                  ? adjacentProject
                    ? "matched_existing"
                    : "suggested_new"
                  : null,
              },
              embedding: `[${embeddings[idx].join(",")}]`,
              trust_scope: "pending" as const,
            };
          });

          const { data, error } = await supabase
            .from("evidence")
            .insert(evidenceBatch)
            .select("id, metadata");

          if (error) throw new Error(`Failed to store evidence: ${error.message}`);
          stored.push(...((data ?? []) as Array<{ id: string; metadata: Record<string, unknown> | null }>));
        }

        return stored;
      });

      await step.run("record-project-opportunities", async () => {
        try {
          type OpportunityEvidenceCandidate = {
            evidence_id: string;
            hint: string;
            reason: string | null;
            matchedProjectId: string | null;
          };

          const candidateEvidence: OpportunityEvidenceCandidate[] = evidenceRecords
            .map((record) => {
              const metadata = record.metadata ?? {};
              const hint = titleFromHint(
                typeof metadata.adjacent_project_hint === "string"
                  ? metadata.adjacent_project_hint
                  : ""
              );
              const reason =
                typeof metadata.adjacent_project_reason === "string"
                  ? metadata.adjacent_project_reason
                  : null;
              const matchedProjectId =
                typeof metadata.adjacent_project_id === "string"
                  ? metadata.adjacent_project_id
                  : null;

              return { evidence_id: record.id, hint, reason, matchedProjectId };
            })
            .filter(
              (record): record is OpportunityEvidenceCandidate =>
                Boolean(record.hint) && !record.matchedProjectId
            );

          if (candidateEvidence.length === 0) return;

          const grouped = new Map<string, OpportunityEvidenceCandidate[]>();
          for (const record of candidateEvidence) {
            const slug = slugify(record.hint);
            if (!slug) continue;
            const records = grouped.get(slug) ?? [];
            records.push(record);
            grouped.set(slug, records);
          }

          for (const [slug, records] of Array.from(grouped.entries())) {
            const firstRecord = records[0];
            if (!firstRecord) continue;

            const title = firstRecord.hint;
            const evidenceCount = records.length;
            const confidence =
              evidenceCount >= 5 ? "high" : evidenceCount >= 2 ? "medium" : "low";
            const description =
              records.find((record) => record.reason)?.reason ??
              `Evidence in ${project.name} is pointing at a distinct discovery area around ${title}.`;
            const suggestedFrame = [
              "Problem",
              `Understand whether ${title} is a distinct problem area worth investigating.`,
              "",
              "Hypothesis",
              `Signals from ${project.name} suggest ${title} may deserve its own discovery workspace.`,
              "",
              "Research Areas",
              `- When and why ${title} appears in real workflows`,
              "- Which roles are affected",
              "- What evidence would confirm this is a separate project",
              "",
              "Success Metrics",
              "- Evidence from multiple sources supports a clear problem statement",
              "- The team can decide whether to create a dedicated solution or keep monitoring",
            ].join("\n");

            const { data: existing } = await supabase
              .from("project_opportunities")
              .select("id, status")
              .eq("org_id", org_id)
              .eq("slug", slug)
              .maybeSingle();

            if (existing?.status === "dismissed" || existing?.status === "accepted") {
              continue;
            }

            let opportunityId = existing?.id as string | undefined;
            if (opportunityId) {
              await supabase
                .from("project_opportunities")
                .update({
                  title,
                  description,
                  suggested_frame: suggestedFrame,
                  confidence,
                })
                .eq("org_id", org_id)
                .eq("id", opportunityId);
            } else {
              const { data, error } = await supabase
                .from("project_opportunities")
                .insert({
                  org_id,
                  title,
                  slug,
                  description,
                  suggested_frame: suggestedFrame,
                  confidence,
                  status: "suggested",
                })
                .select("id")
                .single();

              if (error || !data) {
                throw new Error(`Failed to create project opportunity: ${error?.message}`);
              }
              opportunityId = data.id as string;
            }

            await supabase.from("project_opportunity_projects").upsert(
              {
                org_id,
                opportunity_id: opportunityId,
                project_id,
                relationship: "source",
              },
              { onConflict: "opportunity_id,project_id,relationship" }
            );

            await supabase.from("project_opportunity_evidence").upsert(
              records.map((record) => ({
                org_id,
                opportunity_id: opportunityId,
                evidence_id: record.evidence_id,
              })),
              { onConflict: "opportunity_id,evidence_id" }
            );

            const [{ count: linkedEvidenceCount }, { count: sourceProjectCount }] =
              await Promise.all([
                supabase
                  .from("project_opportunity_evidence")
                  .select("*", { count: "exact", head: true })
                  .eq("org_id", org_id)
                  .eq("opportunity_id", opportunityId),
                supabase
                  .from("project_opportunity_projects")
                  .select("*", { count: "exact", head: true })
                  .eq("org_id", org_id)
                  .eq("opportunity_id", opportunityId)
                  .eq("relationship", "source"),
              ]);

            await supabase
              .from("project_opportunities")
              .update({
                supporting_evidence_count: linkedEvidenceCount ?? records.length,
                source_project_count: sourceProjectCount ?? 1,
              })
              .eq("org_id", org_id)
              .eq("id", opportunityId);
          }
        } catch (error) {
          console.warn("Skipping project opportunity recording", error);
        }
      });

      await step.run("mark-complete", async () => {
        if (evidenceRecords.length === 0) {
          await supabase
            .from("ingest_jobs")
            .update({
              status: "failed",
              error:
                "No evidence was created. Check that this is the original source text, then retry.",
              completed_at: new Date().toISOString(),
              result: {
                segments_created: segments.length,
                evidence_created: 0,
              },
            })
            .eq("org_id", org_id)
            .eq("id", job_id);
          return;
        }

        await supabase
          .from("ingest_jobs")
          .update({
            status: "done",
            completed_at: new Date().toISOString(),
            result: {
              segments_created: segments.length,
              evidence_created: evidenceRecords.length,
            },
          })
          .eq("org_id", org_id)
          .eq("id", job_id);

        await supabase
          .from("sources")
          .update({ trust_scope: "pending" })
          .eq("org_id", org_id)
          .eq("project_id", project_id)
          .eq("id", source_id);
      });

      if (evidenceRecords.length === 0) {
        return {
          source_id,
          segments_created: segments.length,
          evidence_created: 0,
        };
      }

      await step.run("queue-entity-extraction", async () => {
        await inngest.send({
          name: "source/entities.requested",
          data: { org_id, project_id, source_id },
        });
      });

      // Session review fires for every ingest that produced evidence.
      // The review function itself decides whether there's enough to write a useful brief (≥3 records).
      if (evidenceRecords.length > 0) {
        await step.run("queue-session-review", async () => {
          await inngest.send({
            name: "source/review.requested",
            data: { org_id, project_id, source_id },
          });
        });

        // Fire action extraction alongside the session review.
        // Pulls interviewer commitments and participant feature requests from evidence.
        await step.run("queue-action-extraction", async () => {
          await inngest.send({
            name: "source/actions.requested",
            data: { org_id, project_id, source_id },
          });
        });
      }

      // Auto-trigger synthesis when ingest produces enough new evidence (≥5 records)
      // per CLAUDE.md §15: synthesis runs after every ingest batch with 5+ new records
      if (evidenceRecords.length >= 5) {
        await step.run("queue-synthesis", async () => {
          await supabase
            .from("projects")
            .update({ synthesis_stale: true })
            .eq("org_id", org_id)
            .eq("id", project_id);

          await inngest.send({
            name: "project/synthesis.requested",
            data: { org_id, project_id },
          });
        });
      }

      // Fire frame draft if the project has no frame yet.
      // The draft-frame function checks again at run time in case the frame was
      // set between ingest and execution, so firing is always safe.
      if (!project.frame || project.frame.trim().length === 0) {
        await step.run("queue-frame-draft", async () => {
          await inngest.send({
            name: "project/frame.requested",
            data: { org_id, project_id, source_id },
          });
        });
      }

      // Always queue evidence grading — runs even without research context
      // (conservatively marks everything 'uncertain' when context is missing)
      if (evidenceRecords.length > 0) {
        await step.run("queue-evidence-grading", async () => {
          await inngest.send({
            name: "source/evidence.grading.requested",
            data: { org_id, project_id, source_id },
          });
        });
      }

      return {
        source_id,
        segments_created: segments.length,
        evidence_created: evidenceRecords.length,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown ingest error";
      await supabase
        .from("ingest_jobs")
        .update({
          status: "failed",
          error: message,
          completed_at: new Date().toISOString(),
        })
        .eq("org_id", org_id)
        .eq("id", job_id);
      throw error;
    }
  }
);
