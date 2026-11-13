import { gatewayModels, providerFromCredential, type AiProvider, type AiPurpose, type LlmProvider } from "@Kavero/ai";
import type { Database } from "@Kavero/db";
import { aiCredential, aiModelAssignment, type ModelCapabilities } from "@Kavero/db/schema/integration";
import { TRPCError } from "@trpc/server";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { audit } from "./audit-service";
import { assertPublicUrl, readLimited, safeFetch } from "./safe-fetch";
import type { SecretBox } from "./secret-box";

export const PROVIDER_LABEL: Record<AiProvider, string> = {
  anthropic: "Claude (Anthropic)",
  openrouter: "OpenRouter",
  openai: "OpenAI",
  "openai-compatible": "OpenAI-compatible server",
  google: "Google AI Studio",
  "ai-gateway": "Vercel AI Gateway",
};

export interface CredentialInput { provider: AiProvider; apiKey?: string; baseUrl?: string }
export interface ProviderModel { id: string; name: string; capabilities: ModelCapabilities }

const modality = z.enum(["text", "image", "audio", "video", "file"]);
const UNKNOWN: ModelCapabilities = { inputModalities: null, outputModalities: null, toolCalling: null, structuredOutput: null, maxInputTokens: null, source: "unknown" };
const MAX_MODEL_RESPONSE_BYTES = 5 * 1024 * 1024;

async function readModelResponse(response: Response): Promise<unknown> {
  try {
    const bytes = await readLimited(response.body, MAX_MODEL_RESPONSE_BYTES, "The provider returned an unexpectedly large model list.");
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    return null;
  }
}

function curatedCapabilities(provider: AiProvider, model: string): ModelCapabilities {
  const id = model.toLowerCase();
  if (provider === "anthropic") {
    const vision = /^claude-(?:3(?:-|$)|(?:haiku|sonnet|opus)-4(?:-|$))/.test(id);
    return { ...UNKNOWN, inputModalities: vision ? ["text", "image"] : ["text"], outputModalities: ["text"], toolCalling: vision, structuredOutput: vision, source: "curated" };
  }
  if (provider === "google") {
    if (/^veo-/.test(id)) return { ...UNKNOWN, outputModalities: ["video"], source: "curated" };
    if (/^imagen-/.test(id)) return UNKNOWN;
    if (/^gemini-.*(?:image|nano-banana)/.test(id)) return { ...UNKNOWN, outputModalities: ["image"], source: "curated" };
    if (/^gemini-/.test(id)) return { ...UNKNOWN, inputModalities: /pro|flash/.test(id) ? ["text", "image"] : ["text"], outputModalities: ["text"], toolCalling: true, structuredOutput: true, source: "curated" };
    return UNKNOWN;
  }
  if (provider === "ai-gateway") return UNKNOWN; // Gateway discovery supplies modelType metadata below.
  if (provider === "openai") {
    if (/^(?:gpt-image|dall-e)/.test(id)) return { ...UNKNOWN, outputModalities: ["image"], source: "curated" };
    if (/^(?:gpt-(?:4o|4\.1|5)|o[134](?:-|$))/.test(id)) return { ...UNKNOWN, inputModalities: ["text", "image"], outputModalities: ["text"], toolCalling: true, structuredOutput: true, source: "curated" };
    if (/^(?:gpt-3\.5|gpt-4(?:-|$))/.test(id)) return { ...UNKNOWN, inputModalities: ["text"], outputModalities: ["text"], toolCalling: true, source: "curated" };
  }
  return UNKNOWN;
}

function asCapabilities(provider: AiProvider, id: string, raw: Record<string, unknown>): ModelCapabilities {
  const architecture = raw.architecture && typeof raw.architecture === "object" ? raw.architecture as Record<string, unknown> : null;
  const inputRaw = architecture?.input_modalities;
  const outputRaw = architecture?.output_modalities;
  const parameters = Array.isArray(raw.supported_parameters) ? raw.supported_parameters.filter((p): p is string => typeof p === "string") : null;
  const validModalities = <T extends z.infer<typeof modality>>(values: unknown, allowed: readonly T[]): T[] | null => {
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
      inputModalities: inputs, outputModalities: outputs,
      toolCalling: parameters ? parameters.some((p) => ["tools", "tool_choice"].includes(p)) : null,
      structuredOutput: parameters ? parameters.some((p) => ["response_format", "structured_outputs"].includes(p)) : null,
      maxInputTokens: typeof raw.context_length === "number" && Number.isFinite(raw.context_length) ? raw.context_length
        : typeof raw.context_window === "number" && Number.isFinite(raw.context_window) ? raw.context_window : null,
      source: "provider",
    };
  }
  return curatedCapabilities(provider, id);
}

