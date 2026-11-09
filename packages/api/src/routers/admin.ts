import { z } from "zod";

import { adminProcedure, publicProcedure, router } from "../index";
import { AdminService } from "../services/admin-service";

const page = z.object({ query: z.string().max(200).optional(), limit: z.number().int().min(1).max(100).default(25), offset: z.number().int().min(0).default(0) });
const svc = (ctx: { db: ConstructorParameters<typeof AdminService>[0]; session: { user: { id: string } } }) => new AdminService(ctx.db, ctx.session.user.id);

/** Server administration (Admin page). Admins only. */
export const adminRouter = router({
  /** Whether the signed-in user is an admin, for showing the Admin link. */
  me: publicProcedure.query(async ({ ctx }) => ({ isAdmin: ctx.session?.user ? (ctx.session.user as { role?: string }).role === "admin" : false })),
  overview: adminProcedure.query(({ ctx }) => svc(ctx).overview()),
  users: router({
    list: adminProcedure.input(page).query(({ ctx, input }) => svc(ctx).listUsers(input)),
    setRole: adminProcedure.input(z.object({ userId: z.string().max(100), role: z.enum(["admin", "user"]) })).mutation(({ ctx, input }) => svc(ctx).setRole(input.userId, input.role)),
    ban: adminProcedure
      .input(z.object({ userId: z.string().max(100), reason: z.string().max(500).optional(), days: z.number().int().min(1).max(3650).optional() }))
      .mutation(({ ctx, input }) => svc(ctx).ban(input.userId, input.reason, input.days)),
    unban: adminProcedure.input(z.object({ userId: z.string().max(100) })).mutation(({ ctx, input }) => svc(ctx).unban(input.userId)),
    revokeSessions: adminProcedure.input(z.object({ userId: z.string().max(100) })).mutation(({ ctx, input }) => svc(ctx).revokeSessions(input.userId)),
    remove: adminProcedure.input(z.object({ userId: z.string().max(100) })).mutation(({ ctx, input }) => svc(ctx).deleteUser(input.userId)),
  }),
  settings: router({
    setSignupPolicy: adminProcedure.input(z.object({ policy: z.enum(["open", "invite-only", "closed"]) })).mutation(({ ctx, input }) => svc(ctx).setSignupPolicy(input.policy)),
  }),
  sites: router({
    list: adminProcedure.input(page).query(({ ctx, input }) => svc(ctx).listSites(input)),
    unpublish: adminProcedure.input(z.object({ publicationId: z.string().max(100) })).mutation(({ ctx, input }) => svc(ctx).unpublish(input.publicationId)),
  }),
  activity: adminProcedure
    .input(z.object({ limit: z.number().int().min(1).max(200).default(50), before: z.coerce.date().optional(), action: z.string().max(60).optional() }))
    .query(({ ctx, input }) => svc(ctx).activity(input)),
});
