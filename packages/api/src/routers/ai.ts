import { productSchema } from "@Kavero/catalog-engine";
import type { LlmProvider } from "@Kavero/ai";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import type { Context } from "../context";
import { protectedProcedure, publicProcedure, router } from "../index";
import { AiCredentialService } from "../services/ai-credential-service";
import { AiService } from "../services/ai-service";

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
  model: z.string().max(120).optional(),
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
    return { configured: !!provider, source, provider: provider?.id ?? null, model: provider?.model ?? null };
  }),
  generate: protectedProcedure.input(generateInput).mutation(async ({ ctx, input }) => {
    const { provider } = await resolveAi(ctx, ctx.session.user.id);
    return new AiService(ctx.db, provider).generate(ctx.session.user.id, input);
  }),
  edit: protectedProcedure
    .input(z.object({ document: z.unknown(), slideId: z.string().max(100), instruction: z.string().min(1).max(2000) }))
    .mutation(async ({ ctx, input }) => {
      const { provider } = await resolveAi(ctx, ctx.session.user.id);
      return new AiService(ctx.db, provider).edit(ctx.session.user.id, input.document, input.slideId, input.instruction);
    }),
  history: protectedProcedure.query(({ ctx }) => new AiService(ctx.db, null).history(ctx.session.user.id)),

  /** Personal AI key (Settings → AI). The key itself is never returned. */
  credential: router({
    get: protectedProcedure.query(({ ctx }) => credentials(ctx).get(ctx.session.user.id)),
    set: protectedProcedure.input(credentialInput).mutation(({ ctx, input }) => credentials(ctx).set(ctx.session.user.id, input)),
    remove: protectedProcedure.mutation(({ ctx }) => credentials(ctx).remove(ctx.session.user.id)),
    test: protectedProcedure.mutation(({ ctx }) => credentials(ctx).test(ctx.session.user.id)),
  }),
});
