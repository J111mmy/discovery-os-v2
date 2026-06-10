import fs from "node:fs";
import { matchEvidenceToSegment } from "./anchor.mjs";

const PAGE_SIZE = 500;

function loadLocalEnv() {
  if (!fs.existsSync(".env.local")) return;

  for (const line of fs.readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const match = line.match(/^([^#=\s]+)=(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[match[1]] = value;
  }
}

function parseArgs(argv) {
  const args = new Set(argv);
  const getValue = (name) => {
    const index = argv.indexOf(name);
    return index >= 0 ? argv[index + 1] : undefined;
  };

  return {
    apply: args.has("--apply"),
    help: args.has("--help") || args.has("-h"),
    projectId: getValue("--project-id"),
    sourceId: getValue("--source-id"),
    limit: Number(getValue("--limit") ?? 0) || null,
  };
}

function usage() {
  console.log(`
Usage:
  npm run backfill:evidence-anchors
  npm run backfill:evidence-anchors -- --apply
  npm run backfill:evidence-anchors -- --project-id <uuid> --limit 100

Dry-run is the default. --apply performs targeted evidence.segment_id/metadata updates.
`);
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function metadataObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function candidateSegmentsFor(row, sourceSegments) {
  const current = sourceSegments.find((segment) => segment.id === row.segment_id);
  const unitId = current?.conversation_unit_id;
  if (!unitId) return sourceSegments;

  const unitSegments = sourceSegments.filter((segment) => segment.conversation_unit_id === unitId);
  return unitSegments.length > 0 ? unitSegments : sourceSegments;
}

function buildNextMetadata(row, match) {
  const metadata = metadataObject(row.metadata);

  return {
    ...metadata,
    original_segment_id: metadata.original_segment_id ?? row.segment_id ?? match.segment_id,
    anchor_method: match.anchor_method,
    anchor_char_start: match.anchor_char_start,
    anchor_char_end: match.anchor_char_end,
    anchor_score: match.anchor_score,
  };
}

function needsUpdate(row, match, nextMetadata) {
  const metadata = metadataObject(row.metadata);

  return (
    row.segment_id !== match.segment_id ||
    metadata.original_segment_id == null ||
    metadata.anchor_method !== match.anchor_method ||
    metadata.anchor_char_start !== nextMetadata.anchor_char_start ||
    metadata.anchor_char_end !== nextMetadata.anchor_char_end ||
    metadata.anchor_score !== nextMetadata.anchor_score
  );
}

function speakersMatch(a, b) {
  const normalize = (value) =>
    String(value ?? "")
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  const left = normalize(a);
  const right = normalize(b);
  if (!left || !right) return false;
  if (left === right) return true;
  return left.length > 2 && right.length > 2 && (left.includes(right) || right.includes(left));
}

function histogramBucket(score) {
  if (score == null) return "null";
  if (score === 0) return "0";
  if (score < 0.1) return "(0,0.1)";
  if (score < 0.2) return "[0.1,0.2)";
  if (score < 0.33) return "[0.2,0.33)";
  if (score < 0.5) return "[0.33,0.5)";
  if (score < 0.66) return "[0.5,0.66)";
  return "[0.66,1]";
}

async function fetchEvidenceRows(service, options) {
  const rows = [];
  let offset = 0;

  while (!options.limit || rows.length < options.limit) {
    const remaining = options.limit ? options.limit - rows.length : PAGE_SIZE;
    const pageSize = Math.min(PAGE_SIZE, remaining);
    let query = service
      .from("evidence")
      .select("id, org_id, project_id, source_id, segment_id, content, metadata, created_at")
      .order("created_at", { ascending: true })
      .range(offset, offset + pageSize - 1);

    if (options.projectId) query = query.eq("project_id", options.projectId);
    if (options.sourceId) query = query.eq("source_id", options.sourceId);

    const { data, error } = await query;
    if (error) throw new Error(`Failed to fetch evidence: ${error.message}`);

    const page = data ?? [];
    rows.push(...page);
    if (page.length < pageSize) break;
    offset += pageSize;
  }

  return rows;
}

function chunk(values, size) {
  const chunks = [];
  for (let i = 0; i < values.length; i += size) {
    chunks.push(values.slice(i, i + size));
  }
  return chunks;
}

async function fetchSegmentsBySource(service, sourceIds) {
  const bySource = new Map();

  for (const sourceIdChunk of chunk(sourceIds, 100)) {
    const { data, error } = await service
      .from("source_segments")
      .select("id, source_id, segment_index, speaker, redacted_content, conversation_unit_id")
      .in("source_id", sourceIdChunk)
      .order("segment_index", { ascending: true });

    if (error) throw new Error(`Failed to fetch source segments: ${error.message}`);

    for (const segment of data ?? []) {
      const list = bySource.get(segment.source_id) ?? [];
      list.push(segment);
      bySource.set(segment.source_id, list);
    }
  }

  return bySource;
}

async function applyUpdate(service, row, match, nextMetadata) {
  let query = service
    .from("evidence")
    .update({
      segment_id: match.segment_id,
      metadata: nextMetadata,
    })
    .eq("org_id", row.org_id)
    .eq("id", row.id);

  query = row.segment_id ? query.eq("segment_id", row.segment_id) : query.is("segment_id", null);

  const { error } = await query;
  if (error) throw new Error(error.message);
}

loadLocalEnv();
const options = parseArgs(process.argv.slice(2));

if (options.help) {
  usage();
  process.exit(0);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) fail("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");

const { createClient } = await import("@supabase/supabase-js");
const service = createClient(url, serviceKey, { auth: { persistSession: false } });
const evidenceRows = await fetchEvidenceRows(service, options);
const sourceIds = Array.from(new Set(evidenceRows.map((row) => row.source_id).filter(Boolean)));
const segmentsBySource = await fetchSegmentsBySource(service, sourceIds);

const report = {
  mode: options.apply ? "apply" : "dry-run",
  scanned: evidenceRows.length,
  planned_updates: 0,
  applied_updates: 0,
  segment_changes: 0,
  metadata_only_updates: 0,
  unchanged: 0,
  method_counts: {
    exact: 0,
    normalised: 0,
    fuzzy: 0,
    speaker: 0,
    fallback_first_segment: 0,
  },
  speaker_score_histogram: {
    "0": 0,
    "(0,0.1)": 0,
    "[0.1,0.2)": 0,
    "[0.2,0.33)": 0,
    "[0.33,0.5)": 0,
    "[0.5,0.66)": 0,
    "[0.66,1]": 0,
    null: 0,
  },
  mechanical_gates: {
    opening_speaker_non_fallback_count: 0,
    fallback_on_opening_speaker_count: 0,
    fallback_on_opening_speaker_with_alternative_count: 0,
    fallback_on_opening_speaker_without_alternative_count: 0,
  },
  failed_ids: [],
};

for (const row of evidenceRows) {
  try {
    const sourceSegments = segmentsBySource.get(row.source_id) ?? [];
    if (sourceSegments.length === 0) {
      report.failed_ids.push({ id: row.id, reason: "no_source_segments" });
      continue;
    }

    const metadata = metadataObject(row.metadata);
    const candidates = candidateSegmentsFor(row, sourceSegments);
    const match = matchEvidenceToSegment({
      content: row.content,
      speaker: metadata.speaker ?? null,
      segments: candidates,
    });

    if (!match) {
      report.failed_ids.push({ id: row.id, reason: "no_anchor_match" });
      continue;
    }

    report.method_counts[match.anchor_method] += 1;
    if (match.anchor_method === "speaker") {
      report.speaker_score_histogram[histogramBucket(match.anchor_score)] += 1;
    }

    const openingSpeaker = candidates[0]?.speaker ?? null;
    const matchedSegment = sourceSegments.find((segment) => segment.id === match.segment_id);
    if (
      match.anchor_method !== "fallback_first_segment" &&
      matchedSegment &&
      speakersMatch(openingSpeaker, matchedSegment.speaker)
    ) {
      report.mechanical_gates.opening_speaker_non_fallback_count += 1;
    }
    const hasNonOpeningCandidate = candidates.some(
      (segment) => !speakersMatch(openingSpeaker, segment.speaker)
    );
    if (
      match.anchor_method === "fallback_first_segment" &&
      matchedSegment &&
      speakersMatch(openingSpeaker, matchedSegment.speaker)
    ) {
      report.mechanical_gates.fallback_on_opening_speaker_count += 1;
      if (hasNonOpeningCandidate) {
        report.mechanical_gates.fallback_on_opening_speaker_with_alternative_count += 1;
      } else {
        report.mechanical_gates.fallback_on_opening_speaker_without_alternative_count += 1;
      }
    }

    const nextMetadata = buildNextMetadata(row, match);

    if (!needsUpdate(row, match, nextMetadata)) {
      report.unchanged += 1;
      continue;
    }

    report.planned_updates += 1;
    if (row.segment_id !== match.segment_id) {
      report.segment_changes += 1;
    } else {
      report.metadata_only_updates += 1;
    }

    if (options.apply) {
      await applyUpdate(service, row, match, nextMetadata);
      report.applied_updates += 1;
    }
  } catch (error) {
    report.failed_ids.push({
      id: row.id,
      reason: error instanceof Error ? error.message : "unknown_error",
    });
  }
}

console.log(JSON.stringify(report, null, 2));
if (!options.apply) {
  console.log("Dry run only. Re-run with --apply after Opus review and Jimmy approval.");
}
