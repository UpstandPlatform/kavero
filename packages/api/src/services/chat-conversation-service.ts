import { and, desc, eq, gt, sql } from "drizzle-orm";

import type { Database } from "@Kavero/db";
import { catalog } from "@Kavero/db/schema/catalog";
import { chatConversation } from "@Kavero/db/schema/chat";

import { chatTitle } from "./chat-message-utils";

export type ChatConversationMode = "landing" | "editor";
export type StoredChatMessage = { id: string };

export const CHAT_MESSAGE_LIMIT = 120;
export const CHAT_BYTES_LIMIT = 12 * 1024 * 1024;

/** Append messages the account copy doesn't have yet, using AI SDK's stable message IDs. The account copy wins. */
export function mergeChatMessages<T extends StoredChatMessage>(stored: T[], incoming: T[]): T[] {
  const merged = [...stored];
  const known = new Set(stored.map((message) => message.id));
  for (const message of incoming) {
    if (known.has(message.id)) continue;
    merged.push(message);
    known.add(message.id);
  }
  return merged.slice(-CHAT_MESSAGE_LIMIT);
}

/**
 * Keep the newest messages that fit both limits. Each message is serialized once, so this is
 * linear in the transcript size instead of re-stringifying the whole thread per trim.
 */
export function boundedMessages<T extends StoredChatMessage>(messages: T[], maxBytes = CHAT_BYTES_LIMIT): T[] {
  const recent = messages.slice(-CHAT_MESSAGE_LIMIT);
  const encoder = new TextEncoder();
  const sizes = recent.map((message) => encoder.encode(JSON.stringify(message)).byteLength);
  // `[` + `]` + one comma between messages.
  let total = 2 + Math.max(0, recent.length - 1) + sizes.reduce((sum, size) => sum + size, 0);
  let start = 0;
  while (total > maxBytes && recent.length - start > 1) {
    total -= sizes[start]! + 1;
    start += 1;
  }
  if (total > maxBytes) throw new Error("This conversation is too large to save.");
  return start ? recent.slice(start) : recent;
}

function summary(messages: StoredChatMessage[]) {
  const bounded = boundedMessages(messages);
  return { messages: bounded, title: chatTitle(bounded), messageCount: bounded.length };
}

/** PostgreSQL-backed durable transcript store. User id is part of every read/write predicate. */
export class ChatConversationService {
  constructor(private readonly db: Database) {}

  async load(userId: string, mode: ChatConversationMode, scopeId: string, conversationId?: string): Promise<{ exists: boolean; conversationId: string | null; revision: number | null; messages: unknown[] }> {
    const [row] = await this.db
      .select({ id: chatConversation.id, messages: chatConversation.messages, revision: chatConversation.revision })
      .from(chatConversation)
      .where(and(
        eq(chatConversation.userId, userId),
        eq(chatConversation.mode, mode),
        eq(chatConversation.scopeId, scopeId),
        ...(conversationId ? [eq(chatConversation.id, conversationId)] : []),
      ))
      .orderBy(desc(chatConversation.updatedAt))
      .limit(1);
    return {
      exists: !!row,
      conversationId: row?.id ?? null,
      revision: row?.revision ?? null,
      messages: Array.isArray(row?.messages) ? row.messages : [],
    };
  }

  /** The revision only, without reading the transcript. */
  async revision(userId: string, mode: ChatConversationMode, scopeId: string, conversationId: string): Promise<number | null> {
    const [row] = await this.db
      .select({ revision: chatConversation.revision })
      .from(chatConversation)
      .where(and(
        eq(chatConversation.userId, userId),
        eq(chatConversation.mode, mode),
        eq(chatConversation.scopeId, scopeId),
        eq(chatConversation.id, conversationId),
      ))
      .limit(1);
    return row?.revision ?? null;
  }

  /**
   * Whether an id is already used by any conversation (another user's, or another catalog's).
   * Conversation ids are global primary keys, so such an id can never be saved into this scope.
   */
  async isTaken(conversationId: string) {
    const [row] = await this.db.select({ id: chatConversation.id }).from(chatConversation).where(eq(chatConversation.id, conversationId)).limit(1);
    return !!row;
  }

