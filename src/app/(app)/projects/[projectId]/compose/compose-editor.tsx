"use client";

import { useEffect, useState } from "react";
import type { ArtifactType, ArtifactVerificationStatus } from "@/types/database";
import { AiDisclaimer } from "../../../components/AiDisclaimer";
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
  if (status === "verified") return "border-pos/20 bg-pos-bg text-pos";
  if (status === "partial") return "border-warn/20 bg-warn-bg text-warn";
  return "border-[var(--line)] bg-[var(--surface-2)] text-[var(--ink-2)]";
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
      <div className="mt-4 rounded-lg border border-neg/20 bg-neg-bg px-3 py-2 text-sm text-neg">
        {queueError}
      </div>
    );
  }

  if (pending) {
    return (
      <div className="mt-4 rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2 text-sm text-[var(--ink-2)]">
        Verification running...
      </div>
    );
  }

  if (!state?.runAt) {
    return (
      <div className="mt-4 rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2 text-sm font-medium text-[var(--ink-2)]">
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
  const [isPollingDraft, setIsPollingDraft] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isStartingVerification, setIsStartingVerification] = useState(false);
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

  // Poll for compose completion after fire-and-forget draft request
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
          setTitle(payload.title ?? "Untitled");
          setModelUsed(payload.model_used ?? null);
          setTaskTier(payload.task_tier ?? null);
          setArtifactType("other");
          setEvidenceIds(payload.evidence_ids ?? []);
          setSections(
            (payload.sections ?? []).map(
              (section: { heading: string; content: string }, index: number) => ({
                id: `${Date.now()}-${index}`,
                heading: section.heading,
                content: section.content,
              })
            )
          );
          setIsPollingDraft(false);
          setIsDrafting(false);
          return;
        }

        if (payload.status === "failed") {
          setError(payload.error ?? "Compose failed — please try again.");
          setIsPollingDraft(false);
          setIsDrafting(false);
          return;
        }
      } catch {
        // Network hiccup — keep polling
      }

      // Give up after ~3 minutes (90 attempts × 2s)
      if (attempts >= 90) {
        setError("Compose is taking longer than expected. Check that Inngest is running.");
        setIsPollingDraft(false);
        setIsDrafting(false);
      }
    }

    void poll();
    const interval = window.setInterval(() => { void poll(); }, 2000);
    return () => { cancelled = true; window.clearInterval(interval); };
  }, [artifactId, isPollingDraft]);

  async function createDraft(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    setSections([]);
    setIsDrafting(true);
    setIsPollingDraft(false);

    const response = await fetch("/api/compose/draft", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ project_id: projectId, prompt }),
    });

    const payload = await response.json();

    if (!response.ok) {
      setError(payload.error ?? "Could not start draft.");
      setIsDrafting(false);
      return;
    }

    // Route now returns immediately with artifact_id — start polling
    setArtifactId(payload.artifact_id ?? null);
    setVerification(null);
    setVerificationPending(false);
    setVerificationQueueError(null);
    setIsPollingDraft(true);
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
    setVerificationPending(false);
    setVerificationQueueError(null);
    setMessage(`Saved version ${payload.artifact.version}.`);
  }

  async function verifyClaims() {
    if (!artifactId) return;

    setError(null);
    setMessage(null);
    setVerificationQueueError(null);
    setIsStartingVerification(true);

    const response = await fetch(`/api/artifacts/${artifactId}/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ project_id: projectId }),
    });

    const payload = await response.json();
    setIsStartingVerification(false);

    if (!response.ok) {
      setVerificationQueueError(payload.error ?? "Could not start claim verification.");
      return;
    }

    setVerification({
      status: "unverified",
      runAt: null,
      summary: null,
    });
    setVerificationPending(true);
    setMessage("Claim verification started.");
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
      <form onSubmit={createDraft} className="rounded-xl border border-[var(--line)] bg-[var(--surface)]">
        <div className="border-b border-[var(--line)] px-5 py-4">
          <div className="text-sm font-semibold text-[var(--ink)]">Draft prompt</div>
          <p className="mt-1 text-xs text-[var(--ink-2)]">
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
              className="min-w-0 flex-1 rounded-lg border border-[var(--line)] bg-[var(--bg)] px-3 py-2 text-[var(--ink)] outline-none transition-colors placeholder:text-[var(--ink-faint)] focus:border-[var(--accent)]"
              placeholder="Write a persona for our enterprise buyer"
            />
            <button
              type="submit"
              disabled={isDrafting}
              className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[var(--accent-hover)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isDrafting ? "Drafting..." : "Draft"}
            </button>
          </div>
          {isDrafting && (
            <div className="mt-3 rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2 text-sm text-[var(--ink-2)]">
              {isPollingDraft
                ? "Generating a grounded draft — this usually takes 30–60 seconds on large evidence sets."
                : "Queuing draft…"}
            </div>
          )}
        </div>
      </form>

      {error && (
        <div className="rounded-lg border border-neg/20 bg-neg-bg px-3 py-2 text-sm text-neg">
          {error}
        </div>
      )}

      {message && (
        <div className="rounded-lg border border-pos/20 bg-pos-bg px-3 py-2 text-sm text-pos">
          {message}
        </div>
      )}

      {!isDrafting && sections.length === 0 && (
        <div className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-10 text-center">
          <div className="text-sm font-medium text-[var(--ink)]">No draft yet</div>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[var(--ink-2)]">
            Enter a prompt above to generate editable sections from the project evidence.
          </p>
        </div>
      )}

      {sections.length > 0 && (
        <div className="space-y-4">
          <div className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-5">
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_180px]">
              <div>
                <label className="mb-2 block text-sm font-medium text-[var(--ink)]" htmlFor="title">
                  Title
                </label>
                <input
                  id="title"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  className="w-full rounded-lg border border-[var(--line)] bg-[var(--bg)] px-3 py-2 text-[var(--ink)] outline-none transition-colors focus:border-[var(--accent)]"
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
                  className="w-full rounded-lg border border-[var(--line)] bg-[var(--bg)] px-3 py-2 text-[var(--ink)] outline-none transition-colors focus:border-[var(--accent)]"
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
              <div>
                <VerificationBanner
                  state={verification}
                  pending={verificationPending}
                  queueError={verificationQueueError}
                />
                <div className="mt-3 flex justify-end">
                  <button
                    type="button"
                    onClick={verifyClaims}
                    disabled={verificationPending || isStartingVerification || isSaving}
                    className="rounded-lg border border-[var(--line)] px-3 py-2 text-sm font-medium text-[var(--ink)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isStartingVerification ? "Starting..." : "Verify claims"}
                  </button>
                </div>
              </div>
            )}
          </div>

          {sections.map((section) => (
            <section key={section.id} className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-5">
              <div className="mb-3 flex items-center gap-2">
                <input
                  value={section.heading}
                  onChange={(event) => updateSection(section.id, { heading: event.target.value })}
                  className="min-w-0 flex-1 rounded-lg border border-[var(--line)] bg-[var(--bg)] px-3 py-2 font-medium text-[var(--ink)] outline-none transition-colors focus:border-[var(--accent)]"
                />
                <button
                  type="button"
                  onClick={() => addSection(section.id)}
                  className="h-9 w-9 rounded-lg border border-[var(--line)] text-[var(--ink)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]"
                  aria-label="Add section"
                >
                  +
                </button>
                <button
                  type="button"
                  onClick={() => deleteSection(section.id)}
                  className="h-9 w-9 rounded-lg border border-[var(--line)] text-[var(--ink-2)] transition-colors hover:border-neg hover:text-neg"
                  aria-label="Delete section"
                >
                  x
                </button>
              </div>
              <textarea
                value={section.content}
                onChange={(event) => updateSection(section.id, { content: event.target.value })}
                rows={10}
                className="w-full resize-y rounded-lg border border-[var(--line)] bg-[var(--bg)] px-3 py-2 text-[var(--ink)] outline-none transition-colors focus:border-[var(--accent)]"
              />
            </section>
          ))}

          <AiDisclaimer />

          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => addSection()}
              className="rounded-lg border border-[var(--line)] px-3 py-2 text-sm font-medium text-[var(--ink)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]"
            >
              + Add section
            </button>
            <button
              type="button"
              onClick={saveArtifact}
              disabled={isSaving}
              className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[var(--accent-hover)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSaving ? "Saving..." : "Save"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