function supports(model: ProviderModel, purpose: AiPurpose, provider: AiProvider) {
  if (purpose === "text") return model.capabilities.outputModalities?.includes("text") === true || model.capabilities.source === "unknown";
  if (purpose === "video" && provider !== "google" && provider !== "ai-gateway" && provider !== "openrouter") return false;
  return model.capabilities.source !== "unknown" && model.capabilities.outputModalities?.includes(purpose) === true;
}

/** Per-user encrypted provider connections and separate purpose assignments. */
export class AiCredentialService {
  constructor(private readonly db: Database, private readonly box: SecretBox, private readonly opts: { allowLocal: boolean; appUrl?: string }) {}

  private async find(userId: string, provider: AiProvider) {
    const [row] = await this.db.select().from(aiCredential).where(and(eq(aiCredential.userId, userId), eq(aiCredential.provider, provider))).limit(1);
    return row ?? null;
  }

  async list(userId: string) {
    const rows = await this.db.select().from(aiCredential).where(eq(aiCredential.userId, userId)).orderBy(desc(aiCredential.updatedAt));
    return rows.map((row) => ({ provider: row.provider, label: PROVIDER_LABEL[row.provider], baseUrl: row.baseUrl, hasKey: !!row.encryptedKey, keyHint: row.keyHint, updatedAt: row.updatedAt }));
  }

  async assignments(userId: string) {
    return this.db.select().from(aiModelAssignment).where(eq(aiModelAssignment.userId, userId));
  }

  async assignment(userId: string, purpose: AiPurpose) {
    const [row] = await this.db.select().from(aiModelAssignment).where(and(eq(aiModelAssignment.userId, userId), eq(aiModelAssignment.purpose, purpose))).limit(1);
    return row ?? null;
  }

  private async keyFor(userId: string, provider: AiProvider, apiKey?: string) {
    const supplied = apiKey?.trim();
    if (supplied) return supplied;
    const existing = await this.find(userId, provider);
    return existing?.encryptedKey ? this.box.open(existing.encryptedKey) : "";
  }

