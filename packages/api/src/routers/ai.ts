import { productSchema } from "@Kavero/catalog-engine";
import { z } from "zod";

import { protectedProcedure, publicProcedure, router } from "../index";
import { AiService } from "../services/ai-service";

const generateInput = z.object({
  brief: z.string().max(4000),
  products: z.array(productSchema).max(500).default([]),
  templateId: z.string().max(60).optional(),
  page: z.enum(["16:9", "4:3", "a4-portrait", "a4-landscape", "letter-portrait", "square"]).optional(),
  language: z.string().max(10).optional(),
  currency: z.string().length(3).optional(),
});

/** AI catalog generation and editing. Signed-in only (model calls cost money). */
export const aiRouter = router({
  status: publicProcedure.query(({ ctx }) => new AiService(ctx.db, ctx.ai ?? null).status()),
  generate: protectedProcedure.input(generateInput).mutation(({ ctx, input }) => new AiService(ctx.db, ctx.ai ?? null).generate(ctx.session.user.id, input)),
  edit: protectedProcedure
    .input(z.object({ document: z.unknown(), slideId: z.string().max(100), instruction: z.string().min(1).max(2000) }))
    .mutation(({ ctx, input }) => new AiService(ctx.db, ctx.ai ?? null).edit(ctx.session.user.id, input.document, input.slideId, input.instruction)),
  history: protectedProcedure.query(({ ctx }) => new AiService(ctx.db, ctx.ai ?? null).history(ctx.session.user.id)),
});
