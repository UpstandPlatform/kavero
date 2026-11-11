import { z } from "zod";

import { adminProcedure, publicProcedure, router } from "../index";
import { AdminService } from "../services/admin-service";
import { AUDIT_AREAS, audit } from "../services/audit-service";

const page = z.object({ query: z.string().max(200).optional(), limit: z.number().int().min(1).max(100).default(25), offset: z.number().int().min(0).default(0) });
const svc = (ctx: { db: ConstructorParameters<typeof AdminService>[0]; session: { user: { id: string } } }) => new AdminService(ctx.db, ctx.session.user.id);

/** Server administration (Admin page). Admins only. */
export const adminRouter = router({
  /** Whether the signed-in user is an admin, for showing the Admin link. */
  me: publicProcedure.query(async ({ ctx }) => ({ isAdmin: ctx.session?.user ? (ctx.session.user as { role?: string }).role === "admin" : false })),
  overview: adminProcedure.query(({ ctx }) => svc(ctx).overview()),
  users: router({
    list: adminProcedure.input(page).query(({ ctx, input }) => svc(ctx).listUsers(input)),
    setRole: adminProcedure.input(z.object({ userId: z.string().max(100), role: z.enum(["admin", "user"]) })).mutation(({ ctx, input }) => audited(ctx, "set-role", input.userId, () => svc(ctx).setRole(input.userId, input.role))),
    ban: adminProcedure
      .input(z.object({ userId: z.string().max(100), reason: z.string().max(500).optional(), days: z.number().int().min(1).max(3650).optional() }))
      .mutation(({ ctx, input }) => audited(ctx, "ban", input.userId, () => svc(ctx).ban(input.userId, input.reason, input.days))),
    unban: adminProcedure.input(z.object({ userId: z.string().max(100) })).mutation(({ ctx, input }) => audited(ctx, "unban", input.userId, () => svc(ctx).unban(input.userId))),
    revokeSessions: adminProcedure.input(z.object({ userId: z.string().max(100) })).mutation(({ ctx, input }) => audited(ctx, "revoke-sessions", input.userId, () => svc(ctx).revokeSessions(input.userId))),
    remove: adminProcedure.input(z.object({ userId: z.string().max(100) })).mutation(({ ctx, input }) => audited(ctx, "delete-user", input.userId, () => svc(ctx).deleteUser(input.userId))),
  }),
  settings: router({
    setSignupPolicy: adminProcedure.input(z.object({ policy: z.enum(["open", "invite-only", "closed"]) })).mutation(({ ctx, input }) => audited(ctx, "signup-policy", null, () => svc(ctx).setSignupPolicy(input.policy))),
  }),
  sites: router({
    list: adminProcedure.input(page).query(({ ctx, input }) => svc(ctx).listSites(input)),
    unpublish: adminProcedure.input(z.object({ publicationId: z.string().max(100) })).mutation(({ ctx, input }) => audited(ctx, "unpublish", input.publicationId, () => svc(ctx).unpublish(input.publicationId))),
  }),
  activity: adminProcedure
    .input(z.object({
      limit: z.number().int().min(1).max(100).default(50),
      before: z.coerce.date().optional(),
      beforeId: z.string().max(100).optional(),
      area: z.enum(AUDIT_AREAS).optional(),
      outcome: z.enum(["ok", "denied", "error"]).optional(),
      actor: z.string().max(200).optional(),
    }))
    .query(({ ctx, input }) => svc(ctx).activity(input)),
});

async function audited<T>(
  ctx: { db: Parameters<typeof audit>[0]; session: { user: { id: string } } },
  action: string,
  target: string | null,
  work: () => Promise<T>,
): Promise<T> {
  try {
    return await work();
  } catch (error) {
    await audit(ctx.db, { userId: ctx.session.user.id, action: `admin:${action}`, target, outcome: "error" });
    throw error;
  }
}
