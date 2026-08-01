export const MAX_RAW_TEXT_CHARS: number;
export const MAX_ACTIVE_INGESTS_PER_ORG: number;
export const RAW_TEXT_TOO_LARGE_MESSAGE: string;
export const INGEST_CAPACITY_MESSAGE: string;

export function rawTextIsWithinLimit(value: unknown): boolean;
export function canDispatchIngest(activeIngestCount: number): boolean;
