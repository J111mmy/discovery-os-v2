// Ingest pipeline — runs as an Inngest background function
// Steps: fetch → extract text → chunk → redact PII → embed → store evidence

import { inngest } from "../client";
import { createServiceClient } from "@/lib/supabase/server";
import { embed } from "@/lib/llm/client";
import { redactPII } from "@/lib/llm/pii";

type StoredSegment = {
  id: string;
  segment_index: number;
  redacted_content: string | null;
};

// Contextual chunking: group transcript by speaker turn / conversation unit
// For documents: split by paragraph, target ~120 words/chunk

type Chunk = { speaker: string | null; content: string; index: number };

// Handles formats: "Speaker: text", "00:00 Speaker: text", "[00:00:00] Speaker: text"
// Accumulates multi-line turns, merges short consecutive turns into ~150-word chunks.
function chunkTranscript(text: string): Chunk[] {
  // Matches optional timestamp prefix + "Name: content"
  const speakerLine = /^(?:\[?[\d:]+\]?\s+)?([A-Za-z][^:\n]{0,50}):\s*(.*)$/;
  const lines = text.split("\n");

  // Pass 1: collect raw turns
  const turns: Array<{ speaker: string; content: string }> = [];
  let curSpeaker: string | null = null;
  let curLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const m = trimmed.match(speakerLine);
    if (m) {
      if (curSpeaker !== null && curLines.length > 0) {
        turns.push({ speaker: curSpeaker, content: curLines.join(" ") });
      }
      curSpeaker = m[1].trim();
      curLines = m[2].trim() ? [m[2].trim()] : [];
    } else if (curSpeaker !== null) {
      curLines.push(trimmed);
    }
  }
  if (curSpeaker !== null && curLines.length > 0) {
    turns.push({ speaker: curSpeaker, content: curLines.join(" ") });
  }

  if (turns.length === 0) return chunkDocument(text);

  // Pass 2: merge short turns into ~150-word chunks
  const chunks: Chunk[] = [];
  let buf: { speaker: string; content: string } | null = null;
  let index = 0;

  for (const turn of turns) {
    if (!buf) {
      buf = { ...turn };
    } else if (buf.speaker === turn.speaker) {
      buf.content += " " + turn.content;
    } else if (buf.content.split(/\s+/).length < 80) {
      // Buffer still small — absorb next turn regardless of speaker
      buf.content += " " + turn.content;
      buf.speaker = turn.speaker;
    } else {
      chunks.push({ speaker: buf.speaker, content: buf.content, index: index++ });
      buf = { ...turn };
    }
  }
  if (buf?.content.trim()) {
    chunks.push({ speaker: buf.speaker, content: buf.content, index: index++ });
  }

  return chunks.length > 0 ? chunks : chunkDocument(text);
}

function chunkDocument(text: string): Chunk[] {
  const chunks: Chunk[] = [];
  const paragraphs = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  let buffer = "";
  let index = 0;

  for (const para of paragraphs) {
    buffer = buffer ? `${buffer}\n\n${para}` : para;
    if (buffer.split(/\s+/).length >= 120) {
      chunks.push({ speaker: null, content: buffer, index: index++ });
      buffer = "";
    }
  }
  if (buffer.trim()) {
    chunks.push({ speaker: null, content: buffer, index: index++ });
  }
  return chunks;
}

function chunkText(text: string, type: string): Chunk[] {
  return type === "transcript" ? chunkTranscript(text) : chunkDocument(text);
}

export const ingestSource = inngest.createFunction(
  { id: "ingest-source", name: "Ingest Source", retries: 3 },
  { event: "source/ingest.requested" },
  async ({ event, step }) => {
    const { org_id, project_id, source_id, job_id } = event.data;
    const supabase = createServiceClient();

    // Step 1: Mark job as processing
    await step.run("mark-processing", async () => {
      await supabase
        .from("ingest_jobs")
        .update({ status: "processing", started_at: new Date().toISOString() })
        .eq("org_id", org_id)
        .eq("id", job_id);
    });

    // Step 2: Fetch source record
    const source = await step.run("fetch-source", async () => {
      const { data, error } = await supabase
        .from("sources")
        .select("*")
        .eq("org_id", org_id)
        .eq("project_id", project_id)
        .eq("id", source_id)
        .single();
      if (error) throw new Error(`Source not found: ${error.message}`);
      return data;
    });

    // Step 3: Extract text
    // In Phase 1: raw text is stored in source.metadata.raw_text
    // Phase 2: fetch from storage URL and parse (pdf-parse, docx, etc.)
    const rawText = await step.run("extract-text", async () => {
      const text = (source.metadata as Record<string, unknown>)?.raw_text as string;
      if (!text || text.trim().length < 20) {
        throw new Error("Source has no extractable text");
      }
      return text;
    });

    // Step 4: Chunk the text
    const chunks = await step.run("chunk-text", async () => {
      return chunkText(rawText, source.type);
    });

    // Step 5: Redact PII + store segments
    const segments = await step.run("store-segments", async () => {
      const records = chunks.map((chunk) => ({
        org_id,
        source_id,
        segment_index: chunk.index,
        speaker: chunk.speaker,
        raw_content: chunk.content,
        redacted_content: redactPII(chunk.content),
        word_count: chunk.content.split(/\s+/).length,
      }));

      const { data, error } = await supabase
        .from("source_segments")
        .insert(records)
        .select("id, segment_index, redacted_content");

      if (error) throw new Error(`Failed to store segments: ${error.message}`);
      return (data ?? []) as StoredSegment[];
    });

    // Step 6: Embed segments in batches of 10
    const evidenceRecords = await step.run("embed-and-store", async () => {
      const batchSize = 10;
      const stored = [];

      for (let i = 0; i < segments.length; i += batchSize) {
        const batch = segments.slice(i, i + batchSize);
        const texts = batch.map((s: StoredSegment) => s.redacted_content ?? "");

        // Embed each segment
        const embeddings = await Promise.all(texts.map(embed));

        const evidenceBatch = batch.map((seg: StoredSegment, idx: number) => ({
          org_id,
          project_id,
          source_id,
          segment_id: seg.id,
          content: texts[idx],
          embedding: `[${embeddings[idx].join(",")}]`, // pgvector format
          trust_scope: "pending" as const,
        }));

        const { data, error } = await supabase
          .from("evidence")
          .insert(evidenceBatch)
          .select("id");

        if (error) throw new Error(`Failed to store evidence: ${error.message}`);
        stored.push(...(data ?? []));
      }

      return stored;
    });

    // Step 7: Mark job complete — store counts so UI can show feedback
    await step.run("mark-complete", async () => {
      await supabase
        .from("ingest_jobs")
        .update({
          status: "done",
          completed_at: new Date().toISOString(),
          result: {
            segments_created: segments.length,
            evidence_created: evidenceRecords.length,
          },
        })
        .eq("org_id", org_id)
        .eq("id", job_id);

      await supabase
        .from("sources")
        .update({ trust_scope: "pending" })
        .eq("org_id", org_id)
        .eq("project_id", project_id)
        .eq("id", source_id);
    });

    return {
      source_id,
      segments_created: segments.length,
      evidence_created: evidenceRecords.length,
    };
  }
);
