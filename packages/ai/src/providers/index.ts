import { AnthropicProvider } from "./anthropic";
import { OpenAICompatibleProvider } from "./openai-compatible";
import { openRouterImageModel } from "./openrouter-image";
import { openRouterVideoModel } from "./openrouter-video";
import { createLimitedMediaFetch } from "./media-fetch";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createGateway, Output, generateText, type ImageModel } from "ai";
import type { GenerateObjectOptions, GenerateObjectResult, LlmProvider } from "./types";

export * from "./types";
export { AnthropicProvider, DEFAULT_ANTHROPIC_MODEL } from "./anthropic";
export { OpenAICompatibleProvider } from "./openai-compatible";

export interface AiEnv {
  /** anthropic | openai | openai-compatible | none. Defaults to the first configured. */
  AI_PROVIDER?: string;
  AI_MODEL?: string;
  ANTHROPIC_API_KEY?: string;
  OPENAI_API_KEY?: string;
  /** Base URL for openai-compatible servers, e.g. http://localhost:11434/v1 (Ollama). */
  AI_BASE_URL?: string;
}

/** Pick a provider from environment variables, or null (offline planner only). */
export function providerFromEnv(env: AiEnv): LlmProvider | null {
  const choice = (env.AI_PROVIDER ?? "").toLowerCase();
  if (choice === "none") return null;
  if (choice === "anthropic" || (!choice && env.ANTHROPIC_API_KEY)) {
    return new AnthropicProvider({ apiKey: env.ANTHROPIC_API_KEY, model: env.AI_MODEL });
  }
  if (choice === "openai" || (!choice && env.OPENAI_API_KEY)) {
    if (!env.AI_MODEL) return null;
    return new OpenAICompatibleProvider({ baseUrl: env.AI_BASE_URL ?? "https://api.openai.com/v1", apiKey: env.OPENAI_API_KEY, model: env.AI_MODEL });
  }
  if (choice === "openai-compatible" || (!choice && env.AI_BASE_URL)) {
    if (!env.AI_BASE_URL || !env.AI_MODEL) return null;
    return new OpenAICompatibleProvider({ baseUrl: env.AI_BASE_URL, apiKey: env.OPENAI_API_KEY, model: env.AI_MODEL, strictSchema: false });
  }
  return null;
}

export type PersonalProvider = "anthropic" | "openrouter" | "openai" | "openai-compatible";

export type AiProvider = PersonalProvider | "google" | "ai-gateway";
export type AiPurpose = "text" | "image" | "video";

export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

/** Discover models exposed by the user's Vercel AI Gateway connection. */
export function gatewayModels(apiKey: string) {
  return createGateway({ apiKey }).getAvailableModels();
}

/** A provider from a user's own key (Settings → AI). */
export function providerFromCredential(c: {
  provider: AiProvider; apiKey: string; model?: string | null; baseUrl?: string | null; appUrl?: string;
  /** Fetch for the user-supplied server URL (SSRF-guarded by the caller). */
  fetch?: (url: string, init: RequestInit) => Promise<Response>;
}): LlmProvider {
  if (c.provider === "google" || c.provider === "ai-gateway") {
    if (!c.model) throw new Error("Choose a model for this AI concern");
    const model = c.provider === "google"
      ? createGoogleGenerativeAI({ apiKey: c.apiKey })(c.model)
      : createGateway({ apiKey: c.apiKey })(c.model);
    return {
      id: c.provider,
      model: c.model,
      languageModel: () => model,
      async generateObject<T>(opts: GenerateObjectOptions<T>): Promise<GenerateObjectResult<T>> {
        const result = await generateText({
          model,
          instructions: opts.system,
          prompt: opts.prompt,
          output: Output.object({ schema: opts.schema, name: opts.schemaName }),
          maxOutputTokens: opts.maxTokens,
          abortSignal: opts.signal,
        });
        return {
          value: result.output,
          model: c.model!,
          usage: { inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens },
        };
      },
    };
  }
  switch (c.provider) {
    case "anthropic":
      return new AnthropicProvider({ apiKey: c.apiKey, model: c.model || undefined });
    case "openrouter":
      if (!c.model) throw new Error("Choose an OpenRouter model id, e.g. from openrouter.ai/models");
      return new OpenAICompatibleProvider({
        baseUrl: OPENROUTER_BASE_URL, apiKey: c.apiKey, model: c.model, label: "OpenRouter",
        // Optional attribution headers recommended by OpenRouter.
        headers: { "X-Title": "Kavero", ...(c.appUrl ? { "HTTP-Referer": c.appUrl } : {}) },
      });
    case "openai":
      if (!c.model) throw new Error("Choose an OpenAI model id");
      return new OpenAICompatibleProvider({ baseUrl: "https://api.openai.com/v1", apiKey: c.apiKey, model: c.model, label: "OpenAI" });
    case "openai-compatible":
      if (!c.baseUrl || !c.model) throw new Error("Enter the server URL and model id");
      return new OpenAICompatibleProvider({ baseUrl: c.baseUrl, apiKey: c.apiKey || undefined, model: c.model, strictSchema: false, label: "The AI server", fetch: c.fetch });
  }
}

