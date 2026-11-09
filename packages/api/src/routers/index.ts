import { protectedProcedure, publicProcedure, router } from "../index";
import { catalogRouter } from "./catalog";
import { publicationRouter } from "./publication";

export const appRouter = router({
  catalog: catalogRouter,
  publication: publicationRouter,
  healthCheck: publicProcedure.query(() => {
    return "OK";
  }),
  privateData: protectedProcedure.query(({ ctx }) => {
    return {
      message: "This is private",
      user: ctx.session.user,
    };
  }),
});
export type AppRouter = typeof appRouter;
