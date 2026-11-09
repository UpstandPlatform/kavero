/**
 * Make an existing account an admin (or remove admin with --remove).
 * For recovering a server whose admin left. Uses DATABASE_URL like the app.
 * Run from the repo root: bun run make-admin you@example.com
 */
import "varlock/auto-load";

import { eq, sql } from "drizzle-orm";

import { createDb } from "../src/index";
import { user } from "../src/schema/auth";

const args = process.argv.slice(2);
const remove = args.includes("--remove");
const email = args.find((a) => !a.startsWith("--"));
if (!email) {
  console.error("Usage: bun run make-admin <email> [--remove]");
  process.exit(1);
}
const db = createDb({ DATABASE_URL: process.env.DATABASE_URL ?? "" } as never);
const rows = await db
  .update(user)
  .set({ role: remove ? "user" : "admin", ...(remove ? {} : { banned: false, banReason: null, banExpires: null }) })
  .where(eq(sql`lower(${user.email})`, email.toLowerCase()))
  .returning({ email: user.email, role: user.role });
if (!rows.length) {
  console.error(`No account with the email ${email}.`);
  process.exit(1);
}
console.log(`${rows[0]!.email} is now ${rows[0]!.role === "admin" ? "an admin" : "a regular user"}.`);
process.exit(0);
