// LLM client — wraps Anthropic SDK with task_tier abstraction
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { createServiceClient } from "@/lib/supabase/server";
import { EMBEDDING_MODEL } from "./models";
import { appendUserFacingStyleRules } from "./prompts/style";
import { getAIModelConfig } from "./settings";
import type { TaskTier } from "@/types/database";

let _anthropic: Anthropic | null = null;
let _openai: OpenAI | null = null;

function getAnthropic(): Anthropic {
  if (!_anthropic) {
    _anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY!,
      maxRetries: 0,
    });
  }
  return _anthropic;
}

function getOpenAI(): OpenAI {
  if (!_openai) {
    _openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY!,
      maxRetries: 0,
    });
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
  telemetry?: LLMTelemetryContext;
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

export type LLMDeltaHandler = (delta: string) => void;

export type LLMTelemetryContext = {
  orgId: string;
  projectId?: string | null;
  artifactId?: string | null;
  agentRunId?: string | null;
  agentType: string;
  step: string;
};

function contentToText(content: LLMMessageContent) {
  if (typeof content === "string") return content;
  return content.map((block) => block.text).join("\n\n");
}

export const LLM_PRICING_VERSION = "2026-06-23.v1";

const MODEL_PRICING_PER_MILLION_USD = {
  anthropic_haiku_3_5: { input: 0.8, output: 4, cacheWrite: 1, cacheRead: 0.08 },
  anthropic_haiku_4_5: { input: 1, output: 5, cacheWrite: 1.25, cacheRead: 0.1 },
  anthropic_sonnet: { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 },
  anthropic_opus_current: { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 },
  anthropic_opus_legacy: { input: 15, output: 75, cacheWrite: 18.75, cacheRead: 1.5 },
  openai_mini: { input: 0.15, output: 0.6, cacheWrite: 0.15, cacheRead: 0.075 },
  openai_gpt4o: { input: 2.5, output: 10, cacheWrite: 2.5, cacheRead: 1.25 },
  openai_gpt54_mini: { input: 0.75, output: 4.5, cacheWrite: 0.75, cacheRead: 0.075 },
  openai_gpt54: { input: 2.5, output: 15, cacheWrite: 2.5, cacheRead: 0.25 },
  openai_gpt55: { input: 5, output: 30, cacheWrite: 5, cacheRead: 0.5 },
  openai_gpt5: { input: 1.25, output: 10, cacheWrite: 1.25, cacheRead: 0.125 },
  default_standard: { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 },
} as const;

function modelPricingPerMillion(model: string) {
  const normalized = model.toLowerCase();

  if (normalized.includes("haiku-4-5") || normalized.includes("haiku-4.5")) {
    return MODEL_PRICING_PER_MILLION_USD.anthropic_haiku_4_5;
  }

  if (normalized.includes("haiku")) {
    return MODEL_PRICING_PER_MILLION_USD.anthropic_haiku_3_5;
  }

  if (normalized.includes("opus")) {
    if (
      normalized.includes("opus-4-5") ||
      normalized.includes("opus-4-6") ||
      normalized.includes("opus-4-7") ||
      normalized.includes("opus-4-8")
    ) {
      return MODEL_PRICING_PER_MILLION_USD.anthropic_opus_current;
    }
    return MODEL_PRICING_PER_MILLION_USD.anthropic_opus_legacy;
  }

  if (normalized.includes("sonnet") || normalized.includes("claude")) {
    return MODEL_PRICING_PER_MILLION_USD.anthropic_sonnet;
  }

  if (normalized.includes("gpt-5.5")) {
    return MODEL_PRICING_PER_MILLION_USD.openai_gpt55;
  }

  if (normalized.includes("gpt-5.4") && normalized.includes("mini")) {
    return MODEL_PRICING_PER_MILLION_USD.openai_gpt54_mini;
  }

  if (normalized.includes("gpt-5.4")) {
    return MODEL_PRICING_PER_MILLION_USD.openai_gpt54;
  }

  if (normalized.includes("gpt-4o-mini")) {
    return MODEL_PRICING_PER_MILLION_USD.openai_mini;
  }

  if (normalized.includes("gpt-4o")) {
    return MODEL_PRICING_PER_MILLION_USD.openai_gpt4o;
  }

  if (normalized.includes("gpt-5")) {
    return MODEL_PRICING_PER_MILLION_USD.openai_gpt5;
  }

  if (normalized.includes("mini")) {
    return MODEL_PRICING_PER_MILLION_USD.openai_mini;
  }

  return MODEL_PRICING_PER_MILLION_USD.default_standard;
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

async function recordLLMCostEvent(input: {
  telemetry: LLMTelemetryContext | undefined;
  provider: "anthropic" | "openai";
  model: string;
  tier: TaskTier;
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens?: number | null;
  cacheReadInputTokens?: number | null;
  estimatedCostUsd?: number | null;
}) {
  if (!input.telemetry) return;

  if (!input.telemetry.orgId) {
    console.error("[llm-cost] missing orgId; cost event not recorded", {
      agentType: input.telemetry.agentType,
      step: input.telemetry.step,
      model: input.model,
    });
    return;
  }

  try {
    const supabase = createServiceClient();
    const { error } = await supabase.from("llm_cost_events").insert({
      org_id: input.telemetry.orgId,
      project_id: input.telemetry.projectId ?? null,
      artifact_id: input.telemetry.artifactId ?? null,
      agent_run_id: input.telemetry.agentRunId ?? null,
      agent_type: input.telemetry.agentType,
      step: input.telemetry.step,
      provider: input.provider,
      model: input.model,
      tier: input.tier,
      input_tokens: input.inputTokens,
      output_tokens: input.outputTokens,
      cache_write_tokens: input.cacheCreationInputTokens ?? 0,
      cache_read_tokens: input.cacheReadInputTokens ?? 0,
      estimated_usd: input.estimatedCostUsd ?? 0,
      pricing_version: LLM_PRICING_VERSION,
    });

    if (error) {
      console.error("[llm-cost] failed to record cost event", {
        message: error.message,
        agentType: input.telemetry.agentType,
        step: input.telemetry.step,
        model: input.model,
      });
    }
  } catch (error) {
    console.error("[llm-cost] failed to record cost event", error);
  }
}

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
  const systemPrompt = appendUserFacingStyleRules(opts.system);

  if (config.provider === "anthropic") {
    const request = {
      model: config.model,
      max_tokens: opts.maxTokens ?? config.maxTokens,
      temperature: opts.temperature ?? config.temperature,
      system: systemPrompt,
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

    const result = {
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
    await recordLLMCostEvent({
      telemetry: opts.telemetry,
      provider: config.provider,
      model: result.model,
      tier: opts.tier,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      cacheCreationInputTokens: result.cacheCreationInputTokens,
      cacheReadInputTokens: result.cacheReadInputTokens,
      estimatedCostUsd: result.estimatedCostUsd,
    });
    return result;
  }

  if (config.provider === "openai") {
    const messages = [
      { role: "system" as const, content: systemPrompt },
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

    const result = {
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
    await recordLLMCostEvent({
      telemetry: opts.telemetry,
      provider: config.provider,
      model: result.model,
      tier: opts.tier,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      cacheCreationInputTokens: result.cacheCreationInputTokens,
      cacheReadInputTokens: result.cacheReadInputTokens,
      estimatedCostUsd: result.estimatedCostUsd,
    });
    return result;
  }

  throw new Error(`Provider ${config.provider} not yet implemented`);
}

export async function streamLLM(
  opts: LLMCallOptions,
  onDelta: LLMDeltaHandler
): Promise<LLMCallResult> {
  const config = await getAIModelConfig(opts.tier);
  const systemPrompt = appendUserFacingStyleRules(opts.system);

  if (config.provider === "anthropic") {
    const request = {
      model: config.model,
      max_tokens: opts.maxTokens ?? config.maxTokens,
      temperature: opts.temperature ?? config.temperature,
      system: systemPrompt,
      messages: opts.messages,
    };

    // SECURITY INVARIANT A1: streamLLM is text-in/text-out only.
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
      const stream = getAnthropic().messages.stream(
        request as Parameters<ReturnType<typeof getAnthropic>["messages"]["stream"]>[0],
        { timeout: opts.timeoutMs ?? 120_000 }
      );
      stream.on("text", (textDelta) => {
        if (textDelta) onDelta(textDelta);
      });
      response = (await stream.finalMessage()) as typeof response;
    } catch (error) {
      const message = providerErrorMessage("Anthropic", error);
      console.error(message);
      throw new Error(message);
    }

    const content = response.content
      .filter((block) => block.type === "text")
      .map((block) => block.text ?? "")
      .join("");
    const cacheCreationInputTokens =
      "cache_creation_input_tokens" in response.usage
        ? response.usage.cache_creation_input_tokens ?? 0
        : 0;
    const cacheReadInputTokens =
      "cache_read_input_tokens" in response.usage
        ? response.usage.cache_read_input_tokens ?? 0
        : 0;

    const result = {
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
    await recordLLMCostEvent({
      telemetry: opts.telemetry,
      provider: config.provider,
      model: result.model,
      tier: opts.tier,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      cacheCreationInputTokens: result.cacheCreationInputTokens,
      cacheReadInputTokens: result.cacheReadInputTokens,
      estimatedCostUsd: result.estimatedCostUsd,
    });
    return result;
  }

  if (config.provider === "openai") {
    const messages = [
      { role: "system" as const, content: systemPrompt },
      ...opts.messages.map((message) => ({
        role: message.role,
        content: contentToText(message.content),
      })),
    ];

    // SECURITY INVARIANT A1: streamLLM is text-in/text-out only.
    // Adding tools/tool_choice/function_call changes the prompt-injection threat model
    // and requires security review; see docs/security/SECURITY_POSTURE.md.
    const request: OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming = {
      model: config.model,
      max_completion_tokens: opts.maxTokens ?? config.maxTokens,
      messages,
      stream: true,
      stream_options: { include_usage: true },
    };

    if (supportsOpenAITemperature(config.model)) {
      request.temperature = opts.temperature ?? config.temperature;
    }

    let content = "";
    let usage: OpenAIUsageWithCache | undefined;

    try {
      const stream = await getOpenAI().chat.completions.create(request, {
        timeout: opts.timeoutMs ?? 120_000,
      });
      for await (const chunk of stream) {
        const text = chunk.choices[0]?.delta?.content ?? "";
        if (text) {
          content += text;
          onDelta(text);
        }
        if (chunk.usage) {
          usage = chunk.usage as OpenAIUsageWithCache;
        }
      }
    } catch (error) {
      const message = providerErrorMessage("OpenAI", error);
      console.error(message);
      throw new Error(message);
    }

    const promptTokens = usage?.prompt_tokens ?? 0;
    const outputTokens = usage?.completion_tokens ?? 0;
    const cacheReadInputTokens =
      usage?.prompt_tokens_details?.cached_tokens ?? 0;
    const inputTokens = Math.max(promptTokens - cacheReadInputTokens, 0);

    const result = {
      content,
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
    await recordLLMCostEvent({
      telemetry: opts.telemetry,
      provider: config.provider,
      model: result.model,
      tier: opts.tier,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      cacheCreationInputTokens: result.cacheCreationInputTokens,
      cacheReadInputTokens: result.cacheReadInputTokens,
      estimatedCostUsd: result.estimatedCostUsd,
    });
    return result;
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
