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
