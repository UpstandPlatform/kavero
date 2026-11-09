import { defineRelationsPart } from "drizzle-orm";
import { index, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

import { user } from "./auth";

export const WORKSPACE_ROLES = ["owner", "admin", "editor", "viewer"] as const;
export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];

/** A shared space for a team's catalogs. Personal catalogs have no workspace. */
export const workspace = pgTable("workspace", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const workspaceMember = pgTable(
  "workspace_member",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull().references(() => workspace.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    role: text("role", { enum: WORKSPACE_ROLES }).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [uniqueIndex("workspace_member_ws_user_idx").on(t.workspaceId, t.userId), index("workspace_member_user_idx").on(t.userId)],
);

/** Invitation link for an email address; only a hash of the token is stored. */
export const workspaceInvite = pgTable(
  "workspace_invite",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull().references(() => workspace.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: text("role", { enum: WORKSPACE_ROLES }).notNull(),
    tokenHash: text("token_hash").notNull(),
    invitedBy: text("invited_by").references(() => user.id, { onDelete: "set null" }),
    expiresAt: timestamp("expires_at").notNull(),
    acceptedAt: timestamp("accepted_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [uniqueIndex("workspace_invite_token_idx").on(t.tokenHash), index("workspace_invite_ws_idx").on(t.workspaceId)],
);

export const workspaceRelations = defineRelationsPart({ user, workspace, workspaceMember, workspaceInvite }, (r) => ({
  workspace: {
    members: r.many.workspaceMember({ from: r.workspace.id, to: r.workspaceMember.workspaceId }),
    invites: r.many.workspaceInvite({ from: r.workspace.id, to: r.workspaceInvite.workspaceId }),
  },
  workspaceMember: {
    workspace: r.one.workspace({ from: r.workspaceMember.workspaceId, to: r.workspace.id }),
    user: r.one.user({ from: r.workspaceMember.userId, to: r.user.id }),
  },
  workspaceInvite: { workspace: r.one.workspace({ from: r.workspaceInvite.workspaceId, to: r.workspace.id }) },
}));
