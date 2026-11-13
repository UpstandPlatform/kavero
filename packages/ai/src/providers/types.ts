import type { LanguageModel } from "ai";

import type { z } from "zod";

export interface GenerateObjectOptions<T> {
  /** Stable instructions (cacheable). */
  system: string;
  /** The per-request task. */
  prompt: string;
  schema: z.ZodType<T>;
  /** Short identifier for the schema, e.g. "catalog_plan". */
  schemaName: string;
  maxTokens?: number;
  signal?: AbortSignal;
}

export interface GenerateObjectResult<T> {
  value: T;
  model: string;
  usage?: { inputTokens?: number; outputTokens?: number };
}

/** A model that can return JSON matching a schema. Implementations live one per file. */
export interface LlmProvider {
  readonly id: "anthropic" | "openai-compatible" | "google" | "ai-gateway" | "mock";
  readonly model: string;
  generateObject<T>(opts: GenerateObjectOptions<T>): Promise<GenerateObjectResult<T>>;
  /** The same model for the AI SDK (streaming chat with tools), when the provider supports it. */
  languageModel?(): LanguageModel;
}

/** User-facing errors: safe to show, no secrets. */
export class AiError extends Error {
  constructor(message: string, public readonly code: "not_configured" | "refused" | "invalid_output" | "rate_limited" | "auth" | "unavailable" | "bad_request") {
    super(message);
  }
}
