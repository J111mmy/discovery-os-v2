export type EvidenceAnchorMethod =
  | "exact"
  | "normalised"
  | "fuzzy"
  | "speaker"
  | "fallback_first_segment";

export type EvidenceAnchorSegment = {
  id: string;
  speaker?: string | null;
  redacted_content?: string | null;
};

export type EvidenceAnchorMatch = {
  segment_id: string;
  anchor_method: EvidenceAnchorMethod;
  anchor_char_start: number | null;
  anchor_char_end: number | null;
  anchor_score: number | null;
};

export function matchEvidenceToSegment(input: {
  content: string;
  speaker?: string | null;
  segments: EvidenceAnchorSegment[];
}): EvidenceAnchorMatch | null;
