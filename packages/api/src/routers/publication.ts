import { z } from "zod";

import { protectedProcedure, router } from "../index";
import { MIN_PASSWORD_LENGTH, PublicationService } from "../services/publication-service";
import { audit } from "../services/audit-service";

const catalogId = z.string().min(1).max(100);

/** Publishing cloud catalogs as websites. Owner-only; public pages read through the service directly. */
export const publicationRouter = router({
  status: protectedProcedure.input(z.object({ catalogId })).query(({ ctx, input }) => new PublicationService(ctx.db).status(ctx.session.user.id, input.catalogId)),

  checkSlug: protectedProcedure
    .input(z.object({ catalogId, slug: z.string().max(80) }))
    .query(({ ctx, input }) => new PublicationService(ctx.db).isSlugAvailable(ctx.session.user.id, input.catalogId, input.slug)),

  publish: protectedProcedure
    .input(z.object({
      catalogId,
      slug: z.string().max(80),
      visibility: z.enum(["public", "unlisted", "password", "private"]),
      password: z.string().min(MIN_PASSWORD_LENGTH, `Use a password of at least ${MIN_PASSWORD_LENGTH} characters`).max(200).optional(),
      seoTitle: z.string().max(120).optional(),
      seoDescription: z.string().max(300).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      try {
        const result = await new PublicationService(ctx.db).publish(userId, input);
        await audit(ctx.db, { userId, action: "publication:publish", target: input.catalogId, outcome: "ok", details: { slug: result.slug, visibility: input.visibility, version: result.version } });
        return result;
      } catch (error) {
        await audit(ctx.db, { userId, action: "publication:publish", target: input.catalogId, outcome: "error" });
        throw error;
      }
    }),

  unpublish: protectedProcedure.input(z.object({ catalogId })).mutation(async ({ ctx, input }) => {
    const userId = ctx.session.user.id;
    try {
      const result = await new PublicationService(ctx.db).unpublish(userId, input.catalogId);
      await audit(ctx.db, { userId, action: "publication:unpublish", target: input.catalogId, outcome: "ok" });
      return result;
    } catch (error) {
      await audit(ctx.db, { userId, action: "publication:unpublish", target: input.catalogId, outcome: "error" });
      throw error;
    }
  }),
});
