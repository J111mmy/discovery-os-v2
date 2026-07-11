import type { ProjectEntityRole } from "@/lib/ingest/entity-resolutions";
import { normalizeSpeakerName } from "@/lib/speakers/resolve";
import type { SourceType } from "@/types/database";

export type SpeakerRoleSuggestion = {
  speaker_id: string | null;
  raw_label: string;
  speaker_name: string;
  suggested_role: "customer";
  reason: string;
};

export type RoleNormalizableSpeaker = {
  id?: string | null;
  raw_label: string;
  display_name?: string | null;
  suggested_name?: string | null;
  resolved_name?: string | null;
  role?: ProjectEntityRole | null;
  suggested_role?: ProjectEntityRole | null;
  project_role?: ProjectEntityRole | null;
};

type NormalizeSpeakerRoleResult<T extends RoleNormalizableSpeaker> = {
  speakers: T[];
  suggestion: SpeakerRoleSuggestion | null;
};

const EXTERNAL_DEFAULT_TYPES = new Set<SourceType>([
  "transcript",
  "customer_interview",
  "sales_call",
  "usability_study",
]);

const PARTICIPANT_HINT_RE =
  /\b(participant|customer|buyer|user|respondent|interviewee|prospect|client)\b/i;
const FACILITATOR_HINT_RE =
  /\b(interviewer|researcher|moderator|facilitator|host|internal|product|sales)\b/i;

export function shouldDefaultUncertainSpeakersExternal(type: SourceType) {
  return EXTERNAL_DEFAULT_TYPES.has(type);
}

function roleOf(speaker: RoleNormalizableSpeaker): ProjectEntityRole | null {
  return speaker.project_role ?? speaker.suggested_role ?? speaker.role ?? null;
}

function speakerName(speaker: RoleNormalizableSpeaker) {
  return (
    speaker.resolved_name?.trim() ||
    speaker.suggested_name?.trim() ||
    speaker.display_name?.trim() ||
    speaker.raw_label.trim()
  );
}

function speakerText(speaker: RoleNormalizableSpeaker) {
  return [speaker.raw_label, speakerName(speaker)].filter(Boolean).join(" ");
}

function isInternalishRole(role: ProjectEntityRole | null) {
  return role === "internal" || role === "interviewer";
}

function scoreLikelyExternalSpeaker(
  speaker: RoleNormalizableSpeaker,
  index: number,
  count: number
) {
  const text = speakerText(speaker);
  let score = 0;

  if (PARTICIPANT_HINT_RE.test(text)) score += 8;
  if (FACILITATOR_HINT_RE.test(text)) score -= 8;
  if (index > 0) score += 2;
  if (count === 2 && index === 1) score += 4;
  if (normalizeSpeakerName(speaker.raw_label).length <= 3) score += 1;

  return score;
}

function patchRole<T extends RoleNormalizableSpeaker>(speaker: T): T {
  if ("project_role" in speaker) {
    return { ...speaker, project_role: "customer" } as T;
  }
  if ("suggested_role" in speaker) {
    return { ...speaker, suggested_role: "customer" } as T;
  }
  return { ...speaker, role: "customer" } as T;
}

export function normalizeAllInternalTranscriptSpeakers<T extends RoleNormalizableSpeaker>(
  speakers: T[],
  sourceType: SourceType
): NormalizeSpeakerRoleResult<T> {
  if (!shouldDefaultUncertainSpeakersExternal(sourceType) || speakers.length < 2) {
    return { speakers, suggestion: null };
  }

  const roles = speakers.map(roleOf);
  if (!roles.every(isInternalishRole)) {
    return { speakers, suggestion: null };
  }

  let bestIndex = 0;
  let bestScore = Number.NEGATIVE_INFINITY;
  speakers.forEach((speaker, index) => {
    const score = scoreLikelyExternalSpeaker(speaker, index, speakers.length);
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  });

  const patched = speakers.map((speaker, index) =>
    index === bestIndex ? patchRole(speaker) : speaker
  );
  const selected = patched[bestIndex];

  return {
    speakers: patched,
    suggestion: selected
      ? {
          speaker_id: selected.id ?? null,
          raw_label: selected.raw_label,
          speaker_name: speakerName(selected),
          suggested_role: "customer",
          reason:
            "Every speaker was marked internal. For interview-style sources, DiscOS keeps one likely participant external so evidence is not silently missed.",
        }
      : null,
  };
}
