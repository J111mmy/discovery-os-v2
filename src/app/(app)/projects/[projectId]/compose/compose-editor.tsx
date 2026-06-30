"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

interface ComposeEditorProps {
  projectId: string;
}

type DraftStage = "idle" | "queued" | "generating" | "opening";

function statusMessage(stage: DraftStage) {
  if (stage === "queued") return "Queuing draft...";
  if (stage === "generating") {
    return "Generating a grounded draft. It will open in the document reader when ready.";
  }
  if (stage === "opening") return "Opening document...";
  return null;
}

export function ComposeEditor({ projectId }: ComposeEditorProps) {
  const router = useRouter();
  const [prompt, setPrompt] = useState("");
  const [artifactId, setArtifactId] = useState<string | null>(null);
  const [stage, setStage] = useState<DraftStage>("idle");
  const [isDrafting, setIsDrafting] = useState(false);
  const [isPollingDraft, setIsPollingDraft] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!artifactId || !isPollingDraft) return;

    let cancelled = false;
    let attempts = 0;

    async function poll() {
      attempts += 1;

      try {
        const response = await fetch(`/api/artifacts/${artifactId}/status`, { cache: "no-store" });
        const payload = await response.json();

        if (cancelled) return;

        if (payload.status === "done") {
          const id = payload.artifact_id ?? artifactId;
          const href = typeof payload.document_href === "string"
            ? payload.document_href
            : `/projects/${projectId}/documents/${id}`;
          setStage("opening");
          setIsPollingDraft(false);
          setIsDrafting(false);
          router.push(href);
          router.refresh();
          return;
        }

        if (payload.status === "failed") {
          setError(payload.error ?? "Compose failed. Please try again.");
          setStage("idle");
          setIsPollingDraft(false);
          setIsDrafting(false);
          return;
        }
      } catch {
        // Network hiccup. Keep polling until the timeout below.
      }

      if (attempts >= 90) {
        setError("Compose is taking longer than expected. Open the document library and refresh in a moment.");
        setStage("idle");
        setIsPollingDraft(false);
        setIsDrafting(false);
      }
    }

    void poll();
    const interval = window.setInterval(() => {
      void poll();
    }, 2000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [artifactId, isPollingDraft, projectId, router]);

  async function createDraft(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsDrafting(true);
    setIsPollingDraft(false);
    setStage("queued");

    const response = await fetch("/api/compose/draft", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ project_id: projectId, prompt }),
    });

    const payload = await response.json();

    if (!response.ok) {
      setError(payload.error ?? "Could not start draft.");
      setStage("idle");
      setIsDrafting(false);
      return;
    }

    if (!payload.artifact_id) {
      setError("Could not start draft: no document was created.");
      setStage("idle");
      setIsDrafting(false);
      return;
    }

    setArtifactId(payload.artifact_id);
    setStage("generating");
    setIsPollingDraft(true);
  }

  const activeMessage = statusMessage(stage);

  return (
    <div className="space-y-6">
      <form onSubmit={createDraft} className="rounded-xl border border-[var(--line)] bg-[var(--surface)]">
        <div className="border-b border-[var(--line)] px-5 py-4">
          <div className="text-sm font-semibold text-[var(--ink)]">Draft prompt</div>
          <p className="mt-1 text-xs text-[var(--ink-2)]">
            The draft uses the project evidence pipeline and opens as a flowing cited document.
          </p>
        </div>
        <div className="p-5">
          <label className="mb-2 block text-sm font-medium text-[var(--ink)]" htmlFor="prompt">
            Prompt
          </label>
          <div className="flex flex-col gap-3 sm:flex-row">
            <input
              id="prompt"
              required
              minLength={5}
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              className="min-w-0 flex-1 rounded-lg border border-[var(--line)] bg-[var(--bg)] px-3 py-2 text-[var(--ink)] outline-none transition-colors placeholder:text-[var(--ink-faint)] focus:border-[var(--accent)]"
              placeholder="Create a 6 page slide deck for an exec meeting"
            />
            <button
              type="submit"
              disabled={isDrafting}
              className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[var(--accent-hover)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isDrafting ? "Drafting..." : "Draft"}
            </button>
          </div>
          {activeMessage && (
            <div className="mt-3 rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2 text-sm text-[var(--ink-2)]">
              {activeMessage}
            </div>
          )}
        </div>
      </form>

      {error && (
        <div className="rounded-lg border border-neg/20 bg-neg-bg px-3 py-2 text-sm text-neg">
          {error}
        </div>
      )}

      {!isDrafting && (
        <div className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-10 text-center">
          <div className="text-sm font-medium text-[var(--ink)]">No draft in progress</div>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[var(--ink-2)]">
            Enter a prompt above. Completed drafts open in the document reader with citations,
            source context, and the trust summary.
          </p>
        </div>
      )}
    </div>
  );
}
