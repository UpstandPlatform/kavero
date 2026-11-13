CREATE TABLE "ai_model_assignment" (
	"user_id" text NOT NULL,
	"purpose" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"model_capabilities" jsonb NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "ai_model_assignment_user_id_purpose_pk" PRIMARY KEY("user_id", "purpose"),
	CONSTRAINT "ai_model_assignment_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE,
	CONSTRAINT "ai_model_assignment_provider_fk" FOREIGN KEY ("user_id", "provider") REFERENCES "ai_credential"("user_id", "provider") ON DELETE CASCADE
);
--> statement-breakpoint
INSERT INTO "ai_model_assignment" ("user_id", "purpose", "provider", "model", "model_capabilities")
SELECT "user_id", 'text', "provider", "model", COALESCE("model_capabilities", '{"inputModalities":["text"],"outputModalities":["text"],"toolCalling":null,"structuredOutput":null,"maxInputTokens":null,"source":"unknown"}'::jsonb)
FROM "ai_credential" WHERE "is_default" = true AND "model" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX "ai_model_assignment_provider_idx" ON "ai_model_assignment" USING btree ("user_id", "provider");
--> statement-breakpoint
DROP INDEX "ai_credential_default_user_idx";
--> statement-breakpoint
ALTER TABLE "ai_credential" DROP COLUMN "is_default";
--> statement-breakpoint
ALTER TABLE "ai_credential" DROP COLUMN "model";
--> statement-breakpoint
ALTER TABLE "ai_credential" DROP COLUMN "model_capabilities";
