// LLM model abstraction — task_tier → actual model string
// Never hardcode model names outside this file.
// To swap a model: change it here. Every caller auto-updates.

import type { TaskTier } from "@/types/database";

export type LLMProvider = "anthropic" | "openai";

export const TASK_TIERS = ["cheap", "standard", "premium", "eval"] as const satisfies readonly TaskTier[];

export interface ModelConfig {
  provider: LLMProvider;
  model: string;
  maxTokens: number;
  temperature: number;
}

export interface TierModelRoute {
  provider: LLMProvider;
  model: string;
}

export type ModelRouting = Record<TaskTier, TierModelRoute>;

export type ModelChoice = {
  provider: LLMProvider;
  model: string;
  label: string;
  description: string;
};

export type TierDetail = {
  label: string;
  role: "work" | "review";
  description: string;
  examples: string;
};

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
      model: envModel("ANTHROPIC_PREMIUM_MODEL", "claude-sonnet-4-6"),
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
      model: envModel("OPENAI_STANDARD_MODEL", "gpt-5.4"),
      maxTokens: 2048,
      temperature: 0.3,
    },
    premium: {
      provider: "openai",
      model: envModel("OPENAI_PREMIUM_MODEL", "gpt-5.4"),
      maxTokens: 6000,
      temperature: 0.7,
    },
    eval: {
      provider: "openai",
      model: envModel("OPENAI_EVAL_MODEL", "gpt-5.4"),
      maxTokens: 2048,
      temperature: 0.0,
    },
  },
};

export const MODEL_CHOICES: Record<LLMProvider, ModelChoice[]> = {
  anthropic: [
    {
      provider: "anthropic",
      model: MODEL_MAP.anthropic.cheap.model,
      label: "Claude Haiku 4.5",
      description: "Low-cost classification, tagging, and small extraction jobs.",
    },
    {
      provider: "anthropic",
      model: MODEL_MAP.anthropic.standard.model,
      label: "Claude Sonnet 4.6",
      description: "Best default for research judgement, ingest, summaries, and writing.",
    },
    {
      provider: "anthropic",
      model: envModel("ANTHROPIC_OPUS_MODEL", "claude-opus-4-6"),
      label: "Claude Opus 4.6",
      description: "Highest Anthropic tier for rare, high-value synthesis jobs.",
    },
  ],
  openai: [
    {
      provider: "openai",
      model: envModel("OPENAI_CHEAP_MODEL", "gpt-4o-mini"),
      label: "GPT-4o mini",
      description: "Very low-cost fallback for lightweight OpenAI work.",
    },
    {
      provider: "openai",
      model: envModel("OPENAI_STANDARD_MODEL", "gpt-5.4"),
      label: "GPT-5.4",
      description: "Strong reasoning/value choice for verification and general OpenAI work.",
    },
    {
      provider: "openai",
      model: envModel("OPENAI_PREMIUM_FRONTIER_MODEL", "gpt-5.5"),
      label: "GPT-5.5",
      description: "Frontier OpenAI option for expensive, high-stakes synthesis or audits.",
    },
    {
      provider: "openai",
      model: envModel("OPENAI_LEGACY_MODEL", "gpt-4o"),
      label: "GPT-4o",
      description: "Legacy stable model; useful as a compatibility fallback.",
    },
  ],
};

export const TIER_DETAILS: Record<TaskTier, TierDetail> = {
  cheap: {
    label: "Cheap",
    role: "work",
    description: "Routine background tasks where speed and cost matter most.",
    examples: "Classification, tags, action extraction",
  },
  standard: {
    label: "Standard",
    role: "work",
    description: "Default research intelligence for the product.",
    examples: "Ingest, session reviews, entities, frame drafts",
  },
  premium: {
    label: "Premium",
    role: "work",
    description: "Higher-quality generation where prose and synthesis matter.",
    examples: "Compose drafts, project synthesis, problem discovery",
  },
  eval: {
    label: "Eval",
    role: "review",
    description: "Strict reviewer tier. It checks work; it is not the top creative tier.",
    examples: "Claim verification, citation checks, evidence grading",
  },
};

export const RECOMMENDED_MODEL_ROUTING: ModelRouting = {
  cheap: {
    provider: "anthropic",
    model: MODEL_MAP.anthropic.cheap.model,
  },
  standard: {
    provider: "anthropic",
    model: MODEL_MAP.anthropic.standard.model,
  },
  premium: {
    provider: "anthropic",
    model: MODEL_MAP.anthropic.premium.model,
  },
  eval: {
    provider: "openai",
    model: MODEL_MAP.openai.eval.model,
  },
};

export function isLLMProvider(value: unknown): value is LLMProvider {
  return value === "anthropic" || value === "openai";
}

export function getModelConfig(
  tier: TaskTier,
  provider: LLMProvider = DEFAULT_LLM_PROVIDER,
  model?: string
): ModelConfig {
  return {
    ...MODEL_MAP[provider][tier],
    model: model?.trim() || MODEL_MAP[provider][tier].model,
  };
}

export function getProviderModelMap(provider: LLMProvider) {
  return MODEL_MAP[provider];
}

export function getProviderRouting(provider: LLMProvider): ModelRouting {
  return {
    cheap: { provider, model: MODEL_MAP[provider].cheap.model },
    standard: { provider, model: MODEL_MAP[provider].standard.model },
    premium: { provider, model: MODEL_MAP[provider].premium.model },
    eval: { provider, model: MODEL_MAP[provider].eval.model },
  };
}

export function isTaskTier(value: unknown): value is TaskTier {
  return TASK_TIERS.includes(value as TaskTier);
}

// Embedding model — always fixed for pgvector compatibility
export const EMBEDDING_MODEL = "text-embedding-3-small";
export const EMBEDDING_DIMENSIONS = 1536;
