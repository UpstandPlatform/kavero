import { randomUUID } from "node:crypto";

import { and, eq, isNull } from "drizzle-orm";

import type { Database } from "./index";
import { catalog } from "./schema/catalog";
import { workspace, workspaceMember } from "./schema/workspace";

/**
 * Return (and, if needed, create) the protected default workspace for a user.
 * This is safe to call from account creation and on requests from older accounts.
 */
export async function ensurePersonalWorkspace(db: Database, userId: string) {
  return db.transaction(async (tx) => {
    let [personal] = await tx
      .select({ id: workspace.id })
      .from(workspace)
      .where(eq(workspace.personalOwnerId, userId))
      .limit(1);

    if (!personal) {
      [personal] = await tx
        .insert(workspace)
        .values({ id: randomUUID(), name: "Personal workspace", createdBy: userId, personalOwnerId: userId })
        .onConflictDoNothing({ target: workspace.personalOwnerId })
        .returning({ id: workspace.id });
    }

    // A concurrent first request may have inserted the row while this request
    // waited on the unique index, so read it again if our insert did nothing.
    if (!personal) {
      [personal] = await tx
        .select({ id: workspace.id })
        .from(workspace)
        .where(eq(workspace.personalOwnerId, userId))
        .limit(1);
    }
    if (!personal) throw new Error("Could not create the Personal workspace");

    await tx
      .insert(workspaceMember)
      .values({ id: randomUUID(), workspaceId: personal.id, userId, role: "owner" })
      .onConflictDoNothing({ target: [workspaceMember.workspaceId, workspaceMember.userId] });

    // Older accounts may have cloud catalogs that predate workspaces. Put
    // those catalogs in the default workspace as part of the same repair.
    await tx
      .update(catalog)
      .set({ workspaceId: personal.id })
      .where(and(eq(catalog.ownerId, userId), isNull(catalog.workspaceId)));

    return { id: personal.id, name: "Personal workspace", isPersonal: true as const };
  });
}