  private async modelRequest(provider: AiProvider, baseUrl: string | undefined, apiKey: string, purpose?: AiPurpose): Promise<ProviderModel[]> {
    if (provider === "ai-gateway") {
      const result = await gatewayModels(apiKey).catch((error: Error) => {
        throw new TRPCError({ code: "BAD_REQUEST", message: `Could not load models from ${PROVIDER_LABEL[provider]}: ${error.message}` });
      });
      return result.models.flatMap((entry) => {
        if (!entry.id || entry.id.length > 160) return [];
        const type = entry.modelType;
        const capabilities: ModelCapabilities = type === "language"
          ? { ...UNKNOWN, inputModalities: ["text"], outputModalities: ["text"], source: "provider" }
          : type === "image" ? { ...UNKNOWN, outputModalities: ["image"], source: "provider" }
          : type === "video" ? { ...UNKNOWN, outputModalities: ["video"], source: "provider" }
          : type ? { ...UNKNOWN, inputModalities: [], outputModalities: [], source: "provider" }
          : UNKNOWN;
        return [{ id: entry.id, name: entry.name || entry.id, capabilities }];
      }).sort((a, b) => a.name.localeCompare(b.name));
    }
    if (provider === "google") {
      const response = await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000", { headers: { "x-goog-api-key": apiKey }, signal: AbortSignal.timeout(20_000) }).catch((error: Error) => {
        throw new TRPCError({ code: "BAD_REQUEST", message: `Could not load models from ${PROVIDER_LABEL[provider]}: ${error.message}` });
      });
      const data = await readModelResponse(response) as { models?: Array<Record<string, unknown>>; error?: { message?: string } } | null;
      if (!response.ok) throw new TRPCError({ code: "BAD_REQUEST", message: `Could not load models from ${PROVIDER_LABEL[provider]}: ${data?.error?.message ?? `HTTP ${response.status}`}` });
      return (data?.models ?? []).flatMap((item) => {
        const name = typeof item.name === "string" ? item.name : "";
        const id = name.split("/").at(-1) ?? "";
        const methods = Array.isArray(item.supportedGenerationMethods) ? item.supportedGenerationMethods : [];
        // AI SDK's Google image adapter supports Gemini image models, while Imagen uses a different API.
        if (!id || id.length > 160 || /^imagen-/i.test(id) || !methods.includes("generateContent") && !/^veo-/.test(id)) return [];
        const caps = curatedCapabilities(provider, id);
        return [{ id, name: typeof item.displayName === "string" ? item.displayName : id, capabilities: caps }];
      }).sort((a, b) => a.name.localeCompare(b.name));
    }

    if (provider === "openrouter" && purpose === "image") {
      const response = await fetch("https://openrouter.ai/api/v1/images/models", { headers: { Authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(20_000) }).catch((error: Error) => {
        throw new TRPCError({ code: "BAD_REQUEST", message: `Could not load image models from ${PROVIDER_LABEL[provider]}: ${error.message}` });
      });
      const data = await readModelResponse(response) as { data?: unknown; error?: { message?: string } } | null;
      if (!response.ok) throw new TRPCError({ code: "BAD_REQUEST", message: `Could not load image models from ${PROVIDER_LABEL[provider]}: ${data?.error?.message ?? `HTTP ${response.status}`}` });
      if (!Array.isArray(data?.data)) throw new TRPCError({ code: "BAD_GATEWAY", message: "The provider returned an unexpected image model list" });
      return data.data.flatMap((entry): ProviderModel[] => {
        if (!entry || typeof entry !== "object") return [];
        const item = entry as Record<string, unknown>;
        const id = typeof item.id === "string" ? item.id.trim() : "";
        if (!id || id.length > 160) return [];
        return [{ id, name: typeof item.name === "string" ? item.name : id, capabilities: asCapabilities(provider, id, item) }];
      }).filter((model) => supports(model, "image", provider)).sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)).slice(0, 2500);
    }

    if (provider === "openrouter" && purpose === "video") {
      const response = await fetch("https://openrouter.ai/api/v1/videos/models", { headers: { Authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(20_000) }).catch((error: Error) => {
        throw new TRPCError({ code: "BAD_REQUEST", message: `Could not load video models from ${PROVIDER_LABEL[provider]}: ${error.message}` });
      });
      const data = await readModelResponse(response) as { data?: unknown; error?: { message?: string } } | null;
      if (!response.ok) throw new TRPCError({ code: "BAD_REQUEST", message: `Could not load video models from ${PROVIDER_LABEL[provider]}: ${data?.error?.message ?? `HTTP ${response.status}`}` });
      if (!Array.isArray(data?.data)) throw new TRPCError({ code: "BAD_GATEWAY", message: "The provider returned an unexpected video model list" });
      return data.data.flatMap((entry): ProviderModel[] => {
        if (!entry || typeof entry !== "object") return [];
        const item = entry as Record<string, unknown>;
        const id = typeof item.id === "string" ? item.id.trim() : "";
        if (!id || id.length > 160) return [];
        const aspectRatios = Array.isArray(item.supported_aspect_ratios)
          ? item.supported_aspect_ratios.filter((ratio): ratio is string => typeof ratio === "string" && /^\d{1,4}(?:\.\d{1,2})?:\d{1,4}(?:\.\d{1,2})?$/.test(ratio))
          : [];
        return [{
          id,
          name: typeof item.name === "string" ? item.name : id,
          capabilities: { ...UNKNOWN, outputModalities: ["video"], source: "provider", ...(aspectRatios.length ? { aspectRatios } : {}) },
        }];
      }).filter((model) => supports(model, "video", provider)).sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)).slice(0, 2500);
    }

    let url: string;
    let headers: Record<string, string> = {};
    if (provider === "anthropic") { url = "https://api.anthropic.com/v1/models?limit=1000"; headers = { "x-api-key": apiKey, "anthropic-version": "2023-06-01" }; }
    else if (provider === "openai") { url = "https://api.openai.com/v1/models"; headers = { Authorization: `Bearer ${apiKey}` }; }
    else if (provider === "openrouter") { url = "https://openrouter.ai/api/v1/models"; headers = { ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}), ...(this.opts.appUrl ? { "HTTP-Referer": this.opts.appUrl, "X-Title": "Kavero" } : {}) }; }
    else {
      if (!baseUrl) throw new TRPCError({ code: "BAD_REQUEST", message: "Enter the OpenAI-compatible server URL" });
      await assertPublicUrl(baseUrl, this.opts).catch((e: Error) => { throw new TRPCError({ code: "BAD_REQUEST", message: e.message }); });
      url = `${baseUrl.replace(/\/+$/, "")}/models`;
      headers = apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
    }
    const fetcher = provider === "openai-compatible" ? (input: string, init: RequestInit) => safeFetch(input, init, this.opts) : (input: string, init: RequestInit) => fetch(input, init);
    const response = await fetcher(url, { headers, signal: AbortSignal.timeout(20_000) }).catch((error: Error) => {
      throw new TRPCError({ code: "BAD_REQUEST", message: `Could not load models from ${PROVIDER_LABEL[provider]}: ${error.message}` });
    });
    const data = await readModelResponse(response) as { data?: unknown; error?: { message?: string } } | null;
    if (!response.ok) throw new TRPCError({ code: "BAD_REQUEST", message: `Could not load models from ${PROVIDER_LABEL[provider]}: ${data?.error?.message ?? `HTTP ${response.status}`}` });
    if (!Array.isArray(data?.data)) throw new TRPCError({ code: "BAD_GATEWAY", message: "The provider returned an unexpected model list" });
    return data.data.flatMap((entry): ProviderModel[] => {
      if (!entry || typeof entry !== "object") return [];
      const item = entry as Record<string, unknown>;
      const id = typeof item.id === "string" ? item.id.trim() : "";
      if (!id || id.length > 160) return [];
      return [{ id, name: typeof item.name === "string" ? item.name : typeof item.display_name === "string" ? item.display_name : id, capabilities: asCapabilities(provider, id, item) }];
    }).sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)).slice(0, 2500);
  }

  async models(userId: string, input: { provider: AiProvider; purpose: AiPurpose; apiKey?: string; baseUrl?: string }) {
    const connection = await this.find(userId, input.provider);
    const apiKey = await this.keyFor(userId, input.provider, input.apiKey);
    if (input.provider !== "openrouter" && input.provider !== "openai-compatible" && !apiKey) throw new TRPCError({ code: "BAD_REQUEST", message: "Enter an API key to load this provider's models" });
    const models = await this.modelRequest(input.provider, input.baseUrl ?? connection?.baseUrl ?? undefined, apiKey, input.purpose);
    return models.filter((model) => supports(model, input.purpose, input.provider));
  }

  async set(userId: string, input: CredentialInput) {
    const apiKey = await this.keyFor(userId, input.provider, input.apiKey);
    if (input.provider !== "openai-compatible" && !apiKey) throw new TRPCError({ code: "BAD_REQUEST", message: "Enter an API key" });
    if (input.apiKey && (input.apiKey.trim().length < 8 || input.apiKey.trim().length > 400)) throw new TRPCError({ code: "BAD_REQUEST", message: "That API key doesn't look right" });
    if (input.provider === "openai-compatible") {
      if (!input.baseUrl) throw new TRPCError({ code: "BAD_REQUEST", message: "Enter the server URL" });
      await assertPublicUrl(input.baseUrl, this.opts).catch((e: Error) => { throw new TRPCError({ code: "BAD_REQUEST", message: e.message }); });
    }
    // Model discovery is the connection check. No task model is stored on the connection.
    const discovered = await this.modelRequest(input.provider, input.baseUrl, apiKey);
    if (!discovered.length) throw new TRPCError({ code: "BAD_REQUEST", message: `No models were returned by ${PROVIDER_LABEL[input.provider]}. Check the key and connection settings.` });
    const existing = await this.find(userId, input.provider);
    const key = input.apiKey?.trim();
    const values = {
      baseUrl: input.provider === "openai-compatible" ? input.baseUrl!.trim() : null,
      encryptedKey: key ? this.box.seal(key) : existing?.encryptedKey ?? null,
      keyHint: key ? key.slice(-4) : existing?.keyHint ?? null,
      updatedAt: new Date(),
    };
    await this.db.insert(aiCredential).values({ userId, provider: input.provider, ...values })
      .onConflictDoUpdate({ target: [aiCredential.userId, aiCredential.provider], set: values });
    await audit(this.db, { userId, action: existing ? "ai:provider_update" : "ai:provider_add", target: input.provider, outcome: "ok", details: { provider: input.provider } });
    return { ...(await this.list(userId)).find((row) => row.provider === input.provider)!, connection: { ok: true } };
  }

  async setAssignment(userId: string, input: { purpose: AiPurpose; provider: AiProvider; model: string }) {
    const connection = await this.find(userId, input.provider);
    if (!connection) throw new TRPCError({ code: "NOT_FOUND", message: "Connect this provider before assigning it" });
    const apiKey = connection.encryptedKey ? this.box.open(connection.encryptedKey) : "";
    const models = await this.modelRequest(input.provider, connection.baseUrl ?? undefined, apiKey, input.purpose);
    const selected = models.find((model) => model.id === input.model);
    if (!selected || !supports(selected, input.purpose, input.provider)) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "That model does not have verified support for this concern. Refresh the model list and choose a supported model." });
    }
    await this.db.insert(aiModelAssignment).values({ userId, ...input, modelCapabilities: selected.capabilities, updatedAt: new Date() })
      .onConflictDoUpdate({ target: [aiModelAssignment.userId, aiModelAssignment.purpose], set: { provider: input.provider, model: input.model, modelCapabilities: selected.capabilities, updatedAt: new Date() } });
    await audit(this.db, { userId, action: "ai:model_assignment", target: input.purpose, outcome: "ok", details: { purpose: input.purpose, provider: input.provider, model: input.model } });
    return this.assignments(userId);
  }

  async clearAssignment(userId: string, purpose: AiPurpose) {
    await this.db.delete(aiModelAssignment).where(and(eq(aiModelAssignment.userId, userId), eq(aiModelAssignment.purpose, purpose)));
    return this.assignments(userId);
  }

  async remove(userId: string, provider: AiProvider) {
    const removed = await this.db.delete(aiCredential).where(and(eq(aiCredential.userId, userId), eq(aiCredential.provider, provider))).returning({ provider: aiCredential.provider });
    if (!removed.length) throw new TRPCError({ code: "NOT_FOUND", message: "Provider not found" });
    await audit(this.db, { userId, action: "ai:provider_remove", target: provider, outcome: "ok", details: { provider } });
    return { providers: await this.list(userId), assignments: await this.assignments(userId) };
  }

  private async assignedCredential(userId: string, purpose: AiPurpose) {
    const assignment = await this.assignment(userId, purpose);
    if (!assignment) return null;
    const credential = await this.find(userId, assignment.provider);
    if (!credential) return null;
    const apiKey = credential.encryptedKey ? this.box.open(credential.encryptedKey) : "";
    if (assignment.provider === "openai-compatible" && credential.baseUrl) await assertPublicUrl(credential.baseUrl, this.opts);
    return { assignment, credential, apiKey };
  }

  async defaultModel(userId: string) {
    const row = await this.assignment(userId, "text");
    return row ? { provider: row.provider, model: row.model, capabilities: row.modelCapabilities } : null;
  }

  async provider(userId: string, purpose: AiPurpose = "text"): Promise<LlmProvider | null> {
    const saved = await this.assignedCredential(userId, purpose);
    if (!saved) return null;
    return providerFromCredential({ provider: saved.assignment.provider, apiKey: saved.apiKey, model: saved.assignment.model, baseUrl: saved.credential.baseUrl, appUrl: this.opts.appUrl, fetch: (url, init) => safeFetch(url, init, this.opts) });
  }

  async mediaCredential(userId: string, purpose: Exclude<AiPurpose, "text">) {
    const saved = await this.assignedCredential(userId, purpose);
    if (!saved) throw new TRPCError({ code: "PRECONDITION_FAILED", message: `Assign an image or video model in Settings → AI before generating ${purpose === "image" ? "images" : "videos"}.` });
    return {
      provider: saved.assignment.provider,
      model: saved.assignment.model,
      apiKey: saved.apiKey,
      baseUrl: saved.credential.baseUrl,
      appUrl: this.opts.appUrl,
      ...(purpose === "video" && saved.assignment.provider === "openrouter"
        ? { supportedAspectRatios: saved.assignment.modelCapabilities.aspectRatios ?? [] }
        : {}),
      ...(saved.assignment.provider === "openai-compatible"
        ? { fetch: (url: string, init: RequestInit) => safeFetch(url, init, this.opts) }
        : {}),
    };
  }
}
