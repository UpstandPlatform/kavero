import { and, desc, eq, sql } from "drizzle-orm";

import type { Database } from "@Kavero/db";
import { catalog } from "@Kavero/db/schema/catalog";
import { chatConversation } from "@Kavero/db/schema/chat";

export type ChatConversationMode = "landing" | "editor";
export type StoredChatMessage = { id: string };

export const CHAT_MESSAGE_LIMIT = 120;
const CHAT_BYTES_LIMIT = 12 * 1024 * 1024;

/** Merge local cache into the account copy using AI SDK's stable message IDs. */
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

function boundedMessages<T extends StoredChatMessage>(messages: T[]): T[] {
  let result = messages.slice(-CHAT_MESSAGE_LIMIT);
  const byteLength = (value: T[]) => new TextEncoder().encode(JSON.stringify(value)).byteLength;
  while (result.length > 1 && byteLength(result) > CHAT_BYTES_LIMIT) {
    result = result.slice(Math.ceil(result.length / 4));
  }
  if (byteLength(result) > CHAT_BYTES_LIMIT) throw new Error("This conversation is too large to save.");
  return result;
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

  async list(userId: string, mode: ChatConversationMode, limit = 50) {
    const rows = await this.db
      .select({
        id: chatConversation.id,
        mode: chatConversation.mode,
        scopeId: chatConversation.scopeId,
        messages: chatConversation.messages,
        updatedAt: chatConversation.updatedAt,
        catalogTitle: catalog.title,
      })
      .from(chatConversation)
      .leftJoin(catalog, and(eq(catalog.ownerId, userId), eq(catalog.documentId, chatConversation.scopeId)))
      .where(and(eq(chatConversation.userId, userId), eq(chatConversation.mode, mode)))
      .orderBy(desc(chatConversation.updatedAt))
      .limit(Math.max(1, Math.min(100, limit)));
    return rows.filter((row) => Array.isArray(row.messages) && row.messages.length > 0);
  }

  /** Delete only the conversation owned by this user. */
  async delete(userId: string, id: string) {
    const [row] = await this.db
      .delete(chatConversation)
      .where(and(eq(chatConversation.userId, userId), eq(chatConversation.id, id)))
      .returning({ id: chatConversation.id, mode: chatConversation.mode, scopeId: chatConversation.scopeId });
    return row ?? null;
  }

  async save(userId: string, mode: ChatConversationMode, scopeId: string, conversationId: string, messages: StoredChatMessage[]): Promise<number | undefined> {
    const bounded = boundedMessages(messages);
    const [row] = await this.db
      .insert(chatConversation)
      .values({ id: conversationId, userId, mode, scopeId, messages: bounded })
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
    const bounded = boundedMessages(messages);
    if (expectedRevision === null) {
      const [row] = await this.db
        .insert(chatConversation)
        .values({ id: conversationId, userId, mode, scopeId, messages: bounded, revision: 1 })
        .onConflictDoNothing({ target: chatConversation.id })
        .returning({ revision: chatConversation.revision });
      return row?.revision;
    }
    const [row] = await this.db
      .update(chatConversation)
      .set({ messages: bounded, revision: sql`${chatConversation.revision} + 1`, updatedAt: new Date() })
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

  /** Save a completed stream only when the conversation hasn't been cleared or superseded. */
  async saveIfRevision(userId: string, mode: ChatConversationMode, scopeId: string, conversationId: string, revision: number, messages: StoredChatMessage[]) {
    const bounded = boundedMessages(messages);
    const [row] = await this.db
      .update(chatConversation)
      .set({ messages: bounded, revision: sql`${chatConversation.revision} + 1`, updatedAt: new Date() })
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
      .set({ messages: [], revision: sql`${chatConversation.revision} + 1`, updatedAt: new Date() })
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
