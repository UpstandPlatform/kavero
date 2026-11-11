import { z } from "zod";

import { protectedProcedure, router } from "../index";
import { CatalogService } from "../services/catalog-service";
import { audit } from "../services/audit-service";

const id = z.string().min(1).max(100);

/** Cloud catalogs for the signed-in user. Local-only use never calls these. */
export const catalogRouter = router({
  list: protectedProcedure.query(({ ctx }) => new CatalogService(ctx.db).list(ctx.session.user.id)),

  get: protectedProcedure.input(z.object({ id })).query(({ ctx, input }) => new CatalogService(ctx.db).get(ctx.session.user.id, input.id)),

  save: protectedProcedure
    .input(z.object({ document: z.unknown(), baseRevision: z.number().int().positive().optional(), thumbnail: z.string().max(200_000).optional(), workspaceId: z.string().max(100).nullish() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      try {
        const result = await new CatalogService(ctx.db, ctx.deleteObjects).save(userId, input);
        await audit(ctx.db, { userId, action: result.created ? "catalog:create" : "catalog:save", target: result.id, outcome: "ok", details: { revision: result.revision, workspaceId: input.workspaceId ?? null } });
        return result;
      } catch (error) {
        await audit(ctx.db, { userId, action: "catalog:save", outcome: "error" });
        throw error;
      }
    }),

  delete: protectedProcedure.input(z.object({ id })).mutation(async ({ ctx, input }) => {
    const userId = ctx.session.user.id;
    try {
      const { storageKeys } = await new CatalogService(ctx.db).delete(userId, input.id);
      await ctx.deleteObjects?.(storageKeys).catch(() => undefined);
      await audit(ctx.db, { userId, action: "catalog:delete", target: input.id, outcome: "ok" });
      return { ok: true };
    } catch (error) {
      await audit(ctx.db, { userId, action: "catalog:delete", target: input.id, outcome: "error" });
      throw error;
    }
  }),

  revisions: protectedProcedure.input(z.object({ id })).query(({ ctx, input }) => new CatalogService(ctx.db).revisions(ctx.session.user.id, input.id)),
});
