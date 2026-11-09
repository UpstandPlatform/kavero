CREATE TABLE "publication_view_daily" (
	"publication_id" text,
	"day" date,
	"views" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "publication_view_daily_pkey" PRIMARY KEY("publication_id","day")
);
--> statement-breakpoint
ALTER TABLE "publication_view_daily" ADD CONSTRAINT "publication_view_daily_publication_id_publication_id_fkey" FOREIGN KEY ("publication_id") REFERENCES "publication"("id") ON DELETE CASCADE;