import { z } from "zod";

import { protectedProcedure, router } from "../index";
import { PublicationService } from "../services/publication-service";

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
      password: z.string().min(4).max(200).optional(),
      seoTitle: z.string().max(120).optional(),
      seoDescription: z.string().max(300).optional(),
    }))
    .mutation(({ ctx, input }) => new PublicationService(ctx.db).publish(ctx.session.user.id, input)),

  unpublish: protectedProcedure.input(z.object({ catalogId })).mutation(({ ctx, input }) => new PublicationService(ctx.db).unpublish(ctx.session.user.id, input.catalogId)),
});