function compatibleProvider(c: {
  provider: PersonalProvider; apiKey: string; baseUrl?: string | null; appUrl?: string;
  fetch?: (url: string, init: RequestInit) => Promise<Response>;
}) {
  const baseURL = c.provider === "openrouter" ? OPENROUTER_BASE_URL
    : c.provider === "openai" ? "https://api.openai.com/v1"
    : c.baseUrl ?? "";
  const headers = c.provider === "openrouter"
    ? { "X-Title": "Kavero", ...(c.appUrl ? { "HTTP-Referer": c.appUrl } : {}) }
    : undefined;
  const guarded = c.fetch;
  return createOpenAICompatible({
    name: c.provider,
    baseURL,
    apiKey: c.apiKey || undefined,
    headers,
    ...(guarded ? { fetch: ((input: string | URL | Request, init?: RequestInit) => guarded(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url, init ?? {})) as typeof fetch } : {}),
  });
}

/** Create the AI SDK v7 image adapter matching a saved provider connection. */
export function imageModelFromCredential(c: { provider: AiProvider; apiKey: string; model: string; baseUrl?: string | null; appUrl?: string; fetch?: (url: string, init: RequestInit) => Promise<Response> }): ImageModel {
  if (c.provider === "google") return createGoogleGenerativeAI({ apiKey: c.apiKey, fetch: createLimitedMediaFetch() as typeof fetch }).image(c.model);
  if (c.provider === "ai-gateway") return createGateway({ apiKey: c.apiKey, fetch: createLimitedMediaFetch() as typeof fetch }).imageModel(c.model);
  if (c.provider === "openrouter") return openRouterImageModel(c);
  if (c.provider === "anthropic") throw new Error("Anthropic does not provide image generation models");
  const baseFetch: (input: string | URL | Request, init?: RequestInit) => Promise<Response> = c.fetch
    ? (input, init) => c.fetch!(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url, init ?? {})
    : globalThis.fetch;
  const mediaFetch = createLimitedMediaFetch(baseFetch);
  return compatibleProvider({ ...c, provider: c.provider as PersonalProvider, fetch: (url, init) => mediaFetch(url, init) }).imageModel(c.model);
}

/** Create the AI SDK v7 experimental video adapter matching a saved connection. */
export function videoModelFromCredential(c: { provider: AiProvider; apiKey: string; model: string; appUrl?: string }) {
  if (c.provider === "openrouter") return openRouterVideoModel(c);
  if (c.provider === "google") return createGoogleGenerativeAI({ apiKey: c.apiKey, fetch: createLimitedMediaFetch() as typeof fetch }).video(c.model);
  if (c.provider === "ai-gateway") return createGateway({ apiKey: c.apiKey, fetch: createLimitedMediaFetch() as typeof fetch }).videoModel(c.model);
  throw new Error("This provider does not provide a supported video generation adapter");
}

/** Test double: returns canned values in order. */
export class MockProvider implements LlmProvider {
  readonly id = "mock" as const;
  readonly model = "mock";
  readonly calls: GenerateObjectOptions<unknown>[] = [];
  constructor(private readonly responses: unknown[]) {}
  async generateObject<T>(opts: GenerateObjectOptions<T>): Promise<GenerateObjectResult<T>> {
    this.calls.push(opts as GenerateObjectOptions<unknown>);
    const next = this.responses.shift();
    if (next instanceof Error) throw next;
    return { value: opts.schema.parse(next), model: "mock" };
  }
}
