export const INGEST_ALREADY_RUNNING_MESSAGE =
  "This source is already being processed. Please wait for it to finish.";

export const INGEST_ENTITY_WARNING_MESSAGE =
  "Evidence was created, but speaker and organisation identification did not complete.";

export const INGEST_LINKING_FAILURE_MESSAGE =
  "DiscOS could not finish linking the extracted evidence to this source. Your source is still available. Please try processing it again.";

export const INGEST_GENERIC_FAILURE_MESSAGE =
  "Something went wrong while processing this source. Please try again.";

function errorText(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export function ingestUserMessage(value) {
  if (value == null || value === "") return null;

  const normalized = errorText(value);
  if (
    normalized.includes("ingest_jobs_one_active_per_source") ||
    (normalized.includes("duplicate key") && normalized.includes("ingest_jobs"))
  ) {
    return INGEST_ALREADY_RUNNING_MESSAGE;
  }

  if (
    normalized.includes("evidence_segment_id_fkey") ||
    normalized.includes("failed to store evidence")
  ) {
    return INGEST_LINKING_FAILURE_MESSAGE;
  }

  if (
    normalized.includes("entity_extraction_failed") ||
    normalized.includes("speaker and organisation identification did not complete")
  ) {
    return INGEST_ENTITY_WARNING_MESSAGE;
  }

  return INGEST_GENERIC_FAILURE_MESSAGE;
}

export function ingestIssueMessage(result) {
  if (!result || typeof result !== "object" || !Array.isArray(result.issues)) {
    return null;
  }

  for (const issue of result.issues) {
    if (!issue || typeof issue !== "object") continue;
    if (issue.code === "ENTITY_EXTRACTION_FAILED") {
      return INGEST_ENTITY_WARNING_MESSAGE;
    }
  }

  return null;
}

export function ingestJobUserMessage(input) {
  return ingestIssueMessage(input?.result) ?? ingestUserMessage(input?.error);
}
