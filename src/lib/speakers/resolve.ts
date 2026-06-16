import type { Affiliation, EvidenceRecord } from "@/types/database";

type SupabaseLike = {
  from: (table: string) => any;
};

type SpeakerCandidateSource = "person" | "source_segment" | "inferred";

export type SpeakerCandidate = {
  label: string;
  normalized: string;
  aliases: string[];
  source: SpeakerCandidateSource;
  person_id: string | null;
  affiliation: Affiliation | null;
};

export type SpeakerTarget = {
  label: string;
  normalized: string;
  aliases: string[];
  matched_alias: string;
  person_id: string | null;
  affiliation: Affiliation | null;
};

export type SpeakerResolution = {
  targeted: boolean;
  targets: SpeakerTarget[];
  reason: "named_speaker" | "no_named_speaker";
};

const SPEAKER_VERB_RE =
  /\b(say|said|says|mention|mentioned|mentions|ask|asked|asks|tell|told|tells|want|wanted|wants|requirement|requirements|feedback|think|thought|thinks|feel|felt|feels)\b/i;

const STOP_ALIASES = new Set([
  "all",
  "and",
  "any",
  "are",
  "ask",
  "can",
  "did",
  "for",
  "from",
  "had",
  "has",
  "his",
  "her",
  "how",
  "our",
  "say",
  "the",
  "they",
  "this",
  "was",
  "what",
  "when",
  "who",
  "why",
  "you",
]);

export function normalizeSpeakerName(value: string | null | undefined) {
  return (value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/['’`]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function unique(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function isUsefulAlias(alias: string) {
  return alias.length >= 3 && !STOP_ALIASES.has(alias);
}

function buildAliases(label: string) {
  const normalized = normalizeSpeakerName(label);
  if (!normalized) return [];

  const tokens = normalized.split(" ").filter(Boolean);
  const aliases = [normalized];

  const first = tokens[0];
  if (first && isUsefulAlias(first)) aliases.push(first);

  const last = tokens.length > 1 ? tokens[tokens.length - 1] : null;
  if (last && isUsefulAlias(last)) aliases.push(last);

  return unique(aliases);
}

function containsAlias(questionNormalized: string, alias: string) {
  if (!alias || !isUsefulAlias(alias)) return false;
  return new RegExp(`(^|\\s)${escapeRegExp(alias)}($|\\s)`).test(questionNormalized);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function candidateFromLabel(
  label: string,
  source: SpeakerCandidateSource,
  overrides: Partial<Pick<SpeakerCandidate, "person_id" | "affiliation">> = {}
): SpeakerCandidate | null {
  const normalized = normalizeSpeakerName(label);
  if (!normalized) return null;

  return {
    label,
    normalized,
    aliases: buildAliases(label),
    source,
    person_id: overrides.person_id ?? null,
    affiliation: overrides.affiliation ?? null,
  };
}

function mergeCandidate(
  byNormalized: Map<string, SpeakerCandidate>,
  candidate: SpeakerCandidate | null
) {
  if (!candidate) return;

  const existing = byNormalized.get(candidate.normalized);
  if (!existing) {
    byNormalized.set(candidate.normalized, candidate);
    return;
  }

  byNormalized.set(candidate.normalized, {
    ...existing,
    aliases: unique([...existing.aliases, ...candidate.aliases]),
    person_id: existing.person_id ?? candidate.person_id,
    affiliation: existing.affiliation ?? candidate.affiliation,
    source: existing.source === "person" ? existing.source : candidate.source,
  });
}

function inferSpeakerLabelFromQuestion(question: string) {
  const patterns = [
    /\bwhat\s+did\s+([A-Z][A-Za-z.'-]*(?:\s+[A-Z][A-Za-z.'-]*){0,3})\s+(?:say|mention|ask|want|tell|think|feel)\b/i,
    /\b(?:things|stuff|points|requirements|feedback|comments|quotes|evidence)\s+([A-Z][A-Za-z.'-]*(?:\s+[A-Z][A-Za-z.'-]*){0,3})\s+(?:said|mentioned|asked|wanted|told|thought|felt|needed|required)\b/i,
    /\b([A-Z][A-Za-z.'-]*(?:\s+[A-Z][A-Za-z.'-]*){0,3})'?s\s+(?:requirements|feedback|comments|points|needs|quotes)\b/i,
  ];

  for (const pattern of patterns) {
    const match = question.match(pattern);
    const label = match?.[1]?.trim();
    if (!label) continue;
    const normalized = normalizeSpeakerName(label);
    if (normalized && !STOP_ALIASES.has(normalized)) return label;
  }

  return null;
}

