import { AiError, providerFromCredential, type LlmProvider, type PersonalProvider } from "@Kavero/ai";
import type { Database } from "@Kavero/db";
import { aiCredential, type ModelCapabilities } from "@Kavero/db/schema/integration";
import { TRPCError } from "@trpc/server";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { audit } from "./audit-service";
import { assertPublicUrl, safeFetch } from "./safe-fetch";
import type { SecretBox } from "./secret-box";

export const PROVIDER_LABEL: Record<PersonalProvider, string> = {
  anthropic: "Claude (Anthropic)",
  openrouter: "OpenRouter",
  openai: "OpenAI",
  "openai-compatible": "OpenAI-compatible server",
};

export interface CredentialInput {
  provider: PersonalProvider;
  apiKey?: string;
  model: string;
  baseUrl?: string;
}

export interface ProviderModel {
  id: string;
  name: string;
  capabilities: ModelCapabilities;
}

const modality = z.enum(["text", "image", "audio", "video", "file"]);

function curatedCapabilities(provider: PersonalProvider, model: string): ModelCapabilities {
  const id = model.toLowerCase();
  if (provider === "anthropic") {
    // Vision started with Claude 3; Claude 2 and Instant models are text-only.
    const multimodal = /^claude-(?:3(?:-|$)|(?:haiku|sonnet|opus)-4(?:-|$))/.test(id);
    return {
      inputModalities: multimodal ? ["text", "image"] : ["text"],
      outputModalities: ["text"],
      toolCalling: multimodal,
      structuredOutput: multimodal,
      maxInputTokens: null,
      source: "curated",
    };
  }
  if (provider === "openai") {
    const image = /^(?:gpt-(?:4o|4\.1|5)|o[134](?:-|$))/.test(id);
    const audioInput = /(?:audio|transcribe|realtime)/.test(id);
    const audioOutput = /(?:audio|tts|realtime)/.test(id);
    const known = image || audioInput || audioOutput || /^(?:gpt-3\.5|gpt-4(?:-|$)|o[134](?:-|$))/.test(id);
    return {
      inputModalities: known ? ["text", ...(image ? ["image" as const] : []), ...(audioInput ? ["audio" as const] : [])] : null,
      outputModalities: known ? ["text", ...(audioOutput ? ["audio" as const] : [])] : null,
      toolCalling: known ? true : null,
      structuredOutput: /^(?:gpt-4o|gpt-4\.1|gpt-5|o[134](?:-|$))/.test(id) ? true : null,
      maxInputTokens: null,
      source: known ? "curated" : "unknown",
    };
  }
  return { inputModalities: null, outputModalities: null, toolCalling: null, structuredOutput: null, maxInputTokens: null, source: "unknown" };
}

function asCapabilities(provider: PersonalProvider, id: string, raw: Record<string, unknown>): ModelCapabilities {
  const architecture = raw.architecture && typeof raw.architecture === "object" ? raw.architecture as Record<string, unknown> : null;
  const inputRaw = architecture?.input_modalities;
  const outputRaw = architecture?.output_modalities;
  const parameters = Array.isArray(raw.supported_parameters) ? raw.supported_parameters.filter((p): p is string => typeof p === "string") : null;
  const validModalities = <T extends z.infer<typeof modality>>(
    values: unknown,
    allowed: readonly T[],
  ): T[] | null => {
    if (!Array.isArray(values)) return null;
    const result = new Set<T>();
    for (const value of values) {
      if (typeof value !== "string") continue;
      const normalized = value === "pdf" ? "file" : value;
      if (allowed.includes(normalized as T)) result.add(normalized as T);
    }
    return [...result];
  };
  if (inputRaw || outputRaw || parameters) {
    const inputs = validModalities(inputRaw, ["text", "image", "audio", "video", "file"] as const);
    const outputs = validModalities(outputRaw, ["text", "image", "audio", "video"] as const);
    return {
      inputModalities: inputs,
      outputModalities: outputs,
      toolCalling: parameters ? parameters.some((p) => ["tools", "tool_choice"].includes(p)) : null,
      structuredOutput: parameters ? parameters.some((p) => ["response_format", "structured_outputs"].includes(p)) : null,
      maxInputTokens: typeof raw.context_length === "number" && Number.isFinite(raw.context_length)
        ? raw.context_length
        : typeof raw.context_window === "number" && Number.isFinite(raw.context_window) ? raw.context_window : null,
      source: "provider",
    };
  }
  return curatedCapabilities(provider, id);
}

/** Per-user AI provider settings and provider model discovery. Secrets are never returned. */
export class AiCredentialService {
  constructor(private readonly db: Database, private readonly box: SecretBox, private readonly opts: { allowLocal: boolean; appUrl?: string }) {}

  private async find(userId: string, provider: PersonalProvider) {
    const [row] = await this.db.select().from(aiCredential).where(and(eq(aiCredential.userId, userId), eq(aiCredential.provider, provider))).limit(1);
    return row ?? null;
  }

