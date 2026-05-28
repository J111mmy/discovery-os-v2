"use client";

import { useState } from "react";
import type { AIProviderSettings } from "@/lib/llm/settings";
import type { LLMProvider } from "@/lib/llm/models";

const PROVIDER_LABELS: Record<LLMProvider, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
};

export function AIProviderSettingsPanel({
  initialSettings,
}: {
  initialSettings: AIProviderSettings;
}) {
  const [settings, setSettings] = useState(initialSettings);
  const [pendingProvider, setPendingProvider] = useState<LLMProvider>(
    initialSettings.provider
  );
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);

  const providerConfigured = settings.configured[pendingProvider];

  async function saveProvider() {
    setStatus("saving");
    setMessage(null);

    try {
      const response = await fetch("/api/admin/ai-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: pendingProvider }),
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.hint ? `${payload.error} ${payload.hint}` : payload.error);
      }

      setSettings(payload as AIProviderSettings);
      setPendingProvider((payload as AIProviderSettings).provider);
      setStatus("saved");
      setMessage(`AI generation now uses ${PROVIDER_LABELS[pendingProvider]}.`);
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "Could not update provider.");
    }
  }

  return (
    <section className="mb-8 rounded-xl border border-red-900/30 bg-red-950/20 p-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="text-xs font-bold uppercase tracking-wide text-red-300">
            Platform AI
          </div>
          <h2 className="mt-2 text-lg font-semibold text-[var(--ink)]">
            Generation provider
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--ink-muted)]">
            Super admin-only control for AI generation. Embeddings still use OpenAI for
            vector search compatibility.
          </p>
          <p className="mt-2 text-xs text-[var(--ink-faint)]">
            Current source: {settings.source}. Active provider:{" "}
            {PROVIDER_LABELS[settings.provider]}.
          </p>
        </div>

        <div className="w-full max-w-md rounded-xl border border-[var(--border)] bg-[var(--surface-1)] p-4">
          <div className="grid grid-cols-2 gap-2">
            {(["anthropic", "openai"] as LLMProvider[]).map((provider) => {
              const selected = pendingProvider === provider;
              const configured = settings.configured[provider];
              return (
                <button
                  key={provider}
                  type="button"
                  onClick={() => setPendingProvider(provider)}
                  className={`rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                    selected
                      ? "border-[var(--brand)] bg-[var(--brand)]/15 text-[var(--ink)]"
                      : "border-[var(--border)] text-[var(--ink-muted)] hover:border-[var(--brand)] hover:text-[var(--ink)]"
                  }`}
                >
                  <span className="block font-semibold">{PROVIDER_LABELS[provider]}</span>
                  <span className={configured ? "text-green-300" : "text-red-300"}>
                    {configured ? "API key configured" : "API key missing"}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="mt-4 rounded-lg border border-[var(--border)] bg-[var(--surface-0)] p-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-faint)]">
              Active model map
            </div>
            <dl className="mt-2 grid grid-cols-[80px_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
              {Object.entries(settings.models).map(([tier, model]) => (
                <div key={tier} className="contents">
                  <dt className="capitalize text-[var(--ink-muted)]">{tier}</dt>
                  <dd className="truncate text-[var(--ink)]" title={model}>
                    {model}
                  </dd>
                </div>
              ))}
            </dl>
          </div>

          {!providerConfigured && (
            <p className="mt-3 text-xs leading-5 text-red-300">
              Add the {pendingProvider === "openai" ? "OPENAI_API_KEY" : "ANTHROPIC_API_KEY"}{" "}
              environment variable before switching to this provider.
            </p>
          )}

          <button
            type="button"
            onClick={saveProvider}
            disabled={
              status === "saving" ||
              pendingProvider === settings.provider ||
              !providerConfigured
            }
            className="mt-4 w-full rounded-lg bg-[var(--brand)] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[var(--brand-dim)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {status === "saving" ? "Saving..." : `Use ${PROVIDER_LABELS[pendingProvider]}`}
          </button>

          {message && (
            <p
              className={`mt-3 text-sm ${
                status === "error" ? "text-red-300" : "text-green-300"
              }`}
            >
              {message}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
