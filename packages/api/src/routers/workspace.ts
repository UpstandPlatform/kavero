import { WORKSPACE_ROLES } from "@Kavero/db/schema/workspace";
import { z } from "zod";

import { protectedProcedure, publicProcedure, router } from "../index";
import { CatalogService } from "../services/catalog-service";
import { WorkspaceService } from "../services/workspace-service";

const id = z.string().min(1).max(100);
const role = z.enum(WORKSPACE_ROLES);

/** Team workspaces and role-based membership. */
export const workspaceRouter = router({
  list: protectedProcedure.query(({ ctx }) => new WorkspaceService(ctx.db).list(ctx.session.user.id)),
  create: protectedProcedure.input(z.object({ name: z.string().min(1).max(80) })).mutation(({ ctx, input }) => new WorkspaceService(ctx.db).create(ctx.session.user.id, input.name)),
  rename: protectedProcedure.input(z.object({ workspaceId: id, name: z.string().min(1).max(80) })).mutation(({ ctx, input }) => new WorkspaceService(ctx.db).rename(ctx.session.user.id, input.workspaceId, input.name)),
  remove: protectedProcedure.input(z.object({ workspaceId: id })).mutation(({ ctx, input }) => new WorkspaceService(ctx.db).remove(ctx.session.user.id, input.workspaceId)),
  members: protectedProcedure.input(z.object({ workspaceId: id })).query(({ ctx, input }) => new WorkspaceService(ctx.db).members(ctx.session.user.id, input.workspaceId)),
  invite: protectedProcedure.input(z.object({ workspaceId: id, email: z.string().max(200), role })).mutation(({ ctx, input }) => new WorkspaceService(ctx.db).invite(ctx.session.user.id, input.workspaceId, input.email, input.role)),
  revokeInvite: protectedProcedure.input(z.object({ workspaceId: id, inviteId: id })).mutation(({ ctx, input }) => new WorkspaceService(ctx.db).revokeInvite(ctx.session.user.id, input.workspaceId, input.inviteId)),
  previewInvite: publicProcedure.input(z.object({ token: z.string().max(200) })).query(({ ctx, input }) => new WorkspaceService(ctx.db).previewInvite(input.token)),
  acceptInvite: protectedProcedure.input(z.object({ token: z.string().max(200) })).mutation(({ ctx, input }) => new WorkspaceService(ctx.db).acceptInvite(ctx.session.user.id, ctx.session.user.email, input.token)),
  setRole: protectedProcedure.input(z.object({ workspaceId: id, userId: id, role })).mutation(({ ctx, input }) => new WorkspaceService(ctx.db).setRole(ctx.session.user.id, input.workspaceId, input.userId, input.role)),
  removeMember: protectedProcedure.input(z.object({ workspaceId: id, userId: id })).mutation(({ ctx, input }) => new WorkspaceService(ctx.db).removeMember(ctx.session.user.id, input.workspaceId, input.userId)),
  moveCatalog: protectedProcedure.input(z.object({ catalogId: id, workspaceId: id.nullable() })).mutation(({ ctx, input }) => new CatalogService(ctx.db).moveToWorkspace(ctx.session.user.id, input.catalogId, input.workspaceId)),
});
