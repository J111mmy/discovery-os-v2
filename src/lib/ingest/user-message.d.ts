export const INGEST_ALREADY_RUNNING_MESSAGE: string;
export const INGEST_ENTITY_WARNING_MESSAGE: string;
export const INGEST_LINKING_FAILURE_MESSAGE: string;
export const INGEST_GENERIC_FAILURE_MESSAGE: string;

export function ingestUserMessage(value: unknown): string | null;
export function ingestIssueMessage(result: unknown): string | null;
export function ingestJobUserMessage(input: {
  error?: unknown;
  result?: unknown;
}): string | null;
