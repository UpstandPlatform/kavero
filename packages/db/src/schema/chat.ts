import { defineRelationsPart } from "drizzle-orm";
import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

import { user } from "./auth";

/** One durable AI conversation per user and scope (the landing page or a catalog). */
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
    uniqueIndex("chat_conversation_user_scope_idx").on(table.userId, table.mode, table.scopeId),
    index("chat_conversation_user_updated_idx").on(table.userId, table.updatedAt),
  ],
);

export const chatRelations = defineRelationsPart({ user, chatConversation }, (r) => ({
  chatConversation: { owner: r.one.user({ from: r.chatConversation.userId, to: r.user.id }) },
}));
