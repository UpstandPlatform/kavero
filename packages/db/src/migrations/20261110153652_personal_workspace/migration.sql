ALTER TABLE "workspace" ADD COLUMN "personal_owner_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_personal_owner_idx" ON "workspace" ("personal_owner_id");--> statement-breakpoint
ALTER TABLE "workspace" ADD CONSTRAINT "workspace_personal_owner_id_user_id_fkey" FOREIGN KEY ("personal_owner_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
INSERT INTO "workspace" ("id", "name", "created_by", "personal_owner_id")
SELECT gen_random_uuid()::text, 'Personal workspace', "user"."id", "user"."id" FROM "user";--> statement-breakpoint
INSERT INTO "workspace_member" ("id", "workspace_id", "user_id", "role")
SELECT gen_random_uuid()::text, "workspace"."id", "workspace"."personal_owner_id", 'owner'
FROM "workspace" WHERE "workspace"."personal_owner_id" IS NOT NULL;--> statement-breakpoint
UPDATE "catalog" AS "catalog"
SET "workspace_id" = "workspace"."id"
FROM "workspace"
WHERE "workspace"."personal_owner_id" = "catalog"."owner_id" AND "catalog"."workspace_id" IS NULL;
