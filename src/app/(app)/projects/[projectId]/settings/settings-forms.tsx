"use client";

import { useRef, useState } from "react";
import {
  generateFrameAction,
  suggestProjectSettingsAction,
  type SuggestedProjectSettings,
} from "./actions";
import { FrameDraftBanner, type FrameDraft } from "./frame-draft-banner";

type ResearchContext = {
  goals?: string;
  outcomes?: string;
  buyers?: string;
  scope_in?: string;
  scope_out?: string;
  research_questions?: string[];
};

interface ProjectSettings {
  frame: string | null;
  frame_draft: FrameDraft | null;
  frame_draft_generated_at: string | null;
  research_context: ResearchContext | null;
  operating_style: string | null;
  gtm_context: string | null;
}

interface SettingsFormsProps {
  projectId: string;
  initialProject: ProjectSettings;
}

function cleanResearchContext(context: ResearchContext): ResearchContext | null {
  const cleaned: ResearchContext = {};

  const textFields: Array<keyof Omit<ResearchContext, "research_questions">> = [
    "goals",
    "outcomes",
    "buyers",
    "scope_in",
    "scope_out",
  ];

  textFields.forEach((field) => {
    const value = context[field]?.trim();
    if (value) cleaned[field] = value;
  });

  const questions = (context.research_questions ?? [])
    .map((question) => question.trim())
    .filter(Boolean);

  if (questions.length > 0) {
    cleaned.research_questions = questions;
  }

  return Object.keys(cleaned).length > 0 ? cleaned : null;
}

