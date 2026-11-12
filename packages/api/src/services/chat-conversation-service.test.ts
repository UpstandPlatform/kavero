import { expect, test } from "bun:test";
import { createDb, runMigrations } from "@Kavero/db";
import { user } from "@Kavero/db/schema/auth";
import { fileURLToPath } from "node:url";

import { CHAT_MESSAGE_LIMIT, ChatConversationService, boundedMessages, mergeChatMessages } from "./chat-conversation-service";

async function setup() {
  const databaseUrl = "pglite:memory";
  const db = createDb({ DATABASE_URL: databaseUrl });
  const migrationsFolder = fileURLToPath(new URL("../../../db/src/migrations", import.meta.url));
  await runMigrations(db, databaseUrl, migrationsFolder);
  const userId = crypto.randomUUID();
  const otherUserId = crypto.randomUUID();
  await db.insert(user).values([
    { id: userId, name: "Chat owner", email: `${userId}@example.test` },
    { id: otherUserId, name: "Other user", email: `${otherUserId}@example.test` },
  ]);
  return { db, userId, otherUserId, store: new ChatConversationService(db) };
}

const userTurn = (id: string, text: string) => ({ id, role: "user", parts: [{ type: "text", text }] });

test("merges by id without overwriting the account copy", () => {
  const stored = [{ id: "one", text: "account version" }];
  const incoming = [{ id: "one", text: "stale local version" }, { id: "two", text: "new user turn" }];

  expect(mergeChatMessages(stored, incoming)).toEqual([
    { id: "one", text: "account version" },
    { id: "two", text: "new user turn" },
  ]);
});

test("keeps only the latest configured message count", () => {
  const messages = Array.from({ length: CHAT_MESSAGE_LIMIT + 7 }, (_, index) => ({ id: `message-${index}` }));
  const merged = mergeChatMessages([], messages);

  expect(merged).toHaveLength(CHAT_MESSAGE_LIMIT);
  expect(merged[0]?.id).toBe("message-7");
  expect(merged.at(-1)?.id).toBe(`message-${CHAT_MESSAGE_LIMIT + 6}`);
});

test("bounds transcripts by bytes, dropping the oldest messages first", () => {
  const messages = Array.from({ length: 10 }, (_, index) => ({ id: `m${index}`, text: "x".repeat(100) }));
  const oneSize = JSON.stringify(messages[0]).length;
  const bounded = boundedMessages(messages, 2 + oneSize * 3 + 2);

  expect(bounded.map((message) => message.id)).toEqual(["m7", "m8", "m9"]);
  expect(JSON.stringify(bounded).length).toBeLessThanOrEqual(2 + oneSize * 3 + 2);
  expect(boundedMessages(messages)).toEqual(messages);
  expect(() => boundedMessages([{ id: "huge", text: "x".repeat(200) }], 50)).toThrow();
});

test("uses conversation revisions to reject stale turns and prevent late streams from undoing clear", async () => {
  const { userId, otherUserId, store } = await setup();
  const conversationId = crypto.randomUUID();
  const initial = [userTurn("user-1", "Hello")];
  const revision = await store.save(userId, "editor", "cat_local", conversationId, initial);

  expect(revision).toBe(1);
  expect(await store.load(userId, "editor", "cat_local", conversationId)).toEqual({ exists: true, conversationId, revision: 1, messages: initial });
  expect(await store.load(otherUserId, "editor", "cat_local", conversationId)).toEqual({ exists: false, conversationId: null, revision: null, messages: [] });
  expect(await store.revision(userId, "editor", "cat_local", conversationId)).toBe(1);
  expect(await store.revision(otherUserId, "editor", "cat_local", conversationId)).toBeNull();

  const turn = [...initial, userTurn("user-2", "Follow up")];
  const turnRevision = await store.beginTurn(userId, "editor", "cat_local", conversationId, revision!, turn);
  expect(turnRevision).toBe(2);
  expect(await store.beginTurn(userId, "editor", "cat_local", conversationId, revision!, turn)).toBeUndefined();

  const secondConversationId = crypto.randomUUID();
  expect(await store.beginTurn(userId, "editor", "cat_local", secondConversationId, null, [userTurn("separate-user", "Second thread")])).toBe(1);
  expect(await store.load(userId, "editor", "cat_local", secondConversationId)).toMatchObject({ exists: true, conversationId: secondConversationId, revision: 1 });
  expect((await store.list(userId, "editor")).filter((item) => item.scopeId === "cat_local")).toHaveLength(2);

  expect(await store.clear(userId, "editor", "cat_local", conversationId)).toBe(3);
  expect(await store.saveIfRevision(userId, "editor", "cat_local", conversationId, turnRevision!, [...turn, { id: "assistant-late" }])).toBe(false);
  expect(await store.load(userId, "editor", "cat_local", conversationId)).toEqual({ exists: true, conversationId, revision: 3, messages: [] });

  const landingConversationId = crypto.randomUUID();
  const firstTurn = await store.beginTurn(otherUserId, "landing", "landing", landingConversationId, null, [userTurn("landing-user", "A catalog")]);
  expect(firstTurn).toBe(1);
  expect(await store.beginTurn(otherUserId, "landing", "landing", landingConversationId, null, [userTurn("stale-user", "Again")])).toBeUndefined();
  expect(await store.clear(otherUserId, "landing", "landing", landingConversationId)).toBe(2);
  expect(await store.load(otherUserId, "landing", "landing", landingConversationId)).toEqual({ exists: true, conversationId: landingConversationId, revision: 2, messages: [] });
});

test("history lists titles and counts without transcripts, skipping empty threads", async () => {
  const { userId, otherUserId, store } = await setup();
  const titled = crypto.randomUUID();
  const empty = crypto.randomUUID();
  await store.beginTurn(userId, "editor", "cat_a", titled, null, [userTurn("u1", "  Make   the cover\nbolder  "), { id: "a1", role: "assistant", parts: [{ type: "text", text: "Done" }] }]);
  await store.beginTurn(userId, "editor", "cat_b", empty, null, [userTurn("u2", "Something")]);
  await store.clear(userId, "editor", "cat_b", empty);
  await store.beginTurn(otherUserId, "editor", "cat_a", crypto.randomUUID(), null, [userTurn("u3", "Not yours")]);

  const items = await store.list(userId, "editor");
  expect(items).toHaveLength(1);
  expect(items[0]).toMatchObject({ id: titled, scopeId: "cat_a", title: "Make the cover bolder", messageCount: 2 });
  expect(items[0]).not.toHaveProperty("messages");
  expect(await store.list(userId, "landing")).toEqual([]);
});

test("detects ids that belong to another user or scope", async () => {
  const { userId, otherUserId, store } = await setup();
  const id = crypto.randomUUID();
  await store.beginTurn(otherUserId, "editor", "cat_other", id, null, [userTurn("u", "Hi")]);

  expect(await store.isTaken(id)).toBe(true);
  expect(await store.isTaken(crypto.randomUUID())).toBe(false);
  // A new turn under the same id for another user can never be inserted.
  expect(await store.beginTurn(userId, "editor", "cat_mine", id, null, [userTurn("u2", "Mine")])).toBeUndefined();
  expect(await store.delete(userId, id)).toBeNull();
});
