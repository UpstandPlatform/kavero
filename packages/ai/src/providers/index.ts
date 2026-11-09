import { AnthropicProvider } from "./anthropic";
import { OpenAICompatibleProvider } from "./openai-compatible";
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

export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

/** A provider from a user's own key (Settings → AI). */
export function providerFromCredential(c: { provider: PersonalProvider; apiKey: string; model?: string | null; baseUrl?: string | null; appUrl?: string }): LlmProvider {
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
      return new OpenAICompatibleProvider({ baseUrl: c.baseUrl, apiKey: c.apiKey || undefined, model: c.model, strictSchema: false, label: "The AI server" });
  }
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
