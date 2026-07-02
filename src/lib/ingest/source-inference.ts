import type { SourceType } from "@/types/database";
import { parseTranscriptTurns } from "@/lib/ingest/transcript-turns";
import { normalizeSpeakerName } from "@/lib/speakers/resolve";

export type InferredSourceStructure = "conversation" | "document";
export type SourceInferenceConfidence = "high" | "medium" | "low";

export type SourceInference = {
  type: SourceType;
  structure: InferredSourceStructure;
  confidence: SourceInferenceConfidence;
  reason: string;
  turn_count: number;
  speaker_count: number;
};

function uniqueSpeakerCount(speakers: string[]) {
  return new Set(
    speakers
      .map((speaker) => normalizeSpeakerName(speaker))
      .filter(Boolean)
  ).size;
}

function looksLikeSurvey(text: string) {
  const lower = text.toLowerCase();
  const surveyMarkers = [
    "survey response",
    "question:",
    "respondent",
    "rating:",
    "nps",
    "multiple choice",
  ];
  return surveyMarkers.some((marker) => lower.includes(marker));
}

function looksLikeSupportTicket(text: string) {
  const lower = text.toLowerCase();
  const ticketMarkers = [
    "ticket",
    "case id",
    "priority:",
    "status:",
    "customer support",
    "support request",
  ];
  return ticketMarkers.some((marker) => lower.includes(marker));
}

function looksLikeNote(text: string) {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length < 3) return false;
  const bulletLines = lines.filter((line) => /^[-*•]\s+/.test(line)).length;
  const headingLines = lines.filter((line) => /^(notes?|summary|actions?|decisions?)\b/i.test(line)).length;
  return bulletLines >= 3 || headingLines >= 1;
}

export function inferSourceType(rawText: string): SourceInference {
  const text = rawText.trim();
  const turns = parseTranscriptTurns(text);
  const speakerCount = uniqueSpeakerCount(turns.map((turn) => turn.speaker));

  if (turns.length >= 4 && speakerCount >= 2) {
    return {
      type: "transcript",
      structure: "conversation",
      confidence: "high",
      reason: "Detected multiple speaker turns.",
      turn_count: turns.length,
      speaker_count: speakerCount,
    };
  }

  if (turns.length >= 2 && speakerCount >= 2) {
    return {
      type: "transcript",
      structure: "conversation",
      confidence: "medium",
      reason: "Detected a short speaker-turn pattern.",
      turn_count: turns.length,
      speaker_count: speakerCount,
    };
  }

  if (looksLikeSurvey(text)) {
    return {
      type: "survey",
      structure: "document",
      confidence: "medium",
      reason: "Detected survey-style labels.",
      turn_count: turns.length,
      speaker_count: speakerCount,
    };
  }

  if (looksLikeSupportTicket(text)) {
    return {
      type: "support_ticket",
      structure: "document",
      confidence: "medium",
      reason: "Detected support-ticket style labels.",
      turn_count: turns.length,
      speaker_count: speakerCount,
    };
  }

  if (looksLikeNote(text)) {
    return {
      type: "note",
      structure: "document",
      confidence: "medium",
      reason: "Detected note-style structure.",
      turn_count: turns.length,
      speaker_count: speakerCount,
    };
  }

  return {
    type: "document",
    structure: "document",
    confidence: "low",
    reason: "No strong speaker-turn pattern detected.",
    turn_count: turns.length,
    speaker_count: speakerCount,
  };
}
