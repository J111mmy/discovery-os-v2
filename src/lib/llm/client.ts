// LLM client — wraps Anthropic SDK with task_tier abstraction
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import {
  EMBEDDING_MODEL,
  getModelConfig,
  type LLMProvider,
  type ModelConfig,
} from "./models";
import { getAIModelConfig } from "./settings";
import type { TaskTier } from "@/types/database";

let _anthropic: Anthropic | null = null;
let _openai: OpenAI | null = null;

function getAnthropic(): Anthropic {
  if (!_anthropic) {
    _anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
  }
  return _anthropic;
}

function getOpenAI(): OpenAI {
  if (!_openai) {
    _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });
  }
  return _openai;
}

function supportsOpenAITemperature(model: string) {
  const normalized = model.toLowerCase();
  return !(
    normalized.startsWith("gpt-5") ||
    normalized.startsWith("o1") ||
    normalized.startsWith("o3") ||
    normalized.startsWith("o4")
  );
}

export interface LLMCallOptions {
  tier: TaskTier;
  system: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  timeoutMs?: number;
}

export interface LLMCallResult {
  content: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

function isConfigured(provider: LLMProvider) {
  return provider === "anthropic"
    ? Boolean(process.env.ANTHROPIC_API_KEY)
    : Boolean(process.env.OPENAI_API_KEY);
}

function alternateProvider(provider: LLMProvider): LLMProvider {
  return provider === "anthropic" ? "openai" : "anthropic";
}

function errorStatus(error: unknown) {
  if (!error || typeof error !== "object") return null;
  const candidate = error as { status?: unknown; code?: unknown };
  if (typeof candidate.status === "number") return candidate.status;
  if (typeof candidate.code === "number") return candidate.code;
  return null;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function isProviderAvailabilityError(error: unknown) {
  const status = errorStatus(error);
  if (status === 429 || (status !== null && status >= 500 && status <= 504)) return true;

  const message = errorMessage(error).toLowerCase();
  return (
    message.includes("quota") ||
    message.includes("rate limit") ||
    message.includes("billing") ||
    message.includes("overloaded") ||
    message.includes("capacity") ||
    message.includes("api key") ||
    message.includes("not configured") ||
    message.includes("missing")
  );
}

async function callLLMWithConfig(
  opts: LLMCallOptions,
  config: ModelConfig
): Promise<LLMCallResult> {
  if (config.provider === "anthropic") {
    // SECURITY INVARIANT A1: callLLM is text-in/text-out only.
    // Adding tools/tool_choice/function_call changes the prompt-injection threat model
    // and requires security review; see docs/security/SECURITY_POSTURE.md.
    const response = await getAnthropic().messages.create(
      {
        model: config.model,
        max_tokens: config.maxTokens,
        temperature: config.temperature,
        system: opts.system,
        messages: opts.messages,
      },
      { timeout: opts.timeoutMs ?? 120_000 }
    );

    const content =
      response.content[0]?.type === "text" ? response.content[0].text : "";

    return {
      content,
      model: config.model,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    };
  }

  if (config.provider === "openai") {
    const messages = [
      { role: "system" as const, content: opts.system },
      ...opts.messages.map((message) => ({
        role: message.role,
        content: message.content,
      })),
    ];

    // SECURITY INVARIANT A1: callLLM is text-in/text-out only.
    // Adding tools/tool_choice/function_call changes the prompt-injection threat model
    // and requires security review; see docs/security/SECURITY_POSTURE.md.
    const request: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming = {
      model: config.model,
      max_completion_tokens: config.maxTokens,
      messages,
    };

    if (supportsOpenAITemperature(config.model)) {
      request.temperature = config.temperature;
    }

    const response = await getOpenAI().chat.completions.create(
      request,
      { timeout: opts.timeoutMs ?? 120_000 }
    );

    return {
      content: response.choices[0]?.message?.content ?? "",
      model: config.model,
      inputTokens: response.usage?.prompt_tokens ?? 0,
      outputTokens: response.usage?.completion_tokens ?? 0,
    };
  }

  throw new Error(`Provider ${config.provider} not yet implemented`);
}

export async function callLLM(opts: LLMCallOptions): Promise<LLMCallResult> {
  const config = await getAIModelConfig(opts.tier);

  try {
    return await callLLMWithConfig(opts, config);
  } catch (error) {
    const fallbackProvider = alternateProvider(config.provider);

    if (!isProviderAvailabilityError(error)) {
      throw error;
    }

    if (!isConfigured(fallbackProvider)) {
      throw new Error(
        `The selected AI provider (${config.provider}) is out of quota, rate-limited, missing credentials, or temporarily unavailable. Switch AI routing to ${fallbackProvider} or update the provider billing/quota.`
      );
    }

    const fallbackConfig = getModelConfig(opts.tier, fallbackProvider);

    try {
      return await callLLMWithConfig(opts, fallbackConfig);
    } catch (fallbackError) {
      if (isProviderAvailabilityError(fallbackError)) {
        throw new Error(
          `All configured AI providers are out of quota, rate-limited, or temporarily unavailable. Primary ${config.provider}: ${errorMessage(
            error
          )}. Fallback ${fallbackProvider}: ${errorMessage(fallbackError)}.`
        );
      }

      throw fallbackError;
    }
  }
}

// Embed a single string — always uses text-embedding-3-small via OpenAI
export async function embed(text: string): Promise<number[]> {
  const response = await getOpenAI().embeddings.create({
    model: EMBEDDING_MODEL,
    input: text.slice(0, 8000), // hard cap for safety
  });
  return response.data[0].embedding;
}

// Embed a batch of strings
export async function embedBatch(texts: string[]): Promise<number[][]> {
  const response = await getOpenAI().embeddings.create({
    model: EMBEDDING_MODEL,
    input: texts.map((t) => t.slice(0, 8000)),
  });
  return response.data
    .sort((a, b) => a.index - b.index)
    .map((d) => d.embedding);
}
