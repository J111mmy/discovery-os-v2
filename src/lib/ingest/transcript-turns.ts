export type TranscriptTurn = {
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

function normalizedText(text: string) {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function normalizeLabel(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
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
    /^[A-Z][A-Za-z0-9 .'-]+$/.test(trimmed)
  );
}

function isSpeakerLabel(value: string) {
  return isSpeakerNameLine(value);
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

const inlineTimestampSpeakerBoundary =
  /\[?\d{1,2}:\d{2}(?::\d{2})?\]?\s+([A-Za-z][A-Za-z0-9 .'-]{1,80}):\s*/g;

function isInlineSpeakerBoundaryLabel(value: string) {
  const normalized = normalizeLabel(value);
  return normalized !== "am" && normalized !== "pm";
}

function buildTextLine(raw: string, start: number): TextLine | null {
  if (raw.length === 0) return null;

  const end = start + raw.length;
  const leading = raw.match(/^\s*/)?.[0].length ?? 0;
  const trailing = raw.match(/\s*$/)?.[0].length ?? 0;
  const trimmedStart = start + leading;
  const trimmedEnd = Math.max(trimmedStart, end - trailing);

  return {
    raw,
    trimmed: raw.trim(),
    start,
    end,
    trimmedStart,
    trimmedEnd,
  };
}

function splitInlineTimestampSpeakerLines(lines: TextLine[]) {
  const splitLines: TextLine[] = [];

  for (const line of lines) {
    const boundaries = Array.from(line.raw.matchAll(inlineTimestampSpeakerBoundary))
      .filter((match) => isInlineSpeakerBoundaryLabel(match[1] ?? ""))
      .map((match) => match.index ?? 0)
      .filter((index, position, all) => index >= 0 && all.indexOf(index) === position)
      .sort((a, b) => a - b);

    if (boundaries.length === 0) {
      splitLines.push(line);
      continue;
    }

    let cursor = 0;
    for (const boundary of boundaries) {
      if (boundary > cursor) {
        const before = buildTextLine(line.raw.slice(cursor, boundary), line.start + cursor);
        if (before) splitLines.push(before);
      }
      cursor = boundary;
    }

    const last = buildTextLine(line.raw.slice(cursor), line.start + cursor);
    if (last) splitLines.push(last);
  }

  return splitLines;
}

export function parseTranscriptTurns(text: string): TranscriptTurn[] {
  const lines = splitInlineTimestampSpeakerLines(getLines(text));
  const speakerColonLine =
    /^(?:\[?(\d{1,2}:\d{2}(?::\d{2})?)\]?\s+)?([A-Za-z][^:\n]{0,80}):\s*(.*)$/;
  const timestampSpeakerLine =
    /^\[?(\d{1,2}:\d{2}(?::\d{2})?)\]?\s+([A-Za-z][A-Za-z0-9 .'-]{1,80})(?::)?\s*(.*)$/;
  const speakerTimestampLine =
    /^([A-Za-z][A-Za-z0-9 .'-]{1,80})\s+\[?(\d{1,2}:\d{2}(?::\d{2})?)\]?\s*(.*)$/;

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
    if (speakerColonMatch?.[2] && isSpeakerLabel(speakerColonMatch[2])) {
      startTurn(
        speakerColonMatch[2],
        speakerColonMatch[1] ?? null,
        speakerColonMatch[3] ?? "",
        line
      );
      continue;
    }

    const timestampSpeakerMatch = line.trimmed.match(timestampSpeakerLine);
    if (timestampSpeakerMatch?.[2] && isSpeakerLabel(timestampSpeakerMatch[2])) {
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
