// LLM model abstraction — task_tier → actual model string
// Never hardcode model names outside this file.
// To swap a model: change it here. Every caller auto-updates.

import type { TaskTier } from "@/types/database";

export type LLMProvider = "anthropic" | "openai";

export interface ModelConfig {
  provider: LLMProvider;
  model: string;
  maxTokens: number;
  temperature: number;
}

export const DEFAULT_LLM_PROVIDER: LLMProvider = "anthropic";

function envModel(name: string, fallback: string) {
  return process.env[name]?.trim() || fallback;
}

// Provider + tier → model mapping — update here when upgrading models.
// Env overrides let production switch model IDs without a code deploy.
const MODEL_MAP: Record<LLMProvider, Record<TaskTier, ModelConfig>> = {
  anthropic: {
    // Fast, cheap: summaries, tag extraction, classification
    cheap: {
      provider: "anthropic",
      model: envModel("ANTHROPIC_CHEAP_MODEL", "claude-haiku-4-5-20251001"),
      maxTokens: 1024,
      temperature: 0.2,
    },
    // Balanced: query rewriting, entity extraction
    standard: {
      provider: "anthropic",
      model: envModel("ANTHROPIC_STANDARD_MODEL", "claude-sonnet-4-6"),
      maxTokens: 2048,
      temperature: 0.3,
    },
    // Best quality: compose drafts, persona synthesis, PRDs
    premium: {
      provider: "anthropic",
      model: envModel("ANTHROPIC_PREMIUM_MODEL", "claude-opus-4-6"),
      maxTokens: 6000,
      temperature: 0.7,
    },
    // Deterministic: eval scoring, claim verification
    eval: {
      provider: "anthropic",
      model: envModel("ANTHROPIC_EVAL_MODEL", "claude-sonnet-4-6"),
      maxTokens: 2048,
      temperature: 0.0,
    },
  },
  openai: {
    cheap: {
      provider: "openai",
      model: envModel("OPENAI_CHEAP_MODEL", "gpt-4o-mini"),
      maxTokens: 1024,
      temperature: 0.2,
    },
    standard: {
      provider: "openai",
      model: envModel("OPENAI_STANDARD_MODEL", "gpt-4o"),
      maxTokens: 2048,
      temperature: 0.3,
    },
    premium: {
      provider: "openai",
      model: envModel("OPENAI_PREMIUM_MODEL", "gpt-4o"),
      maxTokens: 6000,
      temperature: 0.7,
    },
    eval: {
      provider: "openai",
      model: envModel("OPENAI_EVAL_MODEL", "gpt-4o"),
      maxTokens: 2048,
      temperature: 0.0,
    },
  },
};

export function isLLMProvider(value: unknown): value is LLMProvider {
  return value === "anthropic" || value === "openai";
}

export function getModelConfig(
  tier: TaskTier,
  provider: LLMProvider = DEFAULT_LLM_PROVIDER
): ModelConfig {
  return MODEL_MAP[provider][tier];
}

export function getProviderModelMap(provider: LLMProvider) {
  return MODEL_MAP[provider];
}

// Embedding model — always fixed for pgvector compatibility
export const EMBEDDING_MODEL = "text-embedding-3-small";
export const EMBEDDING_DIMENSIONS = 1536;
