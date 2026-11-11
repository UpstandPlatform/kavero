import { defineRelationsPart } from "drizzle-orm";
import { index, integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

import { user } from "./auth";

/** Durable AI conversation threads, scoped to one user and catalog/landing assistant. */
export const chatConversation = pgTable(
  "chat_conversation",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    mode: text("mode", { enum: ["landing", "editor"] }).notNull(),
    /** `landing` for the landing assistant, or the local/cloud catalog document id. */
    scopeId: text("scope_id").notNull(),
    messages: jsonb("messages").$type<unknown[]>().notNull().default([]),
    revision: integer("revision").notNull().default(1),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().$onUpdate(() => new Date()).notNull(),
  },
  (table) => [
    index("chat_conversation_user_scope_updated_idx").on(table.userId, table.mode, table.scopeId, table.updatedAt),
    index("chat_conversation_user_updated_idx").on(table.userId, table.updatedAt),
  ],
);

export const chatRelations = defineRelationsPart({ user, chatConversation }, (r) => ({
  chatConversation: { owner: r.one.user({ from: r.chatConversation.userId, to: r.user.id }) },
}));
