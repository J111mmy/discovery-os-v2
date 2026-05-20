"use client";

import { useState } from "react";

interface Section {
  id: string;
  heading: string;
  content: string;
}

interface ComposeEditorProps {
  projectId: string;
}

function markdownFromSections(title: string, sections: Section[]) {
  return [
    `# ${title}`,
    "",
    ...sections.map((section) => `## ${section.heading.trim() || "Untitled"}\n\n${section.content.trim()}`),
  ].join("\n\n");
}

export function ComposeEditor({ projectId }: ComposeEditorProps) {
  const [prompt, setPrompt] = useState("");
  const [title, setTitle] = useState("");
  const [sections, setSections] = useState<Section[]>([]);
  const [artifactId, setArtifactId] = useState<string | null>(null);
  const [modelUsed, setModelUsed] = useState<string | null>(null);
  const [taskTier, setTaskTier] = useState<string | null>(null);
  const [evidenceIds, setEvidenceIds] = useState<string[]>([]);
  const [isDrafting, setIsDrafting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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
    setModelUsed(payload.model_used ?? null);
    setTaskTier(payload.task_tier ?? null);
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
        type: "other",
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
