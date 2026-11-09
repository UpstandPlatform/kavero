import { protectedProcedure, publicProcedure, router } from "../index";
import { adminRouter } from "./admin";
import { aiRouter } from "./ai";
import { catalogRouter } from "./catalog";
import { integrationsRouter } from "./integrations";
import { publicationRouter } from "./publication";
import { workspaceRouter } from "./workspace";

export const appRouter = router({
  catalog: catalogRouter,
  publication: publicationRouter,
  integrations: integrationsRouter,
  ai: aiRouter,
  admin: adminRouter,
  workspace: workspaceRouter,
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
