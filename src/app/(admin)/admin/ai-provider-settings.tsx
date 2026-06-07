"use client";

import { useMemo, useState } from "react";
import type { AIProviderSettings } from "@/lib/llm/settings";
import type { LLMProvider, ModelRouting, TierModelRoute } from "@/lib/llm/models";
import type { TaskTier } from "@/types/database";

const PROVIDER_LABELS: Record<LLMProvider, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
};

const WORK_TIERS: TaskTier[] = ["cheap", "standard", "premium"];
const REVIEW_TIERS: TaskTier[] = ["eval"];
const TIERS: TaskTier[] = [...WORK_TIERS, ...REVIEW_TIERS];

function sameRouting(a: ModelRouting, b: ModelRouting) {
  return TIERS.every(
    (tier) => a[tier].provider === b[tier].provider && a[tier].model === b[tier].model
  );
}

function routeLabel(route: TierModelRoute) {
  return `${PROVIDER_LABELS[route.provider]} · ${route.model}`;
}

export function AIProviderSettingsPanel({
  initialSettings,
}: {
  initialSettings: AIProviderSettings;
}) {
  const [settings, setSettings] = useState(initialSettings);
  const [routes, setRoutes] = useState<ModelRouting>(initialSettings.routes);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);

  const missingProviders = useMemo(() => {
    const providers = Array.from(new Set(TIERS.map((tier) => routes[tier].provider)));
    return providers.filter((provider) => !settings.configured[provider]);
  }, [routes, settings.configured]);

  const dirty = !sameRouting(routes, settings.routes);
  const recommendedActive = sameRouting(routes, settings.recommended_routes);

  function updateRoute(tier: TaskTier, next: Partial<TierModelRoute>) {
    setStatus("idle");
    setMessage(null);
    setRoutes((current) => {
      const provider = next.provider ?? current[tier].provider;
      const choices = settings.choices[provider];
      const providerChanged = next.provider && next.provider !== current[tier].provider;
      const defaultModel = settings.provider_routes[provider][tier].model;
      const currentModelStillValid = choices.some((choice) => choice.model === current[tier].model);
      const model =
        next.model ??
        (providerChanged
          ? defaultModel
          : currentModelStillValid
          ? current[tier].model
          : defaultModel);

      return {
        ...current,
        [tier]: { provider, model },
      };
    });
  }

  async function patchSettings(body: Record<string, unknown>, successMessage: string) {
    setStatus("saving");
    setMessage(null);

    try {
      const response = await fetch("/api/admin/ai-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.hint ? `${payload.error} ${payload.hint}` : payload.error);
      }

      const nextSettings = payload as AIProviderSettings;
      setSettings(nextSettings);
      setRoutes(nextSettings.routes);
      setStatus("saved");
      setMessage(successMessage);
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "Could not update model routing.");
    }
  }

  function saveRoutes() {
    void patchSettings(
      { routes },
      `Model routing saved. Eval now uses ${routeLabel(routes.eval)}.`
    );
  }

  function applyRecommended() {
    void patchSettings(
      { use_recommended: true },
      "Recommended split applied: Anthropic for work tiers, OpenAI for eval."
    );
  }

  return (
    <section className="mb-8 rounded-xl border border-red-900/30 bg-red-950/20 p-5">
      <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="text-xs font-bold uppercase tracking-wide text-red-300">
            Platform AI
          </div>
          <h2 className="mt-2 text-lg font-semibold text-[var(--ink)]">
            Model routing
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--ink-2)]">
            Choose the model for each job type. Cheap, standard, and premium create or
            transform work. Eval is the reviewer lane: strict checks for evidence,
            citations, and unsupported claims.
          </p>
          <div className="mt-3 flex flex-wrap gap-2 text-xs">
            <span className="rounded-full border border-[var(--line)] bg-[var(--surface)] px-2.5 py-1 text-[var(--ink-2)]">
              Source: {settings.source}
            </span>
            <span className="rounded-full border border-[var(--line)] bg-[var(--surface)] px-2.5 py-1 text-[var(--ink-2)]">
              Standard: {routeLabel(routes.standard)}
            </span>
            <span className="rounded-full border border-[var(--line)] bg-[var(--surface)] px-2.5 py-1 text-[var(--ink-2)]">
              Eval: {routeLabel(routes.eval)}
            </span>
          </div>
        </div>

        <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
          <button
            type="button"
            onClick={applyRecommended}
            disabled={status === "saving" || recommendedActive}
            className="rounded-lg border border-[var(--accent)] px-4 py-2 text-sm font-medium text-[var(--accent)] transition-colors hover:bg-[var(--accent)] hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            Use recommended split
          </button>
          <button
            type="button"
            onClick={saveRoutes}
            disabled={status === "saving" || !dirty || missingProviders.length > 0}
            className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[var(--accent-hover)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {status === "saving" ? "Saving..." : "Save routing"}
          </button>
        </div>
      </div>

      <div className="grid gap-3 xl:grid-cols-2">
        {TIERS.map((tier) => {
          const detail = settings.tier_details[tier];
          const route = routes[tier];
          const providerConfigured = settings.configured[route.provider];
          const choices = settings.choices[route.provider];

          return (
            <article
              key={tier}
              className={`rounded-xl border bg-[var(--surface)] p-4 ${
                detail.role === "review"
                  ? "border-yellow-500/25"
                  : "border-[var(--line)]"
              }`}
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-sm font-semibold text-[var(--ink)]">
                      {detail.label}
                    </h3>
                    <span
                      className={`rounded-full border px-2 py-0.5 text-xs font-medium ${
                        detail.role === "review"
                          ? "border-yellow-500/20 bg-yellow-500/10 text-yellow-300"
                          : "border-[var(--line)] bg-[var(--bg)] text-[var(--ink-2)]"
                      }`}
                    >
                      {detail.role === "review" ? "Reviewer tier" : "Work tier"}
                    </span>
                  </div>
                  <p className="mt-2 text-sm leading-6 text-[var(--ink-2)]">
                    {detail.description}
                  </p>
                  <p className="mt-1 text-xs text-[var(--ink-faint)]">
                    {detail.examples}
                  </p>
                </div>

                <div
                  className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${
                    providerConfigured
                      ? "bg-green-500/10 text-green-300"
                      : "bg-red-500/10 text-red-300"
                  }`}
                >
                  {providerConfigured ? "API key ready" : "API key missing"}
                </div>
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-[170px_minmax(0,1fr)]">
                <div>
                  <label className="mb-1 block text-xs font-medium text-[var(--ink-2)]">
                    Provider
                  </label>
                  <div className="grid grid-cols-2 gap-1 rounded-lg border border-[var(--line)] bg-[var(--bg)] p-1">
                    {(["anthropic", "openai"] as LLMProvider[]).map((provider) => {
                      const selected = route.provider === provider;
                      return (
                        <button
                          key={provider}
                          type="button"
                          onClick={() => updateRoute(tier, { provider })}
                          className={`rounded-md px-2 py-1.5 text-xs font-medium transition-colors ${
                            selected
                              ? "bg-[var(--accent)] text-white"
                              : "text-[var(--ink-2)] hover:text-[var(--ink)]"
                          }`}
                        >
                          {PROVIDER_LABELS[provider]}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <label htmlFor={`model-${tier}`} className="mb-1 block text-xs font-medium text-[var(--ink-2)]">
                    Model
                  </label>
                  <select
                    id={`model-${tier}`}
                    value={route.model}
                    onChange={(event) => updateRoute(tier, { model: event.target.value })}
                    className="w-full rounded-lg border border-[var(--line)] bg-[var(--bg)] px-3 py-2 text-sm text-[var(--ink)] outline-none transition-colors focus:border-[var(--accent)]"
                  >
                    {!choices.some((choice) => choice.model === route.model) && (
                      <option value={route.model}>{route.model}</option>
                    )}
                    {choices.map((choice) => (
                      <option key={`${choice.provider}-${choice.model}`} value={choice.model}>
                        {choice.label} · {choice.model}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <p className="mt-3 text-xs leading-5 text-[var(--ink-faint)]">
                {choices.find((choice) => choice.model === route.model)?.description ??
                  "Custom model from the saved platform configuration."}
              </p>
            </article>
          );
        })}
      </div>

      {missingProviders.length > 0 && (
        <p className="mt-4 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          Add {missingProviders.map((provider) => PROVIDER_LABELS[provider]).join(" and ")} API
          keys before saving this routing.
        </p>
      )}

      {message && (
        <p
          className={`mt-4 text-sm ${
            status === "error" ? "text-red-300" : "text-green-300"
          }`}
        >
          {message}
        </p>
      )}
    </section>
  );
}
