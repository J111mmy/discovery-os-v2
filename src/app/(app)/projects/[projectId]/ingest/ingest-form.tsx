"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type JobStatus = "idle" | "queued" | "pending" | "processing" | "done" | "failed";

interface IngestResult {
  segments_created: number;
  evidence_created: number;
}

interface IngestFormProps {
  projectId: string;
}

export function IngestForm({ projectId }: IngestFormProps) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [type, setType] = useState("transcript");
  const [rawText, setRawText] = useState("");
  const [jobId, setJobId] = useState<string | null>(null);
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
        setResult(payload.result ?? { segments_created: 0, evidence_created: 0 });
        router.refresh();
      }
      if (payload.status === "failed") {
        setError(payload.error ?? "Ingest failed.");
      }
    }, 1800);

    return () => window.clearInterval(interval);
  }, [jobId, router, status, pollCount]);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setResult(null);
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
    setStatus("pending");
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
              placeholder="Customer interview transcript"
            />
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-[var(--ink)]" htmlFor="type">
              Type
            </label>
            <select
              id="type"
              value={type}
              onChange={(event) => setType(event.target.value)}
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-0)] px-3 py-2 text-[var(--ink)] outline-none transition-colors focus:border-[var(--brand)]"
            >
              <option value="transcript">Transcript</option>
              <option value="document">Document</option>
              <option value="note">Note</option>
              <option value="other">Other</option>
            </select>
          </div>
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
            disabled={isWorking}
            className="w-full rounded-lg bg-[var(--brand)] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[var(--brand-dim)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isWorking ? "Processing..." : "Start ingest"}
          </button>
        </div>
      </aside>
    </form>
  );
}
