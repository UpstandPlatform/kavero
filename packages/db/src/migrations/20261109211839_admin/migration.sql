CREATE TABLE "app_setting" (
	"key" text PRIMARY KEY,
	"value" jsonb NOT NULL,
	"updated_by" text,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "session" ADD COLUMN "impersonated_by" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "role" text DEFAULT 'user' NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "banned" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "ban_reason" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "ban_expires" timestamp;--> statement-breakpoint
ALTER TABLE "app_setting" ADD CONSTRAINT "app_setting_updated_by_user_id_fkey" FOREIGN KEY ("updated_by") REFERENCES "user"("id") ON DELETE SET NULL;--> statement-breakpoint
-- Existing servers: the oldest account becomes the admin (new servers: the first sign-up).
UPDATE "user" SET "role" = 'admin' WHERE "id" = (SELECT "id" FROM "user" ORDER BY "created_at" ASC LIMIT 1) AND NOT EXISTS (SELECT 1 FROM "user" WHERE "role" = 'admin');
