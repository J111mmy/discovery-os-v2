"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { SOURCE_TYPE_LABELS } from "@/lib/labels";
import type { SourceType } from "@/types/database";

type JobStatus = "idle" | "queued" | "pending" | "processing" | "done" | "failed";

interface IngestResult {
  segments_created: number;
  evidence_created: number;
}

interface IngestFormProps {
  projectId: string;
}

const INGEST_SOURCE_TYPES: SourceType[] = [
  "customer_interview",
  "sales_call",
  "usability_study",
  "internal_meeting",
  "transcript",
  "document",
  "note",
  "survey",
  "support_ticket",
  "other",
];

const TEXT_FILE_EXTENSIONS = new Set(["txt", "md", "markdown"]);
const DOCUMENT_FILE_EXTENSIONS = new Set(["pdf", "doc", "docx", "md", "markdown"]);
const ALLOWED_FILE_EXTENSIONS = new Set([
  "pdf",
  "doc",
  "docx",
  "txt",
  "md",
  "markdown",
]);

export function IngestForm({ projectId }: IngestFormProps) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [type, setType] = useState<SourceType>("customer_interview");
  const [rawText, setRawText] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [extractingFile, setExtractingFile] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [sourceId, setSourceId] = useState<string | null>(null);
  const [status, setStatus] = useState<JobStatus>("idle");
  const [result, setResult] = useState<IngestResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pollCount, setPollCount] = useState(0);

  useEffect(() => {
    if (!jobId || status === "done" || status === "failed") return;

    // Give up after ~3 minutes (100 polls × 1800ms) and show a helpful message
    if (pollCount > 100) {
      setError(
        "Still processing after 3 minutes. Check that Inngest is running — locally run: npx inngest-cli@latest dev -u http://localhost:3000/api/inngest. On Vercel make sure INNGEST_EVENT_KEY and INNGEST_SIGNING_KEY are set."
      );
      setStatus("failed");
      return;
    }

    const interval = window.setInterval(async () => {
      const response = await fetch(`/api/ingest/status?job_id=${jobId}`, {
        cache: "no-store",
      });
      const payload = await response.json();

      if (!response.ok) {
        setError(payload.error ?? "Could not read ingest status.");
        setStatus("failed");
        return;
      }

      setPollCount((c) => c + 1);
      setStatus(payload.status);
      if (payload.status === "done") {
        const completedSourceId = typeof payload.source_id === "string" ? payload.source_id : sourceId;
        setResult(payload.result ?? { segments_created: 0, evidence_created: 0 });
        router.refresh();
        if (completedSourceId) {
          router.push(`/projects/${projectId}/sources/${completedSourceId}`);
        }
      }
      if (payload.status === "failed") {
        setError(payload.error ?? "Ingest failed.");
      }
    }, 1800);

    return () => window.clearInterval(interval);
  }, [jobId, projectId, router, sourceId, status, pollCount]);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setResult(null);
    setSourceId(null);
    setStatus("queued");

    const response = await fetch("/api/ingest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        project_id: projectId,
        title,
        type,
        raw_text: rawText,
      }),
    });

    const payload = await response.json();
    if (!response.ok) {
      setError(typeof payload.error === "string" ? payload.error : "Could not start ingest.");
      setStatus("idle");
      return;
    }

    setJobId(payload.job_id);
    setSourceId(payload.source_id ?? null);
    setStatus("pending");
  }

  async function readTextFile(file: File) {
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ""));
      reader.onerror = () => reject(new Error("Could not read this text file."));
      reader.readAsText(file);
    });
  }

  async function onFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    setFileName(file.name);
    setFileError(null);
    setError(null);

    if (!title.trim()) {
      setTitle(file.name.replace(/\.[^.]+$/, ""));
    }

    const extension = file.name.split(".").pop()?.toLowerCase();
    if (!ALLOWED_FILE_EXTENSIONS.has(extension ?? "")) {
      setFileError("Upload a .pdf, .doc, .docx, .txt, .md, or .markdown file.");
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      setFileError("File is too large. Upload a file under 10MB.");
      return;
    }

    setExtractingFile(true);

    try {
      let text = "";

      if (TEXT_FILE_EXTENSIONS.has(extension ?? "")) {
        text = await readTextFile(file);
      } else {
        const formData = new FormData();
        formData.append("file", file);

        const response = await fetch("/api/ingest/extract-text", {
          method: "POST",
          body: formData,
        });
        const payload = await response.json();

        if (!response.ok) {
          throw new Error(payload.error ?? "Could not extract text from this file.");
        }

        text = payload.text ?? "";
      }

      if (!text.trim()) {
        throw new Error("No readable text was found in this file.");
      }

      setRawText(text.trim());
      if (DOCUMENT_FILE_EXTENSIONS.has(extension ?? "")) {
        setType("document");
      }
    } catch (extractError) {
      const message =
        extractError instanceof Error
          ? extractError.message
          : "Could not extract text from this file.";
      setFileError(`${message} You can paste the text manually instead.`);
    } finally {
      setExtractingFile(false);
    }
  }

  const isWorking = status === "queued" || status === "pending" || status === "processing";

  return (
    <form onSubmit={onSubmit} className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_280px]">
      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-1)] p-5">
        <div className="grid gap-5 sm:grid-cols-[minmax(0,1fr)_180px]">
          <div>
            <label className="mb-2 block text-sm font-medium text-[var(--ink)]" htmlFor="title">
              Title
            </label>
            <input
              id="title"
              required
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-0)] px-3 py-2 text-[var(--ink)] outline-none transition-colors placeholder:text-[var(--ink-faint)] focus:border-[var(--brand)]"
              placeholder="Q1 call with Sarah K., Acme Corp"
            />
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-[var(--ink)]" htmlFor="type">
              Type
            </label>
            <select
              id="type"
              value={type}
              onChange={(event) => setType(event.target.value as SourceType)}
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-0)] px-3 py-2 text-[var(--ink)] outline-none transition-colors focus:border-[var(--brand)]"
            >
              {INGEST_SOURCE_TYPES.map((sourceType) => (
                <option key={sourceType} value={sourceType}>
                  {SOURCE_TYPE_LABELS[sourceType]}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="mt-5">
          <label className="mb-2 block text-sm font-medium text-[var(--ink)]" htmlFor="sourceFile">
            Or upload a file
          </label>
          <input
            id="sourceFile"
            type="file"
            accept=".pdf,.doc,.docx,.txt,.md,.markdown"
            disabled={isWorking || extractingFile}
            onChange={onFileChange}
            className="block w-full rounded-lg border border-dashed border-[var(--border)] bg-[var(--surface-0)] px-3 py-2 text-sm text-[var(--ink-muted)] file:mr-4 file:rounded-md file:border-0 file:bg-[var(--surface-2)] file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-[var(--ink)] hover:border-[var(--brand)] disabled:cursor-not-allowed disabled:opacity-60"
          />
          {extractingFile && (
            <div className="mt-2 text-sm text-[var(--ink-muted)]">Extracting text...</div>
          )}
          {!extractingFile && fileName && rawText && !fileError && (
            <div className="mt-2 text-sm text-green-300">
              Loaded {fileName}. Review the extracted text below before ingesting.
            </div>
          )}
          {fileError && (
            <div className="mt-2 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-300">
              {fileError}
            </div>
          )}
        </div>

        <div className="mt-5">
          <label className="mb-2 block text-sm font-medium text-[var(--ink)]" htmlFor="rawText">
            Raw text
          </label>
          <textarea
            id="rawText"
            required
            minLength={20}
            rows={22}
            value={rawText}
            onChange={(event) => setRawText(event.target.value)}
            className="w-full resize-y rounded-lg border border-[var(--border)] bg-[var(--surface-0)] px-3 py-2 text-[var(--ink)] outline-none transition-colors placeholder:text-[var(--ink-faint)] focus:border-[var(--brand)]"
            placeholder="Paste the transcript, research note, or document text here."
          />
        </div>
      </div>

      <aside className="rounded-xl border border-[var(--border)] bg-[var(--surface-1)] p-5">
        <div className="text-sm font-semibold text-[var(--ink)]">Ingest status</div>
        <p className="mt-2 text-sm leading-6 text-[var(--ink-muted)]">
          Evidence creation usually starts within a few seconds after submission.
        </p>

        {isWorking && (
          <div className="mt-4 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-sm text-[var(--ink-muted)]">
            Processing... {status === "processing" ? "Evidence is being generated." : "The job is queued."}
          </div>
        )}

        {status === "done" && (
          <div className="mt-4 rounded-lg border border-green-500/20 bg-green-500/10 px-3 py-2 text-sm text-green-300">
            <div>✓ Processed — {result?.evidence_created ?? 0} evidence records created</div>
            <a href={`/projects/${projectId}/evidence`} className="mt-2 inline-flex text-[var(--ink)] hover:text-[var(--brand)]">
              View evidence
            </a>
          </div>
        )}

        {error && (
          <div className="mt-4 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-300">
            {error}
          </div>
        )}

        <div className="mt-5">
          <button
            type="submit"
            disabled={isWorking || extractingFile}
            className="w-full rounded-lg bg-[var(--brand)] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[var(--brand-dim)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {extractingFile ? "Extracting..." : isWorking ? "Processing..." : "Start ingest"}
          </button>
        </div>
      </aside>
    </form>
  );
}
