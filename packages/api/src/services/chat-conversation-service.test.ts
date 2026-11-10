import { expect, test } from "bun:test";
import { createDb, runMigrations } from "@Kavero/db";
import { user } from "@Kavero/db/schema/auth";
import { fileURLToPath } from "node:url";

import { CHAT_MESSAGE_LIMIT, ChatConversationService, mergeChatMessages } from "./chat-conversation-service";

test("merges local messages by id without overwriting the account copy", () => {
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

test("uses conversation revisions to reject stale turns and prevent late streams from undoing clear", async () => {
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

  const store = new ChatConversationService(db);
  const initial = [{ id: "user-1", role: "user", parts: [{ type: "text", text: "Hello" }] }];
  const revision = await store.save(userId, "editor", "cat_local", initial);

  expect(revision).toBe(1);
  expect(await store.load(userId, "editor", "cat_local")).toEqual({ exists: true, revision: 1, messages: initial });
  expect(await store.load(otherUserId, "editor", "cat_local")).toEqual({ exists: false, revision: null, messages: [] });
  const turn = [...initial, { id: "user-2", role: "user", parts: [{ type: "text", text: "Follow up" }] }];
  const turnRevision = await store.beginTurn(userId, "editor", "cat_local", revision!, turn);
  expect(turnRevision).toBe(2);
  expect(await store.beginTurn(userId, "editor", "cat_local", revision!, turn)).toBeUndefined();
  expect(await store.clear(userId, "editor", "cat_local")).toBe(3);
  expect(await store.saveIfRevision(userId, "editor", "cat_local", turnRevision!, [...turn, { id: "assistant-late" }])).toBe(false);
  expect(await store.load(userId, "editor", "cat_local")).toEqual({ exists: true, revision: 3, messages: [] });

  const firstTurn = await store.beginTurn(otherUserId, "landing", "landing", null, [{ id: "landing-user" }]);
  expect(firstTurn).toBe(1);
  expect(await store.beginTurn(otherUserId, "landing", "landing", null, [{ id: "stale-user" }])).toBeUndefined();
  expect(await store.clear(otherUserId, "landing", "landing")).toBe(2);
  expect(await store.load(otherUserId, "landing", "landing")).toEqual({ exists: true, revision: 2, messages: [] });
});
