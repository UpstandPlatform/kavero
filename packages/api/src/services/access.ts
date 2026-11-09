import type { Database } from "@Kavero/db";
import { catalog } from "@Kavero/db/schema/catalog";
import { workspaceMember, type WorkspaceRole } from "@Kavero/db/schema/workspace";
import { TRPCError } from "@trpc/server";
import { and, eq, isNotNull, isNull, or, sql } from "drizzle-orm";

export type CatalogPermission = "read" | "write" | "delete" | "publish";

/** Which workspace roles may do what. Personal catalogs: the owner may do everything. */
export const ROLE_PERMISSIONS: Record<WorkspaceRole, CatalogPermission[]> = {
  owner: ["read", "write", "delete", "publish"],
  admin: ["read", "write", "delete", "publish"],
  editor: ["read", "write"],
  viewer: ["read"],
};

export type CatalogRow = typeof catalog.$inferSelect;
export interface AccessibleCatalog {
  row: CatalogRow;
  /** "owner" for personal catalogs, otherwise the member's workspace role. */
  role: WorkspaceRole;
}

/** True when `id` is a document id (cat_…) rather than a server row id. */
const matchId = (id: string) => (id.startsWith("cat_") ? eq(catalog.documentId, id) : eq(catalog.id, id));

/** Rows the user can see at all: own personal catalogs + catalogs of workspaces they belong to. */
export function visibleTo(userId: string) {
  return or(and(isNull(catalog.workspaceId), eq(catalog.ownerId, userId)), isNotNull(workspaceMember.id));
}

export function memberJoin(userId: string) {
  return and(eq(workspaceMember.workspaceId, catalog.workspaceId), eq(workspaceMember.userId, userId));
}

/**
 * Find a catalog the user may act on, or throw NOT_FOUND (can't see it) /
 * FORBIDDEN (can see it, role too low). Used by every catalog operation.
 */
export async function requireCatalog(db: Database, userId: string, id: string, need: CatalogPermission, opts: { forUpdate?: boolean } = {}): Promise<AccessibleCatalog> {
  let q = db
    .select({ row: catalog, memberRole: workspaceMember.role })
    .from(catalog)
    .leftJoin(workspaceMember, memberJoin(userId))
    .where(and(matchId(id), visibleTo(userId)))
    // Prefer the user's own personal copy when a document id matches several rows.
    .orderBy(sql`case when ${catalog.workspaceId} is null then 0 else 1 end`)
    .limit(1)
    .$dynamic();
  if (opts.forUpdate) q = q.for("update", { of: catalog });
  const [hit] = await q;
  if (!hit) throw new TRPCError({ code: "NOT_FOUND", message: "Catalog not found" });
  const role: WorkspaceRole = hit.row.workspaceId ? (hit.memberRole ?? "viewer") : "owner";
  if (!ROLE_PERMISSIONS[role].includes(need)) {
    throw new TRPCError({ code: "FORBIDDEN", message: `Your role (${role}) can't ${need === "write" ? "edit" : need} this catalog` });
  }
  return { row: hit.row, role };
}

/** Role of a user in a workspace, or null. */
export async function workspaceRole(db: Database, userId: string, workspaceId: string): Promise<WorkspaceRole | null> {
  const [m] = await db.select({ role: workspaceMember.role }).from(workspaceMember).where(and(eq(workspaceMember.workspaceId, workspaceId), eq(workspaceMember.userId, userId))).limit(1);
  return m?.role ?? null;
}
