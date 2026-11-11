import { WORKSPACE_ROLES } from "@Kavero/db/schema/workspace";
import { z } from "zod";

import { protectedProcedure, publicProcedure, router } from "../index";
import { CatalogService } from "../services/catalog-service";
import { WorkspaceService } from "../services/workspace-service";
import { audit } from "../services/audit-service";

const id = z.string().min(1).max(100);
const role = z.enum(WORKSPACE_ROLES);

/** Team workspaces and role-based membership. */
export const workspaceRouter = router({
  list: protectedProcedure.query(({ ctx }) => new WorkspaceService(ctx.db).list(ctx.session.user.id)),
  create: protectedProcedure.input(z.object({ name: z.string().min(1).max(80) })).mutation(({ ctx, input }) => audited(ctx, "workspace:create", null, { name: input.name }, (userId) => new WorkspaceService(ctx.db).create(userId, input.name))),
  rename: protectedProcedure.input(z.object({ workspaceId: id, name: z.string().min(1).max(80) })).mutation(({ ctx, input }) => audited(ctx, "workspace:rename", input.workspaceId, { name: input.name }, (userId) => new WorkspaceService(ctx.db).rename(userId, input.workspaceId, input.name))),
  remove: protectedProcedure.input(z.object({ workspaceId: id })).mutation(({ ctx, input }) => audited(ctx, "workspace:delete", input.workspaceId, undefined, (userId) => new WorkspaceService(ctx.db).remove(userId, input.workspaceId))),
  members: protectedProcedure.input(z.object({ workspaceId: id })).query(({ ctx, input }) => new WorkspaceService(ctx.db).members(ctx.session.user.id, input.workspaceId)),
  invite: protectedProcedure.input(z.object({ workspaceId: id, email: z.string().max(200), role })).mutation(({ ctx, input }) => audited(ctx, "workspace:invite", input.workspaceId, { email: input.email.trim().toLowerCase(), role: input.role }, (userId) => new WorkspaceService(ctx.db).invite(userId, input.workspaceId, input.email, input.role))),
  revokeInvite: protectedProcedure.input(z.object({ workspaceId: id, inviteId: id })).mutation(({ ctx, input }) => audited(ctx, "workspace:revoke_invite", input.workspaceId, { inviteId: input.inviteId }, (userId) => new WorkspaceService(ctx.db).revokeInvite(userId, input.workspaceId, input.inviteId))),
  previewInvite: publicProcedure.input(z.object({ token: z.string().max(200) })).query(({ ctx, input }) => new WorkspaceService(ctx.db).previewInvite(input.token)),
  acceptInvite: protectedProcedure.input(z.object({ token: z.string().max(200) })).mutation(({ ctx, input }) => audited(ctx, "workspace:accept_invite", null, undefined, (userId) => new WorkspaceService(ctx.db).acceptInvite(userId, ctx.session.user.email, input.token), (result) => result.workspaceId)),
  setRole: protectedProcedure.input(z.object({ workspaceId: id, userId: id, role })).mutation(({ ctx, input }) => audited(ctx, "workspace:set_role", input.workspaceId, { memberId: input.userId, role: input.role }, (userId) => new WorkspaceService(ctx.db).setRole(userId, input.workspaceId, input.userId, input.role))),
  removeMember: protectedProcedure.input(z.object({ workspaceId: id, userId: id })).mutation(({ ctx, input }) => audited(ctx, "workspace:remove_member", input.workspaceId, { memberId: input.userId }, (userId) => new WorkspaceService(ctx.db).removeMember(userId, input.workspaceId, input.userId))),
  moveCatalog: protectedProcedure.input(z.object({ catalogId: id, workspaceId: id.nullable() })).mutation(({ ctx, input }) => audited(ctx, "catalog:move_workspace", input.catalogId, { workspaceId: input.workspaceId }, (userId) => new CatalogService(ctx.db).moveToWorkspace(userId, input.catalogId, input.workspaceId))),
});

async function audited<T>(
  ctx: { db: Parameters<typeof audit>[0]; session: { user: { id: string } } },
  action: string,
  target: string | null,
  details: unknown,
  work: (userId: string) => Promise<T>,
  resultTarget?: (result: T) => string | null,
) {
  const userId = ctx.session.user.id;
  try {
    const result = await work(userId);
    await audit(ctx.db, { userId, action, target: resultTarget?.(result) ?? target, outcome: "ok", details });
    return result;
  } catch (error) {
    await audit(ctx.db, { userId, action, target, outcome: "error" });
    throw error;
  }
}
