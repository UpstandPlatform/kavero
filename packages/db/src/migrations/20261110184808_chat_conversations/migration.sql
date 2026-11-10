CREATE TABLE "chat_conversation" (
	"id" text PRIMARY KEY,
	"user_id" text NOT NULL,
	"mode" text NOT NULL,
	"scope_id" text NOT NULL,
	"messages" jsonb DEFAULT '[]' NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "chat_conversation_user_scope_idx" ON "chat_conversation" ("user_id","mode","scope_id");--> statement-breakpoint
CREATE INDEX "chat_conversation_user_updated_idx" ON "chat_conversation" ("user_id","updated_at");--> statement-breakpoint
ALTER TABLE "chat_conversation" ADD CONSTRAINT "chat_conversation_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;