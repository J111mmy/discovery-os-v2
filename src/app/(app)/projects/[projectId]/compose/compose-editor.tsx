"use client";

import { useEffect, useState } from "react";
import type { ArtifactType, ArtifactVerificationStatus } from "@/types/database";
import {
  getArtifactVerificationStatusAction,
  type ArtifactVerificationState,
} from "./actions";

interface Section {
  id: string;
  heading: string;
  content: string;
}

interface ComposeEditorProps {
  projectId: string;
  initialDraft?: {
    artifactId: string;
    title: string;
    prompt: string;
    sections: Array<{ heading: string; content: string }>;
    modelUsed: string | null;
    taskTier: string | null;
    artifactType: ArtifactType;
    evidenceIds: string[];
    verificationStatus: ArtifactVerificationStatus;
    verificationRunAt: string | null;
    verificationSummary: Record<string, unknown> | null;
  } | null;
}

function markdownFromSections(title: string, sections: Section[]) {
  return [
    `# ${title}`,
    "",
    ...sections.map((section) => `## ${section.heading.trim() || "Untitled"}\n\n${section.content.trim()}`),
  ].join("\n\n");
}

function verificationLabel(status: ArtifactVerificationStatus) {
  if (status === "verified") return "Verified";
  if (status === "partial") return "Partially verified";
  return "Unverified";
}

function verificationClasses(status: ArtifactVerificationStatus) {
  if (status === "verified") return "border-green-500/20 bg-green-500/10 text-green-300";
  if (status === "partial") return "border-yellow-500/20 bg-yellow-500/10 text-yellow-300";
  return "border-[var(--border)] bg-[var(--surface-2)] text-[var(--ink-muted)]";
}

function summaryLabel(summary: Record<string, unknown> | null) {
  if (!summary) return null;
  const total = Number(summary.total ?? 0);
  const supported = Number(summary.supported ?? 0);
  const partial = Number(summary.partial ?? 0);
  if (!total) return null;
  return `${supported} supported${partial ? `, ${partial} partial` : ""} of ${total} claims`;
}

function VerificationBanner({
  state,
  pending,
  queueError,
}: {
  state: ArtifactVerificationState | null;
  pending: boolean;
  queueError: string | null;
}) {
  if (queueError) {
    return (
      <div className="mt-4 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-300">
        {queueError}
      </div>
    );
  }

  if (pending) {
    return (
      <div className="mt-4 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-sm text-[var(--ink-muted)]">
        Verification running...
      </div>
    );
  }

  if (!state?.runAt) {
    return (
      <div className="mt-4 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-sm font-medium text-[var(--ink-muted)]">
        Unverified
        <span className="font-normal"> — no verification run yet</span>
      </div>
    );
  }

  const detail = summaryLabel(state.summary);

  return (
    <div
      className={`mt-4 rounded-lg border px-3 py-2 text-sm font-medium ${verificationClasses(
        state.status
      )}`}
    >
      {verificationLabel(state.status)}
      {detail ? <span className="font-normal"> — {detail}</span> : null}
    </div>
  );
}

