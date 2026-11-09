import { AiError, providerFromCredential, type LlmProvider, type PersonalProvider } from "@Kavero/ai";
import type { Database } from "@Kavero/db";
import { aiCredential } from "@Kavero/db/schema/integration";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { assertPublicUrl } from "./safe-fetch";
import type { SecretBox } from "./secret-box";

export const PROVIDER_LABEL: Record<PersonalProvider, string> = {
  anthropic: "Claude (Anthropic)",
  openrouter: "OpenRouter",
  openai: "OpenAI",
  "openai-compatible": "OpenAI-compatible server",
};

export interface CredentialInput {
  provider: PersonalProvider;
  /** Omit to keep the stored key (e.g. when only changing the model). */
  apiKey?: string;
  model?: string;
  baseUrl?: string;
}

/**
 * Each user's own AI key. Stored sealed with the app secret; only a 4-character
 * hint ever leaves the server. Used in preference to the server's AI key.
 */
export class AiCredentialService {
  constructor(private readonly db: Database, private readonly box: SecretBox, private readonly opts: { allowLocal: boolean; appUrl?: string }) {}

  async get(userId: string) {
    const [row] = await this.db.select().from(aiCredential).where(eq(aiCredential.userId, userId)).limit(1);
    if (!row) return null;
    return { provider: row.provider, label: PROVIDER_LABEL[row.provider], model: row.model, baseUrl: row.baseUrl, hasKey: !!row.encryptedKey, keyHint: row.keyHint, updatedAt: row.updatedAt };
  }

  private async validate(input: CredentialInput, hasStoredKey: boolean) {
    const model = input.model?.trim();
    if (input.provider !== "anthropic" && !model) throw new TRPCError({ code: "BAD_REQUEST", message: "Enter a model id" });
    if (model && !/^[\w./:@-]{1,120}$/.test(model)) throw new TRPCError({ code: "BAD_REQUEST", message: "That model id has unexpected characters" });
    const key = input.apiKey?.trim();
    if (key !== undefined && key.length > 0 && (key.length < 8 || key.length > 400)) throw new TRPCError({ code: "BAD_REQUEST", message: "That API key doesn't look right" });
    if (input.provider !== "openai-compatible" && !key && !hasStoredKey) throw new TRPCError({ code: "BAD_REQUEST", message: "Enter an API key" });
    if (input.provider === "openai-compatible") {
      if (!input.baseUrl) throw new TRPCError({ code: "BAD_REQUEST", message: "Enter the server URL" });
      await assertPublicUrl(input.baseUrl, this.opts).catch((e: Error) => { throw new TRPCError({ code: "BAD_REQUEST", message: e.message }); });
    }
  }

  async set(userId: string, input: CredentialInput) {
    const [existing] = await this.db.select().from(aiCredential).where(eq(aiCredential.userId, userId)).limit(1);
    const sameProvider = existing?.provider === input.provider;
    await this.validate(input, !!existing?.encryptedKey && sameProvider);
    const key = input.apiKey?.trim();
    const values = {
      provider: input.provider,
      model: input.model?.trim() || null,
      baseUrl: input.provider === "openai-compatible" ? input.baseUrl!.trim() : null,
      ...(key ? { encryptedKey: this.box.seal(key), keyHint: key.slice(-4) } : sameProvider ? {} : { encryptedKey: null, keyHint: null }),
    };
    await this.db.insert(aiCredential).values({ userId, ...values }).onConflictDoUpdate({ target: aiCredential.userId, set: values });
    return this.get(userId);
  }

  async remove(userId: string) {
    await this.db.delete(aiCredential).where(eq(aiCredential.userId, userId));
    return { ok: true };
  }

  /** The user's own provider, or null when none is configured. */
  async provider(userId: string): Promise<LlmProvider | null> {
    const [row] = await this.db.select().from(aiCredential).where(eq(aiCredential.userId, userId)).limit(1);
    if (!row) return null;
    const apiKey = row.encryptedKey ? this.box.open(row.encryptedKey) : "";
    return providerFromCredential({ provider: row.provider, apiKey, model: row.model, baseUrl: row.baseUrl, appUrl: this.opts.appUrl });
  }

  /** A tiny structured request to prove the key and model work. */
  async test(userId: string) {
    const provider = await this.provider(userId).catch((e: Error) => { throw new TRPCError({ code: "BAD_REQUEST", message: e.message }); });
    if (!provider) throw new TRPCError({ code: "NOT_FOUND", message: "No personal AI key saved" });
    const started = Date.now();
    try {
      const r = await provider.generateObject({
        system: "You are a connectivity check. Reply with the requested JSON only.",
        prompt: 'Return {"ok": true, "word": "kavero"}.',
        schema: z.object({ ok: z.boolean(), word: z.string() }),
        schemaName: "connectivity_check",
        maxTokens: 2000,
        signal: AbortSignal.timeout(60_000),
      });
      return { ok: r.value.ok === true, model: r.model, ms: Date.now() - started };
    } catch (e) {
      throw new TRPCError({ code: "BAD_REQUEST", message: e instanceof AiError ? e.message : (e as Error).message });
    }
  }
}
