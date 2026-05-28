import { createServiceClient } from "@/lib/supabase/server";
import {
  DEFAULT_LLM_PROVIDER,
  getProviderModelMap,
  isLLMProvider,
  type LLMProvider,
} from "./models";

const AI_PROVIDER_KEY = "ai_provider";
const CACHE_TTL_MS = 30_000;

type CachedProvider = {
  provider: LLMProvider;
  expiresAt: number;
};

let cachedProvider: CachedProvider | null = null;

export type AIProviderSettings = {
  provider: LLMProvider;
  default_provider: LLMProvider;
  configured: {
    anthropic: boolean;
    openai: boolean;
  };
  models: Record<string, string>;
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

function modelNames(provider: LLMProvider) {
  const map = getProviderModelMap(provider);
  return {
    cheap: map.cheap.model,
    standard: map.standard.model,
    premium: map.premium.model,
    eval: map.eval.model,
  };
}

function providerFromValue(value: unknown): LLMProvider | null {
  if (!value || typeof value !== "object") return null;
  const provider = (value as { provider?: unknown }).provider;
  return isLLMProvider(provider) ? provider : null;
}

export async function getAIProvider(): Promise<LLMProvider> {
  const now = Date.now();
  if (cachedProvider && cachedProvider.expiresAt > now) {
    return cachedProvider.provider;
  }

  const fallback = envDefaultProvider();

  try {
    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from("platform_settings")
      .select("value")
      .eq("key", AI_PROVIDER_KEY)
      .maybeSingle();

    const provider = error ? fallback : providerFromValue(data?.value) ?? fallback;
    cachedProvider = { provider, expiresAt: now + CACHE_TTL_MS };
    return provider;
  } catch {
    cachedProvider = { provider: fallback, expiresAt: now + CACHE_TTL_MS };
    return fallback;
  }
}

export async function getAIProviderSettings(): Promise<AIProviderSettings> {
  const fallback = envDefaultProvider();

  try {
    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from("platform_settings")
      .select("value")
      .eq("key", AI_PROVIDER_KEY)
      .maybeSingle();

    const provider = error ? fallback : providerFromValue(data?.value) ?? fallback;

    return {
      provider,
      default_provider: fallback,
      configured: configuredKeys(),
      models: modelNames(provider),
      source: error ? (fallback === DEFAULT_LLM_PROVIDER ? "default" : "environment") : "database",
    };
  } catch {
    return {
      provider: fallback,
      default_provider: fallback,
      configured: configuredKeys(),
      models: modelNames(fallback),
      source: fallback === DEFAULT_LLM_PROVIDER ? "default" : "environment",
    };
  }
}

export async function updateAIProvider(provider: LLMProvider, userId: string) {
  const supabase = createServiceClient();
  const updatedAt = new Date().toISOString();

  const { error } = await supabase
    .from("platform_settings")
    .upsert(
      {
        key: AI_PROVIDER_KEY,
        value: { provider },
        updated_by: userId,
        updated_at: updatedAt,
      },
      { onConflict: "key" }
    );

  if (error) throw new Error(error.message);
  cachedProvider = { provider, expiresAt: Date.now() + CACHE_TTL_MS };
}
