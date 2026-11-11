DROP INDEX "chat_conversation_user_scope_idx";--> statement-breakpoint
CREATE INDEX "chat_conversation_user_scope_updated_idx" ON "chat_conversation" ("user_id","mode","scope_id","updated_at");
