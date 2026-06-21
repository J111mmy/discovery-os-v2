type InternalPersonRow = {
  id: string;
  name: string | null;
};

type InternalEvidenceSupabase = {
  from: (table: string) => any;
};

export type InternalEvidenceGuardContext = {
  internalPersonIds: Set<string>;
  internalSpeakerNames: Set<string>;
};

type EvidenceLike = {
  metadata?: unknown;
  source_type?: string | null;
  segment_speaker?: string | null;
};

function metadataObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function metadataString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeSpeakerName(value: string | null | undefined) {
  return value?.replace(/\s+/g, " ").trim().toLowerCase() ?? "";
}

export async function loadInternalEvidenceGuardContext(input: {
  supabase: InternalEvidenceSupabase;
  org_id: string;
}): Promise<InternalEvidenceGuardContext> {
  const { data, error } = await input.supabase
    .from("people")
    .select("id, name")
    .eq("org_id", input.org_id)
    .eq("affiliation", "internal");

  if (error) throw new Error(`Failed to load internal people: ${error.message}`);

  const rows = (data ?? []) as InternalPersonRow[];
  return {
    internalPersonIds: new Set(rows.map((row) => row.id).filter(Boolean)),
    internalSpeakerNames: new Set(
      rows
        .map((row) => normalizeSpeakerName(row.name))
        .filter((name) => name.length > 0)
    ),
  };
}

export function isInternalEvidence(
  record: EvidenceLike,
  context: InternalEvidenceGuardContext
) {
  if (record.source_type === "internal_meeting") return true;

  const metadata = metadataObject(record.metadata);
  const speakerPersonId = metadataString(metadata?.speaker_person_id);
  if (speakerPersonId && context.internalPersonIds.has(speakerPersonId)) return true;

  const speakerName = normalizeSpeakerName(record.segment_speaker);
  return Boolean(speakerName && context.internalSpeakerNames.has(speakerName));
}

export function filterInternalEvidence<T extends EvidenceLike>(
  records: T[],
  context: InternalEvidenceGuardContext
) {
  return records.filter((record) => !isInternalEvidence(record, context));
}
