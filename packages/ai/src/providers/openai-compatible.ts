import { z } from "zod";

import { AiError, type GenerateObjectOptions, type GenerateObjectResult, type LlmProvider } from "./types";

/**
 * OpenAI Chat Completions–compatible endpoint: OpenAI itself, or local servers
 * such as Ollama (http://localhost:11434/v1) and LM Studio. Uses JSON-schema
 * response format where supported and validates the result with Zod either way.
 */
export class OpenAICompatibleProvider implements LlmProvider {
  readonly id = "openai-compatible" as const;

  constructor(private readonly opts: { baseUrl: string; apiKey?: string; model: string; strictSchema?: boolean; headers?: Record<string, string>; label?: string }) {}

  /** Human-readable service name for errors, e.g. "OpenRouter". */
  private get label() {
    return this.opts.label ?? "The AI service";
  }

  get model() {
    return this.opts.model;
  }

  async generateObject<T>(opts: GenerateObjectOptions<T>, strict = this.opts.strictSchema !== false): Promise<GenerateObjectResult<T>> {
    const jsonSchema = z.toJSONSchema(opts.schema, { target: "draft-7" }) as Record<string, unknown>;
    const body = {
      model: this.opts.model,
      max_tokens: opts.maxTokens ?? 16000,
      messages: [
        { role: "system", content: `${opts.system}\n\nRespond with a single JSON object only.` },
        { role: "user", content: opts.prompt },
      ],
      response_format: !strict
        ? { type: "json_object" }
        : { type: "json_schema", json_schema: { name: opts.schemaName, schema: jsonSchema, strict: false } },
    };
    let res: Response;
    try {
      res = await fetch(`${this.opts.baseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...this.opts.headers, ...(this.opts.apiKey ? { Authorization: `Bearer ${this.opts.apiKey}` } : {}) },
        body: JSON.stringify(body),
        signal: opts.signal ?? AbortSignal.timeout(180_000),
      });
    } catch (e) {
      throw new AiError(`Couldn't reach the AI server: ${(e as Error).message}`, "unavailable");
    }
    if (res.status === 401 || res.status === 403) throw new AiError(`${this.label}: the API key is missing or invalid.`, "auth");
    if (res.status === 402) throw new AiError(`${this.label}: the account has no credits left.`, "auth");
    if (res.status === 429) throw new AiError(`${this.label} is busy (rate limited). Try again in a minute.`, "rate_limited");
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      // Some models don't support JSON-schema output: retry once in plain JSON mode.
      if (strict && res.status === 400 && /response_format|json_schema|structured/i.test(detail)) return this.generateObject(opts, false);
      const msg = (() => { try { return (JSON.parse(detail) as { error?: { message?: string } }).error?.message; } catch { return undefined; } })();
      throw new AiError(`${this.label} returned an error (${res.status})${msg ? `: ${msg.slice(0, 200)}` : ""}.`, res.status >= 500 ? "unavailable" : "bad_request");
    }

    const data = (await res.json()) as { model?: string; choices?: { message?: { content?: string; refusal?: string }; finish_reason?: string }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } };
    const choice = data.choices?.[0];
    if (choice?.message?.refusal) throw new AiError("The AI declined this request. Try rephrasing the brief.", "refused");
    if (choice?.finish_reason === "length") throw new AiError("The AI response was cut off. Try a shorter brief or fewer products.", "invalid_output");
    const text = choice?.message?.content ?? "";
    let parsed: unknown;
    try {
      parsed = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, ""));
    } catch {
      throw new AiError("The AI returned something that isn't JSON. Please try again.", "invalid_output");
    }
    const result = opts.schema.safeParse(parsed);
    if (!result.success) throw new AiError(`The AI output didn't match the expected structure: ${result.error.issues[0]?.message ?? "invalid"}`, "invalid_output");
    return { value: result.data, model: data.model ?? this.opts.model, usage: { inputTokens: data.usage?.prompt_tokens, outputTokens: data.usage?.completion_tokens } };
  }
}
