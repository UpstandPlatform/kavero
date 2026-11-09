import { z } from "zod";

import { protectedProcedure, router } from "../index";
import { CatalogService } from "../services/catalog-service";

const id = z.string().min(1).max(100);

/** Cloud catalogs for the signed-in user. Local-only use never calls these. */
export const catalogRouter = router({
  list: protectedProcedure.query(({ ctx }) => new CatalogService(ctx.db).list(ctx.session.user.id)),

  get: protectedProcedure.input(z.object({ id })).query(({ ctx, input }) => new CatalogService(ctx.db).get(ctx.session.user.id, input.id)),

  save: protectedProcedure
    .input(z.object({ document: z.unknown(), baseRevision: z.number().int().positive().optional(), thumbnail: z.string().max(200_000).optional(), workspaceId: z.string().max(100).nullish() }))
    .mutation(({ ctx, input }) => new CatalogService(ctx.db).save(ctx.session.user.id, input)),

  delete: protectedProcedure.input(z.object({ id })).mutation(async ({ ctx, input }) => {
    const { storageKeys } = await new CatalogService(ctx.db).delete(ctx.session.user.id, input.id);
    await ctx.deleteObjects?.(storageKeys).catch(() => undefined);
    return { ok: true };
  }),

  revisions: protectedProcedure.input(z.object({ id })).query(({ ctx, input }) => new CatalogService(ctx.db).revisions(ctx.session.user.id, input.id)),
});