export async function loadSpeakerCandidates(input: {
  supabase: SupabaseLike;
  org_id: string;
  project_id: string;
}): Promise<SpeakerCandidate[]> {
  const byNormalized = new Map<string, SpeakerCandidate>();

  const [peopleResult, sourcesResult] = await Promise.all([
    input.supabase
      .from("people")
      .select("id, name, affiliation")
      .eq("org_id", input.org_id)
      .order("name", { ascending: true }),
    input.supabase
      .from("sources")
      .select("id")
      .eq("org_id", input.org_id)
      .eq("project_id", input.project_id),
  ]);

  if (peopleResult.error) {
    throw new Error(`Failed to load speaker people: ${peopleResult.error.message}`);
  }
  if (sourcesResult.error) {
    throw new Error(`Failed to load project sources for speaker resolution: ${sourcesResult.error.message}`);
  }

  for (const person of (peopleResult.data ?? []) as Array<{
    id: string;
    name: string;
    affiliation: Affiliation | null;
  }>) {
    mergeCandidate(
      byNormalized,
      candidateFromLabel(person.name, "person", {
        person_id: person.id,
        affiliation: person.affiliation ?? null,
      })
    );
  }

  const sourceIds = ((sourcesResult.data ?? []) as Array<{ id: string }>).map(
    (source) => source.id
  );

  if (sourceIds.length > 0) {
    const { data: segments, error } = await input.supabase
      .from("source_segments")
      .select("speaker")
      .eq("org_id", input.org_id)
      .in("source_id", sourceIds)
      .not("speaker", "is", null);

    if (error) {
      throw new Error(`Failed to load source speakers: ${error.message}`);
    }

    for (const segment of (segments ?? []) as Array<{ speaker: string | null }>) {
      if (!segment.speaker) continue;
      mergeCandidate(byNormalized, candidateFromLabel(segment.speaker, "source_segment"));
    }
  }

  return Array.from(byNormalized.values());
}

export function resolveSpeakerTargetsFromQuestion(input: {
  question: string;
  candidates: SpeakerCandidate[];
}): SpeakerResolution {
  const questionNormalized = normalizeSpeakerName(input.question);
  if (!questionNormalized || !SPEAKER_VERB_RE.test(input.question)) {
    return { targeted: false, targets: [], reason: "no_named_speaker" };
  }

  const matched: Array<{ candidate: SpeakerCandidate; alias: string; score: number }> = [];

  for (const candidate of input.candidates) {
    for (const alias of candidate.aliases) {
      if (!containsAlias(questionNormalized, alias)) continue;
      matched.push({
        candidate,
        alias,
        score: alias === candidate.normalized ? 3 : alias.includes(" ") ? 2 : 1,
      });
      break;
    }
  }

  if (matched.length === 0) {
    const inferredLabel = inferSpeakerLabelFromQuestion(input.question);
    const inferred = candidateFromLabel(inferredLabel ?? "", "inferred");
    if (inferred) {
      return {
        targeted: true,
        targets: [
          {
            label: inferred.label,
            normalized: inferred.normalized,
            aliases: inferred.aliases,
            matched_alias: inferred.normalized,
            person_id: null,
            affiliation: null,
          },
        ],
        reason: "named_speaker",
      };
    }

    return { targeted: false, targets: [], reason: "no_named_speaker" };
  }

  const maxScore = Math.max(...matched.map((match) => match.score));
  const best = matched.filter((match) => match.score === maxScore);
  const seen = new Set<string>();

  const targets = best
    .filter((match) => {
      if (seen.has(match.candidate.normalized)) return false;
      seen.add(match.candidate.normalized);
      return true;
    })
    .map((match) => ({
      label: match.candidate.label,
      normalized: match.candidate.normalized,
      aliases: match.candidate.aliases,
      matched_alias: match.alias,
      person_id: match.candidate.person_id,
      affiliation: match.candidate.affiliation,
    }));

  return { targeted: targets.length > 0, targets, reason: "named_speaker" };
}

export async function resolveSpeakerTargetsForQuestion(input: {
  supabase: SupabaseLike;
  org_id: string;
  project_id: string;
  question: string;
}) {
  const candidates = await loadSpeakerCandidates(input);
  return resolveSpeakerTargetsFromQuestion({
    question: input.question,
    candidates,
  });
}

function labelMatchesTarget(label: string | null | undefined, target: SpeakerTarget) {
  const normalized = normalizeSpeakerName(label);
  if (!normalized) return false;
  return target.aliases.some(
    (alias) =>
      normalized === alias ||
      target.normalized === normalized ||
      containsAlias(normalized, alias)
  );
}

export function speakerMatchesTargets(
  label: string | null | undefined,
  resolution: SpeakerResolution | null | undefined
) {
  if (!resolution?.targeted) return false;
  return resolution.targets.some((target) => labelMatchesTarget(label, target));
}

export function recordMatchesSpeakerTargets(
  record: EvidenceRecord,
  resolution: SpeakerResolution | null | undefined
) {
  if (!resolution?.targeted) return false;
  const metadataSpeaker =
    typeof record.metadata?.speaker === "string" ? record.metadata.speaker : null;

  return (
    speakerMatchesTargets(record.segment_speaker, resolution) ||
    speakerMatchesTargets(metadataSpeaker, resolution)
  );
}

export function speakerResolutionLabel(resolution: SpeakerResolution | null | undefined) {
  if (!resolution?.targeted) return null;
  return resolution.targets.map((target) => target.label).join(", ");
}
