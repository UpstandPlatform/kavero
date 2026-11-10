import { and, eq, sql } from "drizzle-orm";

import type { Database } from "@Kavero/db";
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

  async load(userId: string, mode: ChatConversationMode, scopeId: string): Promise<{ exists: boolean; revision: number | null; messages: unknown[] }> {
    const [row] = await this.db
      .select({ messages: chatConversation.messages, revision: chatConversation.revision })
      .from(chatConversation)
      .where(and(eq(chatConversation.userId, userId), eq(chatConversation.mode, mode), eq(chatConversation.scopeId, scopeId)))
      .limit(1);
    return {
      exists: !!row,
      revision: row?.revision ?? null,
      messages: Array.isArray(row?.messages) ? row.messages : [],
    };
  }

  async save(userId: string, mode: ChatConversationMode, scopeId: string, messages: StoredChatMessage[]): Promise<number | undefined> {
    const bounded = boundedMessages(messages);
    const [row] = await this.db
      .insert(chatConversation)
      .values({ id: crypto.randomUUID(), userId, mode, scopeId, messages: bounded })
      .onConflictDoUpdate({
        target: [chatConversation.userId, chatConversation.mode, chatConversation.scopeId],
        set: { messages: bounded, revision: sql`${chatConversation.revision} + 1`, updatedAt: new Date() },
      })
      .returning({ revision: chatConversation.revision });
    return row?.revision;
  }

  /** Persist a user turn only against the revision the client last loaded. */
  async beginTurn(
    userId: string,
    mode: ChatConversationMode,
    scopeId: string,
    expectedRevision: number | null,
    messages: StoredChatMessage[],
  ): Promise<number | undefined> {
    const bounded = boundedMessages(messages);
    if (expectedRevision === null) {
      const [row] = await this.db
        .insert(chatConversation)
        .values({ id: crypto.randomUUID(), userId, mode, scopeId, messages: bounded, revision: 1 })
        .onConflictDoNothing({ target: [chatConversation.userId, chatConversation.mode, chatConversation.scopeId] })
        .returning({ revision: chatConversation.revision });
      return row?.revision;
    }
    const [row] = await this.db
      .update(chatConversation)
      .set({ messages: bounded, revision: sql`${chatConversation.revision} + 1`, updatedAt: new Date() })
      .where(and(
        eq(chatConversation.userId, userId),
        eq(chatConversation.mode, mode),
        eq(chatConversation.scopeId, scopeId),
        eq(chatConversation.revision, expectedRevision),
      ))
      .returning({ revision: chatConversation.revision });
    return row?.revision;
  }

  /** Save a completed stream only when the conversation hasn't been cleared or superseded. */
  async saveIfRevision(userId: string, mode: ChatConversationMode, scopeId: string, revision: number, messages: StoredChatMessage[]) {
    const bounded = boundedMessages(messages);
    const [row] = await this.db
      .update(chatConversation)
      .set({ messages: bounded, revision: sql`${chatConversation.revision} + 1`, updatedAt: new Date() })
      .where(and(
        eq(chatConversation.userId, userId),
        eq(chatConversation.mode, mode),
        eq(chatConversation.scopeId, scopeId),
        eq(chatConversation.revision, revision),
      ))
      .returning({ revision: chatConversation.revision });
    return !!row;
  }

  /** Keep an empty row and advance its revision so a late stream cannot restore cleared messages. */
  async clear(userId: string, mode: ChatConversationMode, scopeId: string) {
    const [row] = await this.db
      .insert(chatConversation)
      .values({ id: crypto.randomUUID(), userId, mode, scopeId, messages: [] })
      .onConflictDoUpdate({
        target: [chatConversation.userId, chatConversation.mode, chatConversation.scopeId],
        set: { messages: [], revision: sql`${chatConversation.revision} + 1`, updatedAt: new Date() },
      })
      .returning({ revision: chatConversation.revision });
    return row?.revision;
  }
}