export function SettingsForms({
  projectId,
  initialProject,
}: SettingsFormsProps) {
  const [frame, setFrame] = useState(initialProject.frame ?? "");
  const [frameDraft, setFrameDraft] = useState(initialProject.frame_draft);
  const [frameDraftGeneratedAt] = useState(initialProject.frame_draft_generated_at);
  const [researchContext, setResearchContext] = useState<ResearchContext>(
    initialProject.research_context ?? { research_questions: [""] }
  );
  const [operatingStyle, setOperatingStyle] = useState(initialProject.operating_style ?? "");
  const [gtmContext, setGtmContext] = useState(initialProject.gtm_context ?? "");
  const [settingsMessage, setSettingsMessage] = useState<string | null>(null);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isSavingResearchContext, setIsSavingResearchContext] = useState(false);
  const [isGeneratingFrame, setIsGeneratingFrame] = useState(false);
  const [isSuggestingSettings, setIsSuggestingSettings] = useState(false);
  const researchSaveTimeout = useRef<number | null>(null);

  async function saveProjectSettings(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSettingsMessage(null);
    setSettingsError(null);
    setIsSaving(true);

    const response = await fetch(`/api/projects/${projectId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        frame,
        research_context: cleanResearchContext(researchContext),
        operating_style: operatingStyle,
        gtm_context: gtmContext,
      }),
    });

    const payload = await response.json();
    setIsSaving(false);

    if (!response.ok) {
      setSettingsError(payload.error ?? "Could not save settings.");
      return;
    }

    setSettingsMessage("Project settings saved.");
  }

  async function saveResearchContext(nextContext = researchContext, showMessage = true) {
    setSettingsError(null);
    setIsSavingResearchContext(true);

    try {
      const response = await fetch(`/api/projects/${projectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          research_context: cleanResearchContext(nextContext),
        }),
      });

      const payload = await response.json();

      if (!response.ok) {
        setSettingsError(payload.error ?? "Could not save research focus.");
        return;
      }

      if (showMessage) {
        setSettingsMessage("Research focus saved.");
      }
    } finally {
      setIsSavingResearchContext(false);
    }
  }

  function updateResearchContextField(field: keyof ResearchContext, value: string) {
    setResearchContext((current) => ({ ...current, [field]: value }));
  }

  function scheduleResearchContextSave(nextContext: ResearchContext) {
    if (researchSaveTimeout.current) {
      window.clearTimeout(researchSaveTimeout.current);
    }

    researchSaveTimeout.current = window.setTimeout(() => {
      void saveResearchContext(nextContext, false);
    }, 500);
  }

  function updateResearchQuestion(index: number, value: string) {
    setResearchContext((current) => {
      const questions =
        current.research_questions && current.research_questions.length > 0
          ? [...current.research_questions]
          : [""];
      questions[index] = value;
      const next = { ...current, research_questions: questions };
      scheduleResearchContextSave(next);
      return next;
    });
  }

  function addResearchQuestion() {
    setResearchContext((current) => {
      const questions = [...(current.research_questions ?? []), ""];
      return { ...current, research_questions: questions };
    });
  }

  function removeResearchQuestion(index: number) {
    setResearchContext((current) => {
      const questions = (current.research_questions ?? []).filter((_, i) => i !== index);
      const next = { ...current, research_questions: questions.length > 0 ? questions : [""] };
      scheduleResearchContextSave(next);
      return next;
    });
  }

  async function generateFrame() {
    setSettingsMessage(null);
    setSettingsError(null);
    setIsGeneratingFrame(true);

    try {
      const formData = new FormData();
      formData.set("project_id", projectId);
      const generatedFrame = await generateFrameAction(formData);
      setFrame(generatedFrame);
      setSettingsMessage("Project frame generated and saved.");
    } catch (error) {
      setSettingsError(
        error instanceof Error ? error.message : "Could not generate project frame."
      );
    } finally {
      setIsGeneratingFrame(false);
    }
  }

  function applySuggestedSettings(suggestion: SuggestedProjectSettings) {
    const questions = suggestion.research_context.research_questions.length
      ? suggestion.research_context.research_questions
      : [""];

    setResearchContext({
      ...suggestion.research_context,
      research_questions: questions,
    });
    setFrame(suggestion.frame);
    setOperatingStyle(suggestion.operating_style);
    setGtmContext(suggestion.gtm_context);
  }

  async function suggestProjectSettings() {
    setSettingsMessage(null);
    setSettingsError(null);
    setIsSuggestingSettings(true);

    try {
      const formData = new FormData();
      formData.set("project_id", projectId);
      const suggestion = await suggestProjectSettingsAction(formData);
      applySuggestedSettings(suggestion);
      setSettingsMessage("AI suggested project settings from evidence. Review and save when ready.");
    } catch (error) {
      setSettingsError(
        error instanceof Error ? error.message : "Could not suggest project settings."
      );
    } finally {
      setIsSuggestingSettings(false);
    }
  }

  return (
    <div className="space-y-6">
      <form onSubmit={saveProjectSettings} className="rounded-xl border border-[var(--line)] bg-[var(--surface)]">
          <div className="flex flex-col gap-3 border-b border-[var(--line)] px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-sm font-semibold text-[var(--ink)]">Project context</h2>
              <p className="mt-1 text-xs leading-5 text-[var(--ink-2)]">
                Let AI draft this from evidence, then edit before saving.
              </p>
            </div>
            <button
              type="button"
              onClick={suggestProjectSettings}
              disabled={isSuggestingSettings}
              className="inline-flex rounded-lg border border-[var(--line)] px-3 py-2 text-sm font-medium text-[var(--ink)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSuggestingSettings ? "Suggesting..." : "Suggest settings from evidence"}
            </button>
          </div>
          <div className="grid gap-5 p-5">
            {frameDraft && frame.trim().length === 0 && (
              <FrameDraftBanner
                projectId={projectId}
                draft={frameDraft}
                generatedAt={frameDraftGeneratedAt}
                onAccepted={(frameText) => {
                  setFrame(frameText);
                  setFrameDraft(null);
                  setSettingsMessage("AI-proposed frame accepted.");
                }}
                onDiscarded={() => {
                  setFrameDraft(null);
                  setSettingsMessage("AI-proposed frame discarded.");
                }}
              />
            )}
            <section className="rounded-xl border border-[var(--line)] bg-[var(--bg)] p-4">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-[var(--ink)]">Research focus</h3>
                  <p className="mt-1 text-sm leading-6 text-[var(--ink-2)]">
                    The more context you add here, the smarter the system gets at sorting what matters.
                  </p>
                </div>
                {isSavingResearchContext && (
                  <span className="text-xs font-medium text-[var(--ink-faint)]">Saving...</span>
                )}
              </div>

              <div className="mt-5 grid gap-4 lg:grid-cols-2">
                <div>
                  <label className="mb-2 block text-sm font-medium text-[var(--ink)]" htmlFor="research-goals">
                    What are you trying to learn?
                  </label>
                  <textarea
                    id="research-goals"
                    rows={2}
                    value={researchContext.goals ?? ""}
                    onChange={(event) => updateResearchContextField("goals", event.target.value)}
                    onBlur={() => void saveResearchContext()}
                    placeholder="Why procurement teams switch away from spreadsheets"
                    className="w-full resize-y rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-[var(--ink)] outline-none transition-colors placeholder:text-[var(--ink-faint)] focus:border-[var(--accent)]"
                  />
                </div>
                <div>
                  <label className="mb-2 block text-sm font-medium text-[var(--ink)]" htmlFor="research-outcomes">
                    What decisions will this inform?
                  </label>
                  <textarea
                    id="research-outcomes"
                    rows={2}
                    value={researchContext.outcomes ?? ""}
                    onChange={(event) => updateResearchContextField("outcomes", event.target.value)}
                    onBlur={() => void saveResearchContext()}
                    placeholder="Go/no-go on building an approval workflow"
                    className="w-full resize-y rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-[var(--ink)] outline-none transition-colors placeholder:text-[var(--ink-faint)] focus:border-[var(--accent)]"
                  />
                </div>
                <div>
                  <label className="mb-2 block text-sm font-medium text-[var(--ink)]" htmlFor="research-buyers">
                    Who are you talking to?
                  </label>
                  <textarea
                    id="research-buyers"
                    rows={2}
                    value={researchContext.buyers ?? ""}
                    onChange={(event) => updateResearchContextField("buyers", event.target.value)}
                    onBlur={() => void saveResearchContext()}
                    placeholder="Procurement managers at mid-market manufacturing companies"
                    className="w-full resize-y rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-[var(--ink)] outline-none transition-colors placeholder:text-[var(--ink-faint)] focus:border-[var(--accent)]"
                  />
                </div>
                <div>
                  <label className="mb-2 block text-sm font-medium text-[var(--ink)]" htmlFor="research-scope-in">
                    What's in scope?
                  </label>
                  <textarea
                    id="research-scope-in"
                    rows={2}
                    value={researchContext.scope_in ?? ""}
                    onChange={(event) => updateResearchContextField("scope_in", event.target.value)}
                    onBlur={() => void saveResearchContext()}
                    placeholder="Workflow pain, approval bottlenecks, compliance requirements"
                    className="w-full resize-y rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-[var(--ink)] outline-none transition-colors placeholder:text-[var(--ink-faint)] focus:border-[var(--accent)]"
                  />
                </div>
                <div className="lg:col-span-2">
                  <label className="mb-2 block text-sm font-medium text-[var(--ink)]" htmlFor="research-scope-out">
                    What's out of scope?
                  </label>
                  <textarea
                    id="research-scope-out"
                    rows={2}
                    value={researchContext.scope_out ?? ""}
                    onChange={(event) => updateResearchContextField("scope_out", event.target.value)}
                    onBlur={() => void saveResearchContext()}
                    placeholder="IT infrastructure, ERP integrations, price sensitivity"
                    className="w-full resize-y rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-[var(--ink)] outline-none transition-colors placeholder:text-[var(--ink-faint)] focus:border-[var(--accent)]"
                  />
                </div>
              </div>

              <div className="mt-4">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <label className="block text-sm font-medium text-[var(--ink)]">Key questions</label>
                  <button
                    type="button"
                    onClick={addResearchQuestion}
                    className="rounded-lg border border-[var(--line)] px-2.5 py-1 text-xs font-medium text-[var(--ink-2)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]"
                  >
                    Add question
                  </button>
                </div>
                <div className="grid gap-2">
                  {(researchContext.research_questions && researchContext.research_questions.length > 0
                    ? researchContext.research_questions
                    : [""]
                  ).map((question, index) => (
                    <div key={index} className="flex gap-2">
                      <input
                        type="text"
                        value={question}
                        onChange={(event) => updateResearchQuestion(index, event.target.value)}
                        onBlur={() => void saveResearchContext()}
                        placeholder="What do we need answered?"
                        className="min-w-0 flex-1 rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--ink)] outline-none transition-colors placeholder:text-[var(--ink-faint)] focus:border-[var(--accent)]"
                      />
                      <button
                        type="button"
                        onClick={() => removeResearchQuestion(index)}
                        className="h-10 w-10 rounded-lg border border-[var(--line)] text-sm font-medium text-[var(--ink-2)] transition-colors hover:border-neg/40 hover:text-neg"
                        aria-label="Remove question"
                      >
                        x
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </section>

            <div>
              <label className="mb-2 block text-sm font-medium text-[var(--ink)]" htmlFor="frame">
                Project Frame
              </label>
              <textarea
                id="frame"
                rows={7}
                value={frame}
                onChange={(event) => setFrame(event.target.value)}
                className="w-full resize-y rounded-lg border border-[var(--line)] bg-[var(--bg)] px-3 py-2 text-[var(--ink)] outline-none transition-colors placeholder:text-[var(--ink-faint)] focus:border-[var(--accent)]"
              />
              <div className="mt-3">
                <button
                  type="button"
                  onClick={generateFrame}
                  disabled={isGeneratingFrame}
                  className="rounded-lg border border-[var(--line)] px-3 py-2 text-sm font-medium text-[var(--ink)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isGeneratingFrame ? "Generating..." : "Auto-generate frame"}
                </button>
              </div>
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium text-[var(--ink)]" htmlFor="operating-style">
                Operating Style
              </label>
              <textarea
                id="operating-style"
                rows={6}
                value={operatingStyle}
                onChange={(event) => setOperatingStyle(event.target.value)}
                className="w-full resize-y rounded-lg border border-[var(--line)] bg-[var(--bg)] px-3 py-2 text-[var(--ink)] outline-none transition-colors placeholder:text-[var(--ink-faint)] focus:border-[var(--accent)]"
              />
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium text-[var(--ink)]" htmlFor="gtm-context">
                GTM Context
              </label>
              <textarea
                id="gtm-context"
                rows={7}
                value={gtmContext}
                onChange={(event) => setGtmContext(event.target.value)}
                className="w-full resize-y rounded-lg border border-[var(--line)] bg-[var(--bg)] px-3 py-2 text-[var(--ink)] outline-none transition-colors placeholder:text-[var(--ink-faint)] focus:border-[var(--accent)]"
              />
            </div>
            {settingsError && (
              <div className="rounded-lg border border-neg/20 bg-neg-bg px-3 py-2 text-sm text-neg">
                {settingsError}
              </div>
            )}
            {settingsMessage && (
              <div className="rounded-lg border border-pos/20 bg-pos-bg px-3 py-2 text-sm text-pos">
                {settingsMessage}
              </div>
            )}
            <div className="flex justify-end">
              <button
                type="submit"
                disabled={isSaving}
                className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[var(--accent-hover)] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSaving ? "Saving..." : "Save settings"}
              </button>
            </div>
          </div>
      </form>
    </div>
  );
}
