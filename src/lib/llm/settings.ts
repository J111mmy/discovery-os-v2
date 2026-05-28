import { createServiceClient } from "@/lib/supabase/server";
import type { TaskTier } from "@/types/database";
import {
  DEFAULT_LLM_PROVIDER,
  MODEL_CHOICES,
  RECOMMENDED_MODEL_ROUTING,
  TASK_TIERS,
  TIER_DETAILS,
  getModelConfig,
  getProviderModelMap,
  getProviderRouting,
  isLLMProvider,
  isTaskTier,
  type LLMProvider,
  type ModelChoice,
  type ModelConfig,
  type ModelRouting,
  type TierModelRoute,
} from "./models";

const AI_PROVIDER_KEY = "ai_provider";
const CACHE_TTL_MS = 30_000;

type CachedSettings = {
  settings: AIProviderSettings;
  expiresAt: number;
};

let cachedSettings: CachedSettings | null = null;

export type AIProviderSettings = {
  provider: LLMProvider;
  default_provider: LLMProvider;
  configured: {
    anthropic: boolean;
    openai: boolean;
  };
  routes: ModelRouting;
  recommended_routes: ModelRouting;
  provider_routes: Record<LLMProvider, ModelRouting>;
  models: Record<TaskTier, string>;
  choices: Record<LLMProvider, ModelChoice[]>;
  tier_details: typeof TIER_DETAILS;
  source: "database" | "environment" | "default";
};

function envDefaultProvider(): LLMProvider {
  const value = process.env.LLM_PROVIDER ?? process.env.AI_PROVIDER;
  return isLLMProvider(value) ? value : DEFAULT_LLM_PROVIDER;
}

function configuredKeys() {
  return {
    anthropic: Boolean(process.env.ANTHROPIC_API_KEY),
    openai: Boolean(process.env.OPENAI_API_KEY),
  };
}

function modelNames(routes: ModelRouting) {
  return TASK_TIERS.reduce(
    (acc, tier) => {
      acc[tier] = routes[tier].model;
      return acc;
    },
    {} as Record<TaskTier, string>
  );
}

function providerFromValue(value: unknown): LLMProvider | null {
  if (!value || typeof value !== "object") return null;
  const provider = (value as { provider?: unknown }).provider;
  return isLLMProvider(provider) ? provider : null;
}

function routeFromValue(value: unknown): TierModelRoute | null {
  if (!value || typeof value !== "object") return null;
  const route = value as { provider?: unknown; model?: unknown };

  if (!isLLMProvider(route.provider)) return null;
  if (typeof route.model !== "string" || !route.model.trim()) return null;

  return {
    provider: route.provider,
    model: route.model.trim(),
  };
}

function routesFromValue(value: unknown, fallbackProvider: LLMProvider): ModelRouting {
  const fallback = getProviderRouting(fallbackProvider);
  if (!value || typeof value !== "object") return fallback;

  const rawRoutes = (value as { routes?: unknown }).routes;
  if (!rawRoutes || typeof rawRoutes !== "object") return fallback;

  return TASK_TIERS.reduce(
    (acc, tier) => {
      const route = routeFromValue((rawRoutes as Record<string, unknown>)[tier]);
      acc[tier] = route ?? fallback[tier];
      return acc;
    },
    {} as ModelRouting
  );
}

function settingsFromValue(
  value: unknown,
  source: AIProviderSettings["source"],
  fallback: LLMProvider
): AIProviderSettings {
  const provider = providerFromValue(value) ?? fallback;
  const routes = routesFromValue(value, provider);

  return {
    provider,
    default_provider: fallback,
    configured: configuredKeys(),
    routes,
    recommended_routes: RECOMMENDED_MODEL_ROUTING,
    provider_routes: {
      anthropic: getProviderRouting("anthropic"),
      openai: getProviderRouting("openai"),
    },
    models: modelNames(routes),
    choices: MODEL_CHOICES,
    tier_details: TIER_DETAILS,
    source,
  };
}

async function loadAISettings(): Promise<AIProviderSettings> {
  const now = Date.now();
  if (cachedSettings && cachedSettings.expiresAt > now) {
    return cachedSettings.settings;
  }

  const fallback = envDefaultProvider();

  try {
    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from("platform_settings")
      .select("value")
      .eq("key", AI_PROVIDER_KEY)
      .maybeSingle();

    const source: AIProviderSettings["source"] = error
      ? fallback === DEFAULT_LLM_PROVIDER
        ? "default"
        : "environment"
      : "database";
    const settings = settingsFromValue(error ? null : data?.value, source, fallback);
    cachedSettings = { settings, expiresAt: now + CACHE_TTL_MS };
    return settings;
  } catch {
    const settings = settingsFromValue(
      null,
      fallback === DEFAULT_LLM_PROVIDER ? "default" : "environment",
      fallback
    );
    cachedSettings = { settings, expiresAt: now + CACHE_TTL_MS };
    return settings;
  }
}

export async function getAIProvider(): Promise<LLMProvider> {
  const settings = await loadAISettings();
  return settings.provider;
}

export async function getAIModelConfig(tier: TaskTier): Promise<ModelConfig> {
  const settings = await loadAISettings();
  const route = settings.routes[tier];
  return getModelConfig(tier, route.provider, route.model);
}

export async function getAIProviderSettings(): Promise<AIProviderSettings> {
  return loadAISettings();
}

export function normalizeModelRouting(value: unknown, fallbackProvider = envDefaultProvider()) {
  return routesFromValue({ routes: value }, fallbackProvider);
}

export function validateModelRouting(value: unknown): ModelRouting | null {
  if (!value || typeof value !== "object") return null;

  const candidate = value as Record<string, unknown>;
  const routes = {} as ModelRouting;

  for (const tier of TASK_TIERS) {
    if (!isTaskTier(tier)) return null;
    const route = routeFromValue(candidate[tier]);
    if (!route) return null;
    routes[tier] = route;
  }

  return routes;
}

export function providerRoutes(provider: LLMProvider) {
  return getProviderModelMap(provider);
}

export async function updateAIProvider(provider: LLMProvider, userId: string) {
  await updateAIModelRouting(getProviderRouting(provider), userId);
}

export async function updateAIModelRouting(routes: ModelRouting, userId: string) {
  const supabase = createServiceClient();
  const updatedAt = new Date().toISOString();

  const { error } = await supabase
    .from("platform_settings")
    .upsert(
      {
        key: AI_PROVIDER_KEY,
        value: {
          provider: routes.standard.provider,
          routes,
        },
        updated_by: userId,
        updated_at: updatedAt,
      },
      { onConflict: "key" }
    );

  if (error) throw new Error(error.message);
  cachedSettings = null;
}
