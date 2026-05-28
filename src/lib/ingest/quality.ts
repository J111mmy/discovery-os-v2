export function looksLikeProcessedMarker(text: string) {
  const sample = text
    .slice(0, 1400)
    .toLowerCase()
    .replace(/\s+/g, " ");

  return (
    sample.includes("do not process again") ||
    (sample.includes("status: processed") &&
      sample.includes("source_id:") &&
      sample.includes("extracted evidence"))
  );
}

export const PROCESSED_MARKER_ERROR =
  "This looks like a processed marker file, not the original transcript. Upload or paste the original source text instead.";

export const STALE_INGEST_MS = 20 * 60 * 1000;

export function isStaleIngestJob(status: string | null | undefined, createdAt: string | null | undefined) {
  if (status !== "pending" && status !== "processing") return false;
  if (!createdAt) return false;

  const createdTime = new Date(createdAt).getTime();
  if (Number.isNaN(createdTime)) return false;

  return Date.now() - createdTime > STALE_INGEST_MS;
}
