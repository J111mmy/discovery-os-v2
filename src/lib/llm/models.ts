// LLM model abstraction — task_tier → actual model string
// Never hardcode model names outside this file.
// To swap a model: change it here. Every caller auto-updates.

import type { TaskTier } from "@/types/database";

export interface ModelConfig {
  provider: "anthropic" | "openai";
  model: string;
  maxTokens: number;
  temperature: number;
}

// Tier → model mapping — update here when upgrading models
const MODEL_MAP: Record<TaskTier, ModelConfig> = {
  // Fast, cheap: summaries, tag extraction, classification
  cheap: {
    provider: "anthropic",
    model: "claude-haiku-4-5-20251001",
    maxTokens: 1024,
    temperature: 0.2,
  },
  // Balanced: query rewriting, entity extraction
  standard: {
    provider: "anthropic",
    model: "claude-sonnet-4-6",
    maxTokens: 2048,
    temperature: 0.3,
  },
  // Best quality: compose drafts, persona synthesis, PRDs
  premium: {
    provider: "anthropic",
    model: "claude-opus-4-6",
    maxTokens: 6000,
    temperature: 0.7,
  },
  // Deterministic: eval scoring, claim verification
  eval: {
    provider: "anthropic",
    model: "claude-sonnet-4-6",
    maxTokens: 2048,
    temperature: 0.0,
  },
};

export function getModelConfig(tier: TaskTier): ModelConfig {
  return MODEL_MAP[tier];
}

// Embedding model — always fixed for pgvector compatibility
export const EMBEDDING_MODEL = "text-embedding-3-small";
export const EMBEDDING_DIMENSIONS = 1536;
