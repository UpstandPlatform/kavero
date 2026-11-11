import { initTRPC, TRPCError } from "@trpc/server";

import { user } from "@Kavero/db/schema/auth";
import { eq } from "drizzle-orm";

import type { Context } from "./context";
import { audit } from "./services/audit-service";

export const t = initTRPC.context<Context>().create();

export const router = t.router;

export const publicProcedure = t.procedure;

export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.session) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Authentication required",
      cause: "No session",
    });
  }
  return next({
    ctx: {
      ...ctx,
      session: ctx.session,
    },
  });
});

/** Signed in and an admin. The role is read from the database on every call. */
export const adminProcedure = protectedProcedure.use(async ({ ctx, next }) => {
  const [row] = await ctx.db.select({ role: user.role, banned: user.banned }).from(user).where(eq(user.id, ctx.session.user.id)).limit(1);
  if (row?.role !== "admin" || row.banned) {
    await audit(ctx.db, { userId: ctx.session.user.id, action: "admin:access_denied", outcome: "denied" });
    throw new TRPCError({ code: "FORBIDDEN", message: "Admins only" });
  }
  return next();
});
