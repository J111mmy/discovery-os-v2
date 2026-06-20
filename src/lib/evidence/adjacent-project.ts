type EvidenceWithMetadata = {
  metadata?: unknown;
};

type EvidenceWithIdAndMetadata = EvidenceWithMetadata & {
  id: string;
};

function metadataString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export function isAdjacentProjectHintedEvidence(record: EvidenceWithMetadata) {
  const metadata = record.metadata;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return false;
  const values = metadata as Record<string, unknown>;

  return Boolean(
    metadataString(values.adjacent_project_hint) ||
      metadataString(values.adjacent_project_status)
  );
}

export function filterAdjacentProjectHintedEvidence<T extends EvidenceWithMetadata>(records: T[]) {
  return records.filter((record) => !isAdjacentProjectHintedEvidence(record));
}

export function adjacentProjectHintedEvidenceIds<T extends EvidenceWithIdAndMetadata>(
  records: T[]
) {
  return new Set(
    records.filter((record) => isAdjacentProjectHintedEvidence(record)).map((record) => record.id)
  );
}
