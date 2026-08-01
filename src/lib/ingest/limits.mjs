export const MAX_RAW_TEXT_CHARS = 1_000_000;
export const MAX_ACTIVE_INGESTS_PER_ORG = 3;

export const RAW_TEXT_TOO_LARGE_MESSAGE =
  "This source is too large to process. Please split it into files smaller than 1,000,000 characters.";

export const INGEST_CAPACITY_MESSAGE =
  "This workspace already has several sources processing. Please wait for one to finish and try again.";

export function rawTextIsWithinLimit(value) {
  return typeof value === "string" && value.length <= MAX_RAW_TEXT_CHARS;
}

export function canDispatchIngest(activeIngestCount) {
  return (
    Number.isInteger(activeIngestCount) &&
    activeIngestCount >= 0 &&
    activeIngestCount < MAX_ACTIVE_INGESTS_PER_ORG
  );
}
