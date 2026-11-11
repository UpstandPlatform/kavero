import { defineRelationsPart, sql } from "drizzle-orm";
import { boolean, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

import { user } from "./auth";

export type ModelCapabilities = {
  inputModalities: ("text" | "image" | "audio" | "video" | "file")[] | null;
  outputModalities: ("text" | "image" | "audio" | "video")[] | null;
  toolCalling: boolean | null;
  structuredOutput: boolean | null;
  maxInputTokens: number | null;
  source: "provider" | "curated" | "unknown";
};

export const AUDIT_AREAS = ["catalogs", "assets", "exports", "publication", "workspace", "ai", "api_keys", "integrations", "admin", "auth", "account"] as const;
export type AuditArea = (typeof AUDIT_AREAS)[number];
export const AUDIT_CHANNELS = ["web", "mcp", "admin", "system"] as const;
export type AuditChannel = (typeof AUDIT_CHANNELS)[number];

/** Security and activity record for API/MCP actions. */
export const auditLog = pgTable(
  "audit_log",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
    apiKeyId: text("api_key_id"),
    area: text("area").$type<AuditArea>().notNull().default("account"),
    channel: text("channel").$type<AuditChannel>().notNull().default("web"),
    action: text("action").notNull(),
    target: text("target"),
    outcome: text("outcome", { enum: ["ok", "denied", "error"] }).notNull(),
    details: jsonb("details"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("audit_log_user_created_idx").on(t.userId, t.createdAt),
    index("audit_log_area_created_idx").on(t.area, t.createdAt),
    index("audit_log_action_created_idx").on(t.action, t.createdAt),
  ],
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

export const integrationRelations = defineRelationsPart({ user, mcpConnection }, (r) => ({
  mcpConnection: { user: r.one.user({ from: r.mcpConnection.userId, to: r.user.id }) },
}));

/** AI generation and edit requests (history, cost tracking, debugging). */
export const aiJob = pgTable(
  "ai_job",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["generate", "edit"] }).notNull(),
    prompt: text("prompt").notNull(),
    status: text("status", { enum: ["ok", "error"] }).notNull(),
    source: text("source"),
    model: text("model"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    summary: text("summary"),
    error: text("error"),
    durationMs: integer("duration_ms"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("ai_job_user_created_idx").on(t.userId, t.createdAt)],
);

/** A user's encrypted provider connection. At most one is active as the default. */
export const aiCredential = pgTable(
  "ai_credential",
  {
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    provider: text("provider", { enum: ["anthropic", "openrouter", "openai", "openai-compatible"] }).notNull(),
    model: text("model"),
    baseUrl: text("base_url"),
    encryptedKey: text("encrypted_key"),
    keyHint: text("key_hint"),
    isDefault: boolean("is_default").notNull().default(false),
    modelCapabilities: jsonb("model_capabilities").$type<ModelCapabilities>(),
    updatedAt: timestamp("updated_at").defaultNow().$onUpdate(() => new Date()).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.provider] }),
    uniqueIndex("ai_credential_default_user_idx").on(t.userId).where(sql`${t.isDefault}`),
  ],
);

/** Server-wide settings managed by admins (Admin → Settings). One row per key. */
export const appSetting = pgTable("app_setting", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedBy: text("updated_by").references(() => user.id, { onDelete: "set null" }),
  updatedAt: timestamp("updated_at").defaultNow().$onUpdate(() => new Date()).notNull(),
});