  /** History list: titles and counts only (never the transcripts), non-empty threads only. */
  async list(userId: string, mode: ChatConversationMode, limit = 50) {
    const rows = await this.db
      .select({
        id: chatConversation.id,
        mode: chatConversation.mode,
        scopeId: chatConversation.scopeId,
        title: chatConversation.title,
        messageCount: chatConversation.messageCount,
        updatedAt: chatConversation.updatedAt,
        catalogTitle: catalog.title,
      })
      .from(chatConversation)
      .leftJoin(catalog, and(eq(catalog.ownerId, userId), eq(catalog.documentId, chatConversation.scopeId)))
      .where(and(eq(chatConversation.userId, userId), eq(chatConversation.mode, mode), gt(chatConversation.messageCount, 0)))
      .orderBy(desc(chatConversation.updatedAt))
      .limit(Math.max(1, Math.min(100, limit)));
    return rows.map((row) => ({ ...row, title: row.title || "Untitled chat" }));
  }

  /** Delete only the conversation owned by this user. */
  async delete(userId: string, id: string) {
    const [row] = await this.db
      .delete(chatConversation)
      .where(and(eq(chatConversation.userId, userId), eq(chatConversation.id, id)))
      .returning({ id: chatConversation.id, mode: chatConversation.mode, scopeId: chatConversation.scopeId });
    return row ?? null;
  }

  /** Create a conversation with an initial transcript (no-op if the id exists). */
  async save(userId: string, mode: ChatConversationMode, scopeId: string, conversationId: string, messages: StoredChatMessage[]): Promise<number | undefined> {
    const values = summary(messages);
    const [row] = await this.db
      .insert(chatConversation)
      .values({ id: conversationId, userId, mode, scopeId, ...values })
      .onConflictDoNothing({ target: chatConversation.id })
      .returning({ revision: chatConversation.revision });
    return row?.revision;
  }

  /** Persist a user turn only against the revision the client last loaded. */
  async beginTurn(
    userId: string,
    mode: ChatConversationMode,
    scopeId: string,
    conversationId: string,
    expectedRevision: number | null,
    messages: StoredChatMessage[],
  ): Promise<number | undefined> {
    const values = summary(messages);
    if (expectedRevision === null) {
      const [row] = await this.db
        .insert(chatConversation)
        .values({ id: conversationId, userId, mode, scopeId, ...values, revision: 1 })
        .onConflictDoNothing({ target: chatConversation.id })
        .returning({ revision: chatConversation.revision });
      return row?.revision;
    }
    const [row] = await this.db
      .update(chatConversation)
      .set({ ...values, revision: sql`${chatConversation.revision} + 1`, updatedAt: new Date() })
      .where(and(
        eq(chatConversation.userId, userId),
        eq(chatConversation.id, conversationId),
        eq(chatConversation.mode, mode),
        eq(chatConversation.scopeId, scopeId),
        eq(chatConversation.revision, expectedRevision),
      ))
      .returning({ revision: chatConversation.revision });
    return row?.revision;
  }

  /** Save a completed (or stopped) stream only when the conversation hasn't been cleared or superseded. */
  async saveIfRevision(userId: string, mode: ChatConversationMode, scopeId: string, conversationId: string, revision: number, messages: StoredChatMessage[]) {
    const values = summary(messages);
    const [row] = await this.db
      .update(chatConversation)
      .set({ ...values, revision: sql`${chatConversation.revision} + 1`, updatedAt: new Date() })
      .where(and(
        eq(chatConversation.userId, userId),
        eq(chatConversation.id, conversationId),
        eq(chatConversation.mode, mode),
        eq(chatConversation.scopeId, scopeId),
        eq(chatConversation.revision, revision),
      ))
      .returning({ revision: chatConversation.revision });
    return !!row;
  }

  /** Keep an empty row and advance its revision so a late stream cannot restore cleared messages. */
  async clear(userId: string, mode: ChatConversationMode, scopeId: string, conversationId: string) {
    const [row] = await this.db
      .update(chatConversation)
      .set({ messages: [], title: null, messageCount: 0, revision: sql`${chatConversation.revision} + 1`, updatedAt: new Date() })
      .where(and(
        eq(chatConversation.userId, userId),
        eq(chatConversation.id, conversationId),
        eq(chatConversation.mode, mode),
        eq(chatConversation.scopeId, scopeId),
      ))
      .returning({ revision: chatConversation.revision });
    return row?.revision;
  }
}
