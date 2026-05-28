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
