// Ingest pipeline — runs as an Inngest background function.
// Deterministic parsing creates source segments; AI extraction creates evidence.

import { z } from "zod";
import { inngest } from "../client";
import { createServiceClient } from "@/lib/supabase/server";
import { callLLM, embedBatch } from "@/lib/llm/client";
import { redactPII } from "@/lib/llm/pii";
import {
  buildIngestExtractionPrompt,
  INGEST_EXTRACTION_PROMPT_VERSION,
} from "@/lib/llm/prompts/ingest";
import type {
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
  name: string;
  frame: string | null;
  frame_data: Record<string, unknown> | null;
};

type ThemeContext = {
  label: string;
  description: string | null;
};

const MAX_TURN_TOKENS = 800;

const ExtractedClaimSchema = z.object({
  content: z.string().trim().min(1),
  summary: z.string().trim().nullable().optional(),
  classification: z.enum(["insight", "verbatim", "data_point", "signal"]),
  sentiment: z.enum(["positive", "negative", "neutral", "mixed"]),
  speaker: z.string().trim().nullable().optional(),
  themes: z.array(z.string().trim().min(1)).optional().default([]),
});

type ExtractedClaim = z.infer<typeof ExtractedClaimSchema>;

function normalizedText(text: string) {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function wordCount(text: string) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function tokenEstimate(text: string) {
  return Math.ceil(wordCount(text) * 1.3);
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

function segmentTranscript(text: string): RawSegment[] {
  const turns = parseTranscriptTurns(text);
  return assignConversationUnits(turns);
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

function segmentText(text: string, type: SourceType): RawSegment[] {
  if (type === "transcript") {
    const transcriptSegments = segmentTranscript(text);
    if (transcriptSegments.length > 0) return transcriptSegments;
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

function extractJsonArray(content: string) {
  const trimmed = content.trim();
  const unfenced = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  const start = unfenced.indexOf("[");
  const end = unfenced.lastIndexOf("]");
  if (start === -1 || end === -1 || end < start) {
    throw new Error("Ingest extraction returned no JSON array");
  }
  return JSON.parse(unfenced.slice(start, end + 1)) as unknown;
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
  { id: "ingest-source", name: "Ingest Source", retries: 3 },
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

      const [project, themes] = await step.run("fetch-context", async () => {
        const [projectResult, themesResult] = await Promise.all([
          supabase
            .from("projects")
            .select("name, frame, frame_data")
            .eq("org_id", org_id)
            .eq("id", project_id)
            .single(),
          supabase
            .from("themes")
            .select("label, description")
            .eq("org_id", org_id)
            .eq("project_id", project_id)
            .order("label", { ascending: true }),
        ]);

        if (projectResult.error || !projectResult.data) {
          throw new Error(
            `Project context not found: ${projectResult.error?.message ?? "missing project"}`
          );
        }

        return [
          projectResult.data as ProjectContext,
          (themesResult.data ?? []) as ThemeContext[],
        ] as const;
      });

      const rawText = await step.run("extract-text", async () => {
        const text = source.metadata?.raw_text as string | undefined;
        if (!text || text.trim().length < 20) {
          throw new Error("Source has no extractable text");
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

      const extractedClaims = await step.run("extract-evidence", async () => {
        const units = buildConversationUnits(segments);
        const claims: Array<ExtractedClaim & { segment_id: string; unit_id: string }> = [];

        for (const unit of units) {
          if (!unit.content.trim()) continue;

          const prompt = buildIngestExtractionPrompt({
            content: unit.content,
            frame: formatFrame(project),
            themes: formatThemes(themes),
          });

          const result = await callLLM({
            tier: "standard",
            system:
              "You extract structured customer evidence. Return strict JSON only.",
            messages: [{ role: "user", content: prompt }],
            timeoutMs: 120_000,
          });

          const parsed = extractJsonArray(result.content);
          const array = Array.isArray(parsed) ? parsed : [];
          const primarySegmentId = unit.segments[0]?.id;
          if (!primarySegmentId) continue;

          for (const item of array) {
            const claim = normalizeClaim(item);
            if (!claim) continue;
            claims.push({
              ...claim,
              segment_id: primarySegmentId,
              unit_id: unit.id,
            });
          }
        }

        return claims;
      });

      const evidenceRecords = await step.run("embed-and-store", async () => {
        if (extractedClaims.length === 0) return [];

        const batchSize = 20;
        const stored: Array<{ id: string }> = [];

        for (let i = 0; i < extractedClaims.length; i += batchSize) {
          const batch = extractedClaims.slice(i, i + batchSize);
          const embeddings = await embedBatch(batch.map((claim) => claim.content));

          const evidenceBatch = batch.map((claim, idx) => ({
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
            },
            embedding: `[${embeddings[idx].join(",")}]`,
            trust_scope: "pending" as const,
          }));

          const { data, error } = await supabase
            .from("evidence")
            .insert(evidenceBatch)
            .select("id");

          if (error) throw new Error(`Failed to store evidence: ${error.message}`);
          stored.push(...((data ?? []) as Array<{ id: string }>));
        }

        return stored;
      });

      await step.run("mark-complete", async () => {
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
