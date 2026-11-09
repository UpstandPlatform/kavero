import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";

import { AiError, type GenerateObjectOptions, type GenerateObjectResult, type LlmProvider } from "./types";

export const DEFAULT_ANTHROPIC_MODEL = "claude-opus-5-5";

/**
 * Claude via the official SDK, using structured outputs so the response is
 * validated against the Zod schema. Server-side refusal fallbacks are on
 * ("default" routing), so a declined request is retried on a suitable model.
 */
export class AnthropicProvider implements LlmProvider {
  readonly id = "anthropic" as const;
  private readonly client: Anthropic;

  constructor(opts: { apiKey?: string; model?: string } = {}, readonly model = opts.model || DEFAULT_ANTHROPIC_MODEL) {
    // With no apiKey the SDK resolves ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN / an `ant auth login` profile.
    this.client = new Anthropic(opts.apiKey ? { apiKey: opts.apiKey } : {});
  }

  async generateObject<T>(opts: GenerateObjectOptions<T>): Promise<GenerateObjectResult<T>> {
    try {
      const response = await this.client.beta.messages.parse(
        {
          model: this.model,
          max_tokens: opts.maxTokens ?? 16000,
          // Effort defaults to medium on this model; catalog planning benefits from a bit more.
          output_config: { effort: "high", format: betaZodOutputFormat(opts.schema) },
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
          system: [{ type: "text", text: opts.system, cache_control: { type: "ephemeral" } }],
          messages: [{ role: "user", content: opts.prompt }],
        },
        { signal: opts.signal },
      );
      if (response.stop_reason === "refusal") {
        throw new AiError("The AI declined this request. Try rephrasing the brief.", "refused");
      }
      if (response.stop_reason === "max_tokens") {
        throw new AiError("The AI response was cut off. Try a shorter brief or fewer products.", "invalid_output");
      }
      const value = response.parsed_output as T | null;
      if (value === null || value === undefined) throw new AiError("The AI returned an unexpected format. Please try again.", "invalid_output");
      return { value, model: response.model, usage: { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens } };
    } catch (e) {
      if (e instanceof AiError) throw e;
      if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) throw new AiError("The Anthropic API key is missing or invalid.", "auth");
      if (e instanceof Anthropic.RateLimitError) throw new AiError("The AI service is busy (rate limited). Try again in a minute.", "rate_limited");
      if (e instanceof Anthropic.BadRequestError) throw new AiError(`The AI request was rejected: ${e.message}`, "bad_request");
      if (e instanceof Anthropic.APIError) throw new AiError(`The AI service returned an error (${e.status ?? "network"}).`, "unavailable");
      throw new AiError(`The AI request failed: ${(e as Error).message}`, "unavailable");
    }
  }
}
