CREATE TABLE "ai_job" (
	"id" text PRIMARY KEY,
	"user_id" text,
	"kind" text NOT NULL,
	"prompt" text NOT NULL,
	"status" text NOT NULL,
	"source" text,
	"model" text,
	"input_tokens" integer,
	"output_tokens" integer,
	"summary" text,
	"error" text,
	"duration_ms" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "ai_job_user_created_idx" ON "ai_job" ("user_id","created_at");--> statement-breakpoint
ALTER TABLE "ai_job" ADD CONSTRAINT "ai_job_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;