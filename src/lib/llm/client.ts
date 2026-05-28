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

export async function callLLM(opts: LLMCallOptions): Promise<LLMCallResult> {
  const config = await getAIModelConfig(opts.tier);

  if (config.provider === "anthropic") {
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
    const response = await getOpenAI().chat.completions.create(
      {
        model: config.model,
        max_tokens: config.maxTokens,
        temperature: config.temperature,
        messages: [
          { role: "system", content: opts.system },
          ...opts.messages.map((message) => ({
            role: message.role,
            content: message.content,
          })),
        ],
      },
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