export function ComposeEditor({ projectId, initialDraft = null }: ComposeEditorProps) {
  const [prompt, setPrompt] = useState(initialDraft?.prompt ?? "");
  const [title, setTitle] = useState(initialDraft?.title ?? "");
  const [sections, setSections] = useState<Section[]>(
    initialDraft?.sections.map((section, index) => ({
      id: `${initialDraft.artifactId}-${index}`,
      heading: section.heading,
      content: section.content,
    })) ?? []
  );
  const [artifactId, setArtifactId] = useState<string | null>(initialDraft?.artifactId ?? null);
  const [modelUsed, setModelUsed] = useState<string | null>(initialDraft?.modelUsed ?? null);
  const [taskTier, setTaskTier] = useState<string | null>(initialDraft?.taskTier ?? null);
  const [artifactType, setArtifactType] = useState<ArtifactType>(initialDraft?.artifactType ?? "other");
  const [evidenceIds, setEvidenceIds] = useState<string[]>(initialDraft?.evidenceIds ?? []);
  const [verification, setVerification] = useState<ArtifactVerificationState | null>(
    initialDraft
      ? {
          status: initialDraft.verificationStatus,
          runAt: initialDraft.verificationRunAt,
          summary: initialDraft.verificationSummary,
        }
      : null
  );
  const [verificationPending, setVerificationPending] = useState(false);
  const [verificationQueueError, setVerificationQueueError] = useState<string | null>(null);
  const [isDrafting, setIsDrafting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!artifactId || !verificationPending) return;

    let cancelled = false;
    let attempts = 0;

    async function pollVerification() {
      attempts += 1;
      const nextState = await getArtifactVerificationStatusAction(projectId, artifactId!);
      if (cancelled) return;

      if (nextState) {
        setVerification(nextState);
        if (nextState.runAt) {
          setVerificationPending(false);
          return;
        }
      }

      if (attempts >= 20) {
        setVerificationPending(false);
      }
    }

    void pollVerification();
    const interval = window.setInterval(() => {
      void pollVerification();
    }, 3000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [artifactId, projectId, verificationPending]);

  async function createDraft(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    setIsDrafting(true);

    const response = await fetch("/api/compose/draft", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        project_id: projectId,
        prompt,
      }),
    });

    const payload = await response.json();
    setIsDrafting(false);

    if (!response.ok) {
      setError(payload.error ?? "Could not draft artifact.");
      return;
    }

    setTitle(payload.title ?? "Untitled");
    setArtifactId(payload.artifact_id ?? null);
    setVerification(null);
    setVerificationPending(false);
    setVerificationQueueError(null);
    setModelUsed(payload.model_used ?? null);
    setTaskTier(payload.task_tier ?? null);
    setArtifactType("other");
    setEvidenceIds(payload.evidence_ids ?? []);
    setSections(
      (payload.sections ?? []).map((section: { heading: string; content: string }, index: number) => ({
        id: `${Date.now()}-${index}`,
        heading: section.heading,
        content: section.content,
      }))
    );
  }

  async function saveArtifact() {
    setError(null);
    setMessage(null);
    setIsSaving(true);

    const contentMd = markdownFromSections(title || "Untitled", sections);
    const response = await fetch("/api/artifacts/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        artifact_id: artifactId,
        project_id: projectId,
        title: title || "Untitled",
        prompt,
        content_md: contentMd,
        type: artifactType,
        model_used: modelUsed,
        task_tier: taskTier,
        metadata: { evidence_ids: evidenceIds },
      }),
    });

    const payload = await response.json();
    setIsSaving(false);

    if (!response.ok) {
      setError(payload.error ?? "Could not save artifact.");
      return;
    }

    setArtifactId(payload.artifact.id);
    setVerification({
      status: "unverified",
      runAt: null,
      summary: null,
    });
    setVerificationPending(payload.verification_queued !== false);
    setVerificationQueueError(
      payload.verification_queued === false
        ? "Saved, but verification could not start yet."
        : null
    );
    setMessage(`Saved version ${payload.artifact.version}.`);
  }

  function updateSection(id: string, patch: Partial<Section>) {
    setSections((current) =>
      current.map((section) => (section.id === id ? { ...section, ...patch } : section))
    );
  }

  function deleteSection(id: string) {
    setSections((current) => current.filter((section) => section.id !== id));
  }

  function addSection(afterId?: string) {
    const nextSection = {
      id: `${Date.now()}`,
      heading: "New section",
      content: "",
    };

    setSections((current) => {
      if (!afterId) return [...current, nextSection];
      const index = current.findIndex((section) => section.id === afterId);
      if (index === -1) return [...current, nextSection];
      return [...current.slice(0, index + 1), nextSection, ...current.slice(index + 1)];
    });
  }

  return (
    <div className="space-y-6">
      <form onSubmit={createDraft} className="rounded-xl border border-[var(--border)] bg-[var(--surface-1)]">
        <div className="border-b border-[var(--border)] px-5 py-4">
          <div className="text-sm font-semibold text-[var(--ink)]">Draft prompt</div>
          <p className="mt-1 text-xs text-[var(--ink-muted)]">
            The draft will use the project evidence query pipeline and return editable markdown sections.
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
              className="min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-[var(--surface-0)] px-3 py-2 text-[var(--ink)] outline-none transition-colors placeholder:text-[var(--ink-faint)] focus:border-[var(--brand)]"
              placeholder="Write a persona for our enterprise buyer"
            />
            <button
              type="submit"
              disabled={isDrafting}
              className="rounded-lg bg-[var(--brand)] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[var(--brand-dim)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isDrafting ? "Drafting..." : "Draft"}
            </button>
          </div>
          {isDrafting && (
            <div className="mt-3 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-sm text-[var(--ink-muted)]">
              Generating a grounded draft. This can take 20-40 seconds.
            </div>
          )}
        </div>
      </form>

      {error && (
        <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {error}
        </div>
      )}

      {message && (
        <div className="rounded-lg border border-green-500/20 bg-green-500/10 px-3 py-2 text-sm text-green-300">
          {message}
        </div>
      )}

      {!isDrafting && sections.length === 0 && (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-1)] p-10 text-center">
          <div className="text-sm font-medium text-[var(--ink)]">No draft yet</div>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[var(--ink-muted)]">
            Enter a prompt above to generate editable sections from the project evidence.
          </p>
        </div>
      )}

      {sections.length > 0 && (
        <div className="space-y-4">
          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-1)] p-5">
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_180px]">
              <div>
                <label className="mb-2 block text-sm font-medium text-[var(--ink)]" htmlFor="title">
                  Title
                </label>
                <input
                  id="title"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-0)] px-3 py-2 text-[var(--ink)] outline-none transition-colors focus:border-[var(--brand)]"
                />
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium text-[var(--ink)]" htmlFor="artifact-type">
                  Type
                </label>
                <select
                  id="artifact-type"
                  value={artifactType}
                  onChange={(event) => setArtifactType(event.target.value as ArtifactType)}
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-0)] px-3 py-2 text-[var(--ink)] outline-none transition-colors focus:border-[var(--brand)]"
                >
                  <option value="brief">Brief</option>
                  <option value="prd">PRD</option>
                  <option value="persona">Persona</option>
                  <option value="opportunity">Opportunity</option>
                  <option value="gtm">GTM</option>
                  <option value="interview_guide">Interview guide</option>
                  <option value="report">Report</option>
                  <option value="other">Other</option>
                </select>
              </div>
            </div>
            {artifactId && (
              <VerificationBanner
                state={verification}
                pending={verificationPending}
                queueError={verificationQueueError}
              />
            )}
          </div>

          {sections.map((section) => (
            <section key={section.id} className="rounded-xl border border-[var(--border)] bg-[var(--surface-1)] p-5">
              <div className="mb-3 flex items-center gap-2">
                <input
                  value={section.heading}
                  onChange={(event) => updateSection(section.id, { heading: event.target.value })}
                  className="min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-[var(--surface-0)] px-3 py-2 font-medium text-[var(--ink)] outline-none transition-colors focus:border-[var(--brand)]"
                />
                <button
                  type="button"
                  onClick={() => addSection(section.id)}
                  className="h-9 w-9 rounded-lg border border-[var(--border)] text-[var(--ink)] transition-colors hover:border-[var(--brand)] hover:text-[var(--brand)]"
                  aria-label="Add section"
                >
                  +
                </button>
                <button
                  type="button"
                  onClick={() => deleteSection(section.id)}
                  className="h-9 w-9 rounded-lg border border-[var(--border)] text-[var(--ink-muted)] transition-colors hover:border-red-400 hover:text-red-300"
                  aria-label="Delete section"
                >
                  x
                </button>
              </div>
              <textarea
                value={section.content}
                onChange={(event) => updateSection(section.id, { content: event.target.value })}
                rows={10}
                className="w-full resize-y rounded-lg border border-[var(--border)] bg-[var(--surface-0)] px-3 py-2 text-[var(--ink)] outline-none transition-colors focus:border-[var(--brand)]"
              />
            </section>
          ))}

          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => addSection()}
              className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm font-medium text-[var(--ink)] transition-colors hover:border-[var(--brand)] hover:text-[var(--brand)]"
            >
              + Add section
            </button>
            <button
              type="button"
              onClick={saveArtifact}
              disabled={isSaving}
              className="rounded-lg bg-[var(--brand)] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[var(--brand-dim)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSaving ? "Saving..." : "Save"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
