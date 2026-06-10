const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "but",
  "by",
  "for",
  "from",
  "have",
  "i",
  "if",
  "in",
  "is",
  "it",
  "of",
  "on",
  "or",
  "our",
  "that",
  "the",
  "their",
  "they",
  "this",
  "to",
  "we",
  "with",
  "you",
]);

function normalizeSpeaker(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function speakersMatch(claimSpeaker, segmentSpeaker) {
  const claim = normalizeSpeaker(claimSpeaker);
  const segment = normalizeSpeaker(segmentSpeaker);
  if (!claim || !segment) return false;
  if (claim === segment) return true;
  return claim.length > 2 && segment.length > 2 && (claim.includes(segment) || segment.includes(claim));
}

function normalizeWithMap(text) {
  const chars = [];
  const map = [];
  let lastWasSpace = true;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (/[a-z0-9]/i.test(char)) {
      chars.push(char.toLowerCase());
      map.push(i);
      lastWasSpace = false;
      continue;
    }

    if (!lastWasSpace) {
      chars.push(" ");
      map.push(i);
      lastWasSpace = true;
    }
  }

  if (chars[chars.length - 1] === " ") {
    chars.pop();
    map.pop();
  }

  return { text: chars.join(""), map };
}

function tokenizeForFuzzy(text) {
  const tokens = [];
  const pattern = /[a-z0-9]+/gi;
  let match;

  while ((match = pattern.exec(text))) {
    const token = match[0].toLowerCase();
    if (token.length <= 2 || STOP_WORDS.has(token)) continue;
    tokens.push(token);
  }

  return tokens;
}

function uniqueTokens(text) {
  return new Set(tokenizeForFuzzy(text));
}

function fuzzyScore(claimContent, segmentContent) {
  const claimTokens = uniqueTokens(claimContent);
  if (claimTokens.size < 4) return 0;

  const segmentTokens = uniqueTokens(segmentContent);
  if (segmentTokens.size === 0) return 0;

  let overlap = 0;
  for (const token of claimTokens) {
    if (segmentTokens.has(token)) overlap++;
  }

  return overlap / claimTokens.size;
}

function isOpeningSpeakerSegment(segment, openingSpeaker) {
  return Boolean(openingSpeaker) && speakersMatch(openingSpeaker, segment.speaker);
}

function matchExact(claimContent, segment) {
  const body = segment.redacted_content ?? "";
  const index = body.indexOf(claimContent);
  if (index === -1) return null;

  return {
    segment_id: segment.id,
    anchor_method: "exact",
    anchor_char_start: index,
    anchor_char_end: index + claimContent.length,
    anchor_score: 1,
  };
}

function matchNormalised(claimContent, segment) {
  const body = segment.redacted_content ?? "";
  const claim = normalizeWithMap(claimContent);
  const segmentText = normalizeWithMap(body);
  if (!claim.text) return null;

  const index = segmentText.text.indexOf(claim.text);
  if (index === -1) return null;

  const start = segmentText.map[index] ?? null;
  const endIndex = index + claim.text.length - 1;
  const end = segmentText.map[endIndex] != null ? segmentText.map[endIndex] + 1 : null;

  return {
    segment_id: segment.id,
    anchor_method: "normalised",
    anchor_char_start: start,
    anchor_char_end: end,
    anchor_score: 1,
  };
}

function matchFuzzy(claimContent, segments, openingSpeaker) {
  let best = null;

  for (const segment of segments) {
    if (isOpeningSpeakerSegment(segment, openingSpeaker)) continue;
    const score = fuzzyScore(claimContent, segment.redacted_content ?? "");
    if (!best || score > best.score) {
      best = { segment, score };
    }
  }

  if (!best || best.score < 0.66) return null;

  return {
    segment_id: best.segment.id,
    anchor_method: "fuzzy",
    anchor_char_start: null,
    anchor_char_end: null,
    anchor_score: best.score,
  };
}

/**
 * @param {{ content: string, speaker?: string | null, segments: Array<{ id: string, speaker?: string | null, redacted_content?: string | null }> }} input
 */
export function matchEvidenceToSegment(input) {
  const content = String(input.content ?? "").trim();
  const segments = (input.segments ?? []).filter((segment) => segment?.id);
  if (!content || segments.length === 0) return null;
  const openingSpeaker = segments[0]?.speaker ?? null;

  for (const segment of segments) {
    if (isOpeningSpeakerSegment(segment, openingSpeaker)) continue;
    const exact = matchExact(content, segment);
    if (exact) return exact;
  }

  for (const segment of segments) {
    if (isOpeningSpeakerSegment(segment, openingSpeaker)) continue;
    const normalised = matchNormalised(content, segment);
    if (normalised) return normalised;
  }

  const fuzzy = matchFuzzy(content, segments, openingSpeaker);
  if (fuzzy) return fuzzy;

  const fallback = segments.find((segment) => !isOpeningSpeakerSegment(segment, openingSpeaker)) ?? segments[0];
  return {
    segment_id: fallback.id,
    anchor_method: "fallback_first_segment",
    anchor_char_start: null,
    anchor_char_end: null,
    anchor_score: null,
  };
}