  async list(userId: string) {
    const rows = await this.db.select().from(aiCredential).where(eq(aiCredential.userId, userId)).orderBy(desc(aiCredential.isDefault), desc(aiCredential.updatedAt));
    return rows.map((row) => ({
      provider: row.provider,
      label: PROVIDER_LABEL[row.provider],
      model: row.model,
      baseUrl: row.baseUrl,
      hasKey: !!row.encryptedKey,
      keyHint: row.keyHint,
      isDefault: row.isDefault,
      capabilities: row.modelCapabilities,
      updatedAt: row.updatedAt,
    }));
  }

  async defaultModel(userId: string) {
    const [row] = await this.db.select({ provider: aiCredential.provider, model: aiCredential.model, capabilities: aiCredential.modelCapabilities })
      .from(aiCredential).where(and(eq(aiCredential.userId, userId), eq(aiCredential.isDefault, true))).limit(1);
    return row ?? null;
  }

  private async keyFor(userId: string, provider: PersonalProvider, apiKey?: string) {
    const supplied = apiKey?.trim();
    if (supplied) return supplied;
    const existing = await this.find(userId, provider);
    return existing?.encryptedKey ? this.box.open(existing.encryptedKey) : "";
  }

  private async modelRequest(provider: PersonalProvider, baseUrl: string | undefined, apiKey: string) {
    let url: string;
    let headers: Record<string, string> = {};
    if (provider === "anthropic") {
      url = "https://api.anthropic.com/v1/models?limit=1000";
      headers = { "x-api-key": apiKey, "anthropic-version": "2023-06-01" };
    } else if (provider === "openai") {
      url = "https://api.openai.com/v1/models";
      headers = { Authorization: `Bearer ${apiKey}` };
    } else if (provider === "openrouter") {
      url = "https://openrouter.ai/api/v1/models";
      headers = { ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}), ...(this.opts.appUrl ? { "HTTP-Referer": this.opts.appUrl, "X-Title": "Kavero" } : {}) };
    } else {
      if (!baseUrl) throw new TRPCError({ code: "BAD_REQUEST", message: "Enter the OpenAI-compatible server URL" });
      await assertPublicUrl(baseUrl, this.opts).catch((e: Error) => { throw new TRPCError({ code: "BAD_REQUEST", message: e.message }); });
      const normalized = baseUrl.replace(/\/+$/, "");
      url = `${normalized}/models`;
      headers = apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
    }
    const fetcher = provider === "openai-compatible"
      ? (input: string, init: RequestInit) => safeFetch(input, init, this.opts)
      : (input: string, init: RequestInit) => fetch(input, init);
    const response = await fetcher(url, { headers, signal: AbortSignal.timeout(20_000) }).catch((error: Error) => {
      throw new TRPCError({ code: "BAD_REQUEST", message: `Could not load models from ${PROVIDER_LABEL[provider]}: ${error.message}` });
    });
    const data = await response.json().catch(() => null) as { data?: unknown } | null;
    if (!response.ok) {
      const error = data && "error" in data && data.error && typeof data.error === "object" && "message" in data.error ? String(data.error.message) : `HTTP ${response.status}`;
      throw new TRPCError({ code: "BAD_REQUEST", message: `Could not load models from ${PROVIDER_LABEL[provider]}: ${error}` });
    }
    if (!Array.isArray(data?.data)) throw new TRPCError({ code: "BAD_GATEWAY", message: "The provider returned an unexpected model list" });
    return data.data.flatMap((entry): ProviderModel[] => {
      if (!entry || typeof entry !== "object") return [];
      const item = entry as Record<string, unknown>;
      const id = typeof item.id === "string" ? item.id.trim() : "";
      if (!id || id.length > 160) return [];
      return [{
        id,
        name: typeof item.name === "string" ? item.name : typeof item.display_name === "string" ? item.display_name : id,
        capabilities: asCapabilities(provider, id, item),
      }];
    }).sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)).slice(0, 2500);
  }

  async models(userId: string, input: { provider: PersonalProvider; apiKey?: string; baseUrl?: string }) {
    const apiKey = await this.keyFor(userId, input.provider, input.apiKey);
    if (input.provider !== "openrouter" && input.provider !== "openai-compatible" && !apiKey) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Enter an API key to load this provider's models" });
    }
    return this.modelRequest(input.provider, input.baseUrl, apiKey);
  }

  async setDefault(userId: string, provider: PersonalProvider) {
    const row = await this.find(userId, provider);
    if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Add this provider before making it the default" });
    await this.db.transaction(async (tx) => {
      await tx.update(aiCredential).set({ isDefault: false }).where(eq(aiCredential.userId, userId));
      await tx.update(aiCredential).set({ isDefault: true }).where(and(eq(aiCredential.userId, userId), eq(aiCredential.provider, provider)));
    });
    await audit(this.db, { userId, action: "ai:provider_default", target: provider, outcome: "ok", details: { provider } });
    return this.list(userId);
  }

  /** Verify a proposed credential and model before storing either one. */
  async set(userId: string, input: CredentialInput) {
    const apiKey = await this.keyFor(userId, input.provider, input.apiKey);
    if (input.provider !== "openai-compatible" && !apiKey) throw new TRPCError({ code: "BAD_REQUEST", message: "Enter an API key" });
    if (input.apiKey && (input.apiKey.trim().length < 8 || input.apiKey.trim().length > 400)) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "That API key doesn't look right" });
    }
    const modelId = input.model.trim();
    if (!modelId || !/^[\w./:@-]{1,160}$/.test(modelId)) throw new TRPCError({ code: "BAD_REQUEST", message: "Choose a model from the provider's model list" });
    if (input.provider === "openai-compatible") {
      if (!input.baseUrl) throw new TRPCError({ code: "BAD_REQUEST", message: "Enter the server URL" });
      await assertPublicUrl(input.baseUrl, this.opts).catch((e: Error) => { throw new TRPCError({ code: "BAD_REQUEST", message: e.message }); });
    }
    const models = await this.modelRequest(input.provider, input.baseUrl, apiKey);
    const selected = models.find((model) => model.id === modelId);
    if (!selected) throw new TRPCError({ code: "BAD_REQUEST", message: "That model is no longer available from this provider. Refresh the model list and choose again." });

    const provider = providerFromCredential({ provider: input.provider, apiKey, model: modelId, baseUrl: input.baseUrl, appUrl: this.opts.appUrl, fetch: (url, init) => safeFetch(url, init, this.opts) });
    const connection = await this.testProvider(provider);

    const existing = await this.find(userId, input.provider);
    const [{ hasDefault = false } = { hasDefault: false }] = await this.db.select({ hasDefault: aiCredential.isDefault }).from(aiCredential).where(and(eq(aiCredential.userId, userId), eq(aiCredential.isDefault, true))).limit(1);
    const key = input.apiKey?.trim();
    const values = {
      model: modelId,
      baseUrl: input.provider === "openai-compatible" ? input.baseUrl!.trim() : null,
      encryptedKey: key ? this.box.seal(key) : existing?.encryptedKey ?? null,
      keyHint: key ? key.slice(-4) : existing?.keyHint ?? null,
      isDefault: existing?.isDefault ?? !hasDefault,
      modelCapabilities: selected.capabilities,
    };
    await this.db.insert(aiCredential).values({ userId, provider: input.provider, ...values })
      .onConflictDoUpdate({ target: [aiCredential.userId, aiCredential.provider], set: { ...values, updatedAt: new Date() } });
    await audit(this.db, { userId, action: existing ? "ai:provider_update" : "ai:provider_add", target: input.provider, outcome: "ok", details: { provider: input.provider, model: modelId, isDefault: values.isDefault } });
    return { ...(await this.list(userId)).find((row) => row.provider === input.provider)!, connection };
  }

  async remove(userId: string, provider: PersonalProvider) {
    await this.db.transaction(async (tx) => {
      const removed = await tx.delete(aiCredential)
        .where(and(eq(aiCredential.userId, userId), eq(aiCredential.provider, provider)))
        .returning({ isDefault: aiCredential.isDefault });
      if (!removed.length) throw new TRPCError({ code: "NOT_FOUND", message: "Provider not found" });
      if (removed[0]!.isDefault) {
        const [next] = await tx.select().from(aiCredential).where(eq(aiCredential.userId, userId)).orderBy(desc(aiCredential.updatedAt)).limit(1);
        if (next) await tx.update(aiCredential).set({ isDefault: true }).where(and(eq(aiCredential.userId, userId), eq(aiCredential.provider, next.provider)));
      }
    });
    await audit(this.db, { userId, action: "ai:provider_remove", target: provider, outcome: "ok", details: { provider } });
    return this.list(userId);
  }

  private async testProvider(provider: LlmProvider) {
    const started = Date.now();
    try {
      const result = await provider.generateObject({
        system: "You are a connectivity check. Reply with the requested JSON only.",
        prompt: 'Return {"ok": true, "word": "kavero"}.',
        schema: z.object({ ok: z.boolean(), word: z.string() }),
        schemaName: "connectivity_check",
        maxTokens: 2000,
        signal: AbortSignal.timeout(60_000),
      });
      if (result.value.ok !== true || result.value.word !== "kavero") throw new Error("The model returned an invalid connectivity-check response");
      return { ok: true, model: result.model, ms: Date.now() - started };
    } catch (e) {
      throw new TRPCError({ code: "BAD_REQUEST", message: e instanceof AiError ? e.message : (e as Error).message });
    }
  }

  async provider(userId: string): Promise<LlmProvider | null> {
    const [row] = await this.db.select().from(aiCredential).where(and(eq(aiCredential.userId, userId), eq(aiCredential.isDefault, true))).limit(1);
    if (!row) return null;
    const apiKey = row.encryptedKey ? this.box.open(row.encryptedKey) : "";
    if (row.provider === "openai-compatible" && row.baseUrl) await assertPublicUrl(row.baseUrl, this.opts);
    return providerFromCredential({ provider: row.provider, apiKey, model: row.model, baseUrl: row.baseUrl, appUrl: this.opts.appUrl, fetch: (url, init) => safeFetch(url, init, this.opts) });
  }
}
