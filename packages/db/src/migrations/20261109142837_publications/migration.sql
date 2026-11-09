CREATE TABLE "publication" (
	"id" text PRIMARY KEY,
	"catalog_id" text NOT NULL,
	"owner_id" text NOT NULL,
	"slug" text NOT NULL,
	"visibility" text DEFAULT 'unlisted' NOT NULL,
	"password_hash" text,
	"version" integer DEFAULT 1 NOT NULL,
	"source_revision" integer NOT NULL,
	"document" jsonb NOT NULL,
	"seo_title" text,
	"seo_description" text,
	"og_image_key" text,
	"views" integer DEFAULT 0 NOT NULL,
	"published_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "publication_asset" (
	"id" text PRIMARY KEY,
	"publication_id" text NOT NULL,
	"asset_id" text NOT NULL,
	"mime_type" text NOT NULL,
	"storage_key" text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "publication_slug_idx" ON "publication" ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "publication_catalog_idx" ON "publication" ("catalog_id");--> statement-breakpoint
CREATE INDEX "publication_owner_idx" ON "publication" ("owner_id");--> statement-breakpoint
CREATE UNIQUE INDEX "publication_asset_pub_asset_idx" ON "publication_asset" ("publication_id","asset_id");--> statement-breakpoint
ALTER TABLE "publication" ADD CONSTRAINT "publication_catalog_id_catalog_id_fkey" FOREIGN KEY ("catalog_id") REFERENCES "catalog"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "publication" ADD CONSTRAINT "publication_owner_id_user_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "publication_asset" ADD CONSTRAINT "publication_asset_publication_id_publication_id_fkey" FOREIGN KEY ("publication_id") REFERENCES "publication"("id") ON DELETE CASCADE;