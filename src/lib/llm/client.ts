// LLM client — wraps Anthropic SDK with task_tier abstraction
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { EMBEDDING_MODEL } from "./models";
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

export type LLMTextBlock = {
  type: "text";
  text: string;
  cache_control?: { type: "ephemeral" };
};

type LLMMessageContent = string | LLMTextBlock[];

export interface LLMCallOptions {
  tier: TaskTier;
  system: string;
  messages: Array<{ role: "user" | "assistant"; content: LLMMessageContent }>;
  timeoutMs?: number;
  // Per-call temperature override. Falls back to the tier default when unset.
  // NOTE: inert on gpt-5*/o-series models — those reject `temperature`, so it is
  // never sent for them (see supportsOpenAITemperature). The override only takes
  // effect on Anthropic models and temperature-supporting OpenAI models.
  temperature?: number;
  // Per-call max-output-tokens override. Falls back to the tier default when unset.
  // Use this to raise the budget for callers prone to truncation (e.g. JSON list
  // outputs) without bumping the shared tier default for every other caller.
  maxTokens?: number;
}

export interface LLMCallResult {
  content: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
  estimatedCostUsd?: number;
}

function contentToText(content: LLMMessageContent) {
  if (typeof content === "string") return content;
  return content.map((block) => block.text).join("\n\n");
}

function modelPricingPerMillion(model: string) {
  const normalized = model.toLowerCase();

  if (normalized.includes("haiku")) {
    return { input: 0.8, output: 4, cacheWrite: 1, cacheRead: 0.08 };
  }

  if (normalized.includes("opus")) {
    return { input: 15, output: 75, cacheWrite: 18.75, cacheRead: 1.5 };
  }

  if (normalized.includes("sonnet") || normalized.includes("claude")) {
    return { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 };
  }

  if (normalized.includes("mini")) {
    return { input: 0.15, output: 0.6, cacheWrite: 0.15, cacheRead: 0.075 };
  }

  if (normalized.includes("gpt-4o")) {
    return { input: 2.5, output: 10, cacheWrite: 2.5, cacheRead: 1.25 };
  }

  if (normalized.includes("gpt-5")) {
    return { input: 1.25, output: 10, cacheWrite: 1.25, cacheRead: 0.125 };
  }

  return { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 };
}

export function estimateLLMCostUsd(input: {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens?: number | null;
  cacheReadInputTokens?: number | null;
}) {
  const pricing = modelPricingPerMillion(input.model);
  const cacheCreation = input.cacheCreationInputTokens ?? 0;
  const cacheRead = input.cacheReadInputTokens ?? 0;
  const total =
    (input.inputTokens / 1_000_000) * pricing.input +
    (input.outputTokens / 1_000_000) * pricing.output +
    (cacheCreation / 1_000_000) * pricing.cacheWrite +
    (cacheRead / 1_000_000) * pricing.cacheRead;

  return Number(total.toFixed(6));
}

type ProviderErrorDetails = {
  name?: unknown;
  status?: unknown;
  message?: unknown;
  type?: unknown;
  code?: unknown;
  param?: unknown;
  request_id?: unknown;
  error?: unknown;
  provider_body?: unknown;
};

type OpenAIUsageWithCache = NonNullable<
  OpenAI.Chat.Completions.ChatCompletion["usage"]
> & {
  prompt_tokens_details?: {
    cached_tokens?: number | null;
  } | null;
};

function parseProviderBodyFromMessage(message: unknown) {
  if (typeof message !== "string") return null;

  const jsonStart = message.indexOf("{");
  if (jsonStart === -1) return null;

  try {
    return JSON.parse(message.slice(jsonStart));
  } catch {
    return null;
  }
}

function providerErrorDetails(error: unknown): ProviderErrorDetails {
  if (!error || typeof error !== "object") {
    return { message: String(error) };
  }

  const value = error as Record<string, unknown>;
  const providerBody = value.error;
  const providerBodyFromMessage = parseProviderBodyFromMessage(value.message);
  const details: ProviderErrorDetails = {
    name: value.name,
    status: value.status,
    message: value.message,
    type: value.type,
    code: value.code,
    param: value.param,
    request_id:
      value.request_id ??
      value.requestId ??
      value["_request_id"] ??
      (providerBodyFromMessage &&
      typeof providerBodyFromMessage === "object" &&
      "request_id" in providerBodyFromMessage
        ? (providerBodyFromMessage as { request_id?: unknown }).request_id
        : undefined),
  };

  if (providerBody && typeof providerBody === "object") {
    const body = providerBody as Record<string, unknown>;
    details.error = {
      type: body.type,
      message: body.message,
      code: body.code,
      param: body.param,
    };
  } else if (providerBody) {
    details.error = providerBody;
  }

  if (providerBodyFromMessage) {
    details.provider_body = providerBodyFromMessage;
  }

  return details;
}

function providerErrorMessage(provider: string, error: unknown) {
  return `${provider} LLM request failed: ${JSON.stringify(providerErrorDetails(error))}`;
}

export async function callLLM(opts: LLMCallOptions): Promise<LLMCallResult> {
  const config = await getAIModelConfig(opts.tier);

  if (config.provider === "anthropic") {
    const request = {
      model: config.model,
      max_tokens: opts.maxTokens ?? config.maxTokens,
      temperature: opts.temperature ?? config.temperature,
      system: opts.system,
      messages: opts.messages,
    };

    // SECURITY INVARIANT A1: callLLM is text-in/text-out only.
    // Adding tools/tool_choice/function_call changes the prompt-injection threat model
    // and requires security review; see docs/security/SECURITY_POSTURE.md.
    let response: {
      content: Array<{ type: string; text?: string }>;
      usage: {
        input_tokens: number;
        output_tokens: number;
        cache_creation_input_tokens?: number | null;
        cache_read_input_tokens?: number | null;
      };
    };

    try {
      response = (await getAnthropic().messages.create(
        request as Parameters<ReturnType<typeof getAnthropic>["messages"]["create"]>[0],
        { timeout: opts.timeoutMs ?? 120_000 }
      )) as typeof response;
    } catch (error) {
      const message = providerErrorMessage("Anthropic", error);
      console.error(message);
      throw new Error(message);
    }

    const content =
      response.content[0]?.type === "text" ? response.content[0].text ?? "" : "";
    const cacheCreationInputTokens =
      "cache_creation_input_tokens" in response.usage
        ? response.usage.cache_creation_input_tokens ?? 0
        : 0;
    const cacheReadInputTokens =
      "cache_read_input_tokens" in response.usage
        ? response.usage.cache_read_input_tokens ?? 0
        : 0;

    return {
      content,
      model: config.model,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      cacheCreationInputTokens,
      cacheReadInputTokens,
      estimatedCostUsd: estimateLLMCostUsd({
        model: config.model,
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        cacheCreationInputTokens,
        cacheReadInputTokens,
      }),
    };
  }

  if (config.provider === "openai") {
    const messages = [
      { role: "system" as const, content: opts.system },
      ...opts.messages.map((message) => ({
        role: message.role,
        content: contentToText(message.content),
      })),
    ];

    // SECURITY INVARIANT A1: callLLM is text-in/text-out only.
    // Adding tools/tool_choice/function_call changes the prompt-injection threat model
    // and requires security review; see docs/security/SECURITY_POSTURE.md.
    const request: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming = {
      model: config.model,
      max_completion_tokens: opts.maxTokens ?? config.maxTokens,
      messages,
    };

    if (supportsOpenAITemperature(config.model)) {
      request.temperature = opts.temperature ?? config.temperature;
    }

    let response: OpenAI.Chat.Completions.ChatCompletion;

    try {
      response = await getOpenAI().chat.completions.create(
        request,
        { timeout: opts.timeoutMs ?? 120_000 }
      );
    } catch (error) {
      const message = providerErrorMessage("OpenAI", error);
      console.error(message);
      throw new Error(message);
    }

    const usage = response.usage as OpenAIUsageWithCache | undefined;
    const promptTokens = usage?.prompt_tokens ?? 0;
    const outputTokens = usage?.completion_tokens ?? 0;
    const cacheReadInputTokens =
      usage?.prompt_tokens_details?.cached_tokens ?? 0;
    // OpenAI's prompt_tokens includes cached tokens. Normalize to the same
    // shape Anthropic reports: inputTokens are uncached prompt tokens.
    const inputTokens = Math.max(promptTokens - cacheReadInputTokens, 0);

    return {
      content: response.choices[0]?.message?.content ?? "",
      model: config.model,
      inputTokens,
      outputTokens,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens,
      estimatedCostUsd: estimateLLMCostUsd({
        model: config.model,
        inputTokens,
        outputTokens,
        cacheReadInputTokens,
      }),
    };
  }

  throw new Error(`Provider ${config.provider} not yet implemented`);
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
