import { defineRelationsPart } from "drizzle-orm";
import { index, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

import { user } from "./auth";

/**
 * Personal access tokens for MCP clients and other API callers.
 * Only a SHA-256 hash is stored; the token itself is shown once.
 */
export const apiToken = pgTable(
  "api_token",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** First characters, to recognise a token in the list. */
    prefix: text("prefix").notNull(),
    tokenHash: text("token_hash").notNull(),
    /** e.g. catalogs:read, catalogs:write, catalogs:delete, publish */
    scopes: jsonb("scopes").$type<string[]>().notNull(),
    lastUsedAt: timestamp("last_used_at"),
    expiresAt: timestamp("expires_at"),
    revokedAt: timestamp("revoked_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [uniqueIndex("api_token_hash_idx").on(t.tokenHash), index("api_token_user_idx").on(t.userId)],
);

/** Security and activity record for API/MCP actions. */
export const auditLog = pgTable(
  "audit_log",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
    tokenId: text("token_id"),
    /** e.g. "mcp:slide_add_element" */
    action: text("action").notNull(),
    target: text("target"),
    outcome: text("outcome", { enum: ["ok", "denied", "error"] }).notNull(),
    details: jsonb("details"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("audit_log_user_created_idx").on(t.userId, t.createdAt)],
);

/** External MCP servers a user connected (e.g. a store's product server). */
export const mcpConnection = pgTable(
  "mcp_connection",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    transport: text("transport", { enum: ["streamable-http", "sse"] }).notNull().default("streamable-http"),
    url: text("url").notNull(),
    authType: text("auth_type", { enum: ["none", "bearer", "header"] }).notNull().default("none"),
    /** Header name for authType "header". */
    authHeader: text("auth_header"),
    /** AES-256-GCM encrypted secret (never returned to clients). */
    encryptedSecret: text("encrypted_secret"),
    status: text("status", { enum: ["unknown", "ok", "error"] }).notNull().default("unknown"),
    lastError: text("last_error"),
    /** Tools and resources the server advertised at the last check. */
    capabilities: jsonb("capabilities"),
    lastCheckedAt: timestamp("last_checked_at"),
    lastSyncAt: timestamp("last_sync_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("mcp_connection_user_idx").on(t.userId)],
);

export const integrationRelations = defineRelationsPart({ user, apiToken, mcpConnection }, (r) => ({
  apiToken: { user: r.one.user({ from: r.apiToken.userId, to: r.user.id }) },
  mcpConnection: { user: r.one.user({ from: r.mcpConnection.userId, to: r.user.id }) },
}));
