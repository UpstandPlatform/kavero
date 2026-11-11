DROP TABLE "api_token";--> statement-breakpoint
ALTER TABLE "ai_credential" ADD COLUMN "is_default" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_credential" ADD COLUMN "model_capabilities" jsonb;--> statement-breakpoint
UPDATE "ai_credential" SET "is_default" = true;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "api_key_id" text;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "area" text DEFAULT 'account' NOT NULL;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "channel" text DEFAULT 'web' NOT NULL;--> statement-breakpoint
ALTER TABLE "audit_log" DROP COLUMN "token_id";--> statement-breakpoint
UPDATE "audit_log" SET "area" = CASE
	WHEN "action" LIKE 'catalog:%' THEN 'catalogs'
	WHEN "action" LIKE 'api-key:%' THEN 'api_keys'
	WHEN "action" LIKE 'admin:%' THEN 'admin'
	WHEN "action" LIKE 'workspace:%' THEN 'workspace'
	WHEN "action" LIKE 'publication:%' THEN 'publication'
	WHEN "action" LIKE 'ai:%' THEN 'ai'
	WHEN "action" LIKE 'mcp-client:%' THEN 'integrations'
	WHEN "action" LIKE 'auth:%' THEN 'auth'
	WHEN "action" LIKE 'mcp:font_%' OR "action" = 'mcp:asset_import' THEN 'assets'
	WHEN "action" LIKE 'mcp:catalog_export_%' OR "action" = 'mcp:catalog_preview' THEN 'exports'
	WHEN "action" LIKE 'mcp:catalog_publish%' OR "action" LIKE 'mcp:catalog_unpublish%' THEN 'publication'
	WHEN "action" = 'mcp:catalog_generate' THEN 'ai'
	WHEN "action" LIKE 'mcp:%' THEN 'catalogs'
	ELSE 'account'
END,
"channel" = CASE
	WHEN "action" LIKE 'mcp:%' THEN 'mcp'
	WHEN "action" LIKE 'admin:%' THEN 'admin'
	ELSE 'web'
END;--> statement-breakpoint
ALTER TABLE "ai_credential" DROP CONSTRAINT "ai_credential_pkey";--> statement-breakpoint
ALTER TABLE "ai_credential" ADD PRIMARY KEY ("user_id","provider");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_credential_default_user_idx" ON "ai_credential" ("user_id") WHERE "is_default";--> statement-breakpoint
CREATE INDEX "audit_log_area_created_idx" ON "audit_log" ("area","created_at");--> statement-breakpoint
CREATE INDEX "audit_log_action_created_idx" ON "audit_log" ("action","created_at");
