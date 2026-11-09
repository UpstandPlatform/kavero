CREATE TABLE "ai_credential" (
	"user_id" text PRIMARY KEY,
	"provider" text NOT NULL,
	"model" text,
	"base_url" text,
	"encrypted_key" text,
	"key_hint" text,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_credential" ADD CONSTRAINT "ai_credential_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;