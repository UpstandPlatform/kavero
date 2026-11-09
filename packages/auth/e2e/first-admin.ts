/**
 * The first account on a new server becomes its admin; later ones are users.
 * Runs against a temporary database in the Kavero-postgres container (created
 * and dropped by this script), so the dev database is never touched.
 *
 * Run: `bun e2e/first-admin.ts`
 */
import { createAuth } from "../src/index";
import { createDb } from "@Kavero/db";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { join } from "node:path";

const results: [string, boolean, string?][] = [];
const check = (name: string, ok: boolean, info?: string) => results.push([name, !!ok, info]);

const NAME = `kavero_first_admin_${Date.now()}`;
const ADMIN_URL = process.env.KAVERO_TEST_PG ?? "postgresql://postgres:password@localhost:5436/Kavero";
const url = ADMIN_URL.replace(/\/[^/]+$/, `/${NAME}`);

async function psql(query: string) {
  const p = Bun.spawn(["docker", "exec", "Kavero-postgres", "psql", "-U", "postgres", "-d", "postgres", "-c", query], { stdout: "pipe", stderr: "pipe" });
  if ((await p.exited) !== 0) throw new Error(await new Response(p.stderr).text());
}

await psql(`create database "${NAME}"`);
try {
  const db = createDb({ DATABASE_URL: url } as never);
  await migrate(db, { migrationsFolder: join(import.meta.dir, "../../db/src/migrations") });
  const auth = createAuth({ BETTER_AUTH_URL: "http://localhost:3999", BETTER_AUTH_SECRET: crypto.randomUUID() + crypto.randomUUID() }, db);
  const signUp = (email: string, extra: Record<string, unknown> = {}) =>
    auth.api.signUpEmail({ body: { email, password: crypto.randomUUID(), name: email.split("@")[0]!, ...extra } as never });

  const first = await signUp("first@example.test");
  const sneaky = await signUp("sneaky@example.test", { role: "admin" }).then(() => "created", (e: Error) => e.message);
  const second = await signUp("second@example.test");
  const role = async (email: string) => (await db.query.user.findFirst({ where: { email } }))?.role;
  check("first account is admin", (await role("first@example.test")) === "admin");
  check("second account is a user", (await role("second@example.test")) === "user");
  check("clients can't choose a role", sneaky !== "created" && (await role("sneaky@example.test")) === undefined, sneaky);
  check("both signed up", !!first.user && !!second.user);
  await (db.$client as { end: () => Promise<void> }).end();
} catch (e) {
  check("ran without errors", false, (e as Error).message);
} finally {
  await psql(`drop database if exists "${NAME}" with (force)`);
}

for (const [name, ok, info] of results) console.log(ok ? "PASS" : "FAIL", name, ok ? "" : (info ?? ""));
console.log(`${results.filter((x) => x[1]).length}/${results.length} passed`);
process.exit(results.every((x) => x[1]) ? 0 : 1);
