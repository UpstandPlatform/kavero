import { productSchema } from "@Kavero/catalog-engine";
import type { LlmProvider } from "@Kavero/ai";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import type { Context } from "../context";
import { protectedProcedure, publicProcedure, router } from "../index";
import { AiCredentialService } from "../services/ai-credential-service";
import { AiService } from "../services/ai-service";
import { audit } from "../services/audit-service";

const generateInput = z.object({
  brief: z.string().max(4000),
  products: z.array(productSchema).max(500).default([]),
  templateId: z.string().max(60).optional(),
  page: z.enum(["16:9", "4:3", "a4-portrait", "a4-landscape", "letter-portrait", "square"]).optional(),
  language: z.string().max(10).optional(),
  currency: z.string().length(3).optional(),
});

const credentialInput = z.object({
  provider: z.enum(["anthropic", "openrouter", "openai", "openai-compatible"]),
  apiKey: z.string().max(400).optional(),
  model: z.string().max(160),
  baseUrl: z.string().max(2000).optional(),
});
const providerModelInput = z.object({
  provider: z.enum(["anthropic", "openrouter", "openai", "openai-compatible"]),
  apiKey: z.string().max(400).optional(),
  baseUrl: z.string().max(2000).optional(),
});

function credentials(ctx: Context) {
  if (!ctx.secretBox) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Personal AI keys aren't configured on this server" });
  return new AiCredentialService(ctx.db, ctx.secretBox, { allowLocal: ctx.allowLocalUrls ?? false, appUrl: ctx.appUrl });
}

/** The user's own key first, then the server's. */
export async function resolveAi(ctx: Context, userId: string | undefined): Promise<{ provider: LlmProvider | null; source: "personal" | "server" | null }> {
  if (userId && ctx.secretBox) {
    const personal = await credentials(ctx).provider(userId).catch(() => null);
    if (personal) return { provider: personal, source: "personal" };
  }
  return ctx.ai ? { provider: ctx.ai, source: "server" } : { provider: null, source: null };
}

/** AI catalog generation and editing. Signed-in only (model calls cost money). */
export const aiRouter = router({
  status: publicProcedure.query(async ({ ctx }) => {
    const { provider, source } = await resolveAi(ctx, ctx.session?.user.id);
    const selected = ctx.session?.user.id && ctx.secretBox ? await credentials(ctx).defaultModel(ctx.session.user.id) : null;
    return { configured: !!provider, source, provider: provider?.id ?? null, model: provider?.model ?? null, capabilities: source === "personal" ? selected?.capabilities ?? null : null };
  }),
  generate: protectedProcedure.input(generateInput).mutation(async ({ ctx, input }) => {
    try {
      const { provider } = await resolveAi(ctx, ctx.session.user.id);
      const result = await new AiService(ctx.db, provider).generate(ctx.session.user.id, input);
      await audit(ctx.db, { userId: ctx.session.user.id, action: "ai:catalog_generate", target: result.document.metadata.title, outcome: "ok", details: { source: result.source, model: result.model } });
      return result;
    } catch (error) {
      await audit(ctx.db, { userId: ctx.session.user.id, action: "ai:catalog_generate", outcome: "error" });
      throw error;
    }
  }),
  edit: protectedProcedure
    .input(z.object({ document: z.unknown(), slideId: z.string().max(100), instruction: z.string().min(1).max(2000) }))
    .mutation(async ({ ctx, input }) => {
      try {
        const { provider } = await resolveAi(ctx, ctx.session.user.id);
        const result = await new AiService(ctx.db, provider).edit(ctx.session.user.id, input.document, input.slideId, input.instruction);
        await audit(ctx.db, { userId: ctx.session.user.id, action: "ai:slide_edit", target: input.slideId, outcome: "ok", details: { model: result.model } });
        return result;
      } catch (error) {
        await audit(ctx.db, { userId: ctx.session.user.id, action: "ai:slide_edit", target: input.slideId, outcome: "error" });
        throw error;
      }
    }),
  history: protectedProcedure.query(({ ctx }) => new AiService(ctx.db, null).history(ctx.session.user.id)),

  /** Personal AI key (Settings → AI). The key itself is never returned. */
  credential: router({
    list: protectedProcedure.query(({ ctx }) => credentials(ctx).list(ctx.session.user.id)),
    models: protectedProcedure.input(providerModelInput).query(({ ctx, input }) => credentials(ctx).models(ctx.session.user.id, input)),
    set: protectedProcedure.input(credentialInput).mutation(async ({ ctx, input }) => {
      try {
        return await credentials(ctx).set(ctx.session.user.id, input);
      } catch (error) {
        await audit(ctx.db, { userId: ctx.session.user.id, action: "ai:provider_save", target: input.provider, outcome: "error" });
        throw error;
      }
    }),
    setDefault: protectedProcedure.input(z.object({ provider: z.enum(["anthropic", "openrouter", "openai", "openai-compatible"]) })).mutation(async ({ ctx, input }) => {
      try {
        return await credentials(ctx).setDefault(ctx.session.user.id, input.provider);
      } catch (error) {
        await audit(ctx.db, { userId: ctx.session.user.id, action: "ai:provider_default", target: input.provider, outcome: "error" });
        throw error;
      }
    }),
    remove: protectedProcedure.input(z.object({ provider: z.enum(["anthropic", "openrouter", "openai", "openai-compatible"]) })).mutation(async ({ ctx, input }) => {
      try {
        return await credentials(ctx).remove(ctx.session.user.id, input.provider);
      } catch (error) {
        await audit(ctx.db, { userId: ctx.session.user.id, action: "ai:provider_remove", target: input.provider, outcome: "error" });
        throw error;
      }
    }),
  }),
});
