/**
 * Runs once when the server starts, before it handles requests.
 * The desktop app sets KAVERO_AUTO_MIGRATE so its database (embedded PGlite or a
 * configured Postgres) is always on the current schema. Web deployments run
 * migrations separately (see docs/deployment.md) and leave it unset.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.KAVERO_AUTO_MIGRATE !== "1") return;
  const folder = process.env.KAVERO_MIGRATIONS_DIR;
  if (!folder) throw new Error("KAVERO_AUTO_MIGRATE needs KAVERO_MIGRATIONS_DIR");
  const { runMigrations } = await import("@Kavero/db");
  const { db } = await import("./services");
  const started = Date.now();
  await runMigrations(db, process.env.DATABASE_URL ?? "", folder);
  console.log(`[kavero] database ready (${Date.now() - started} ms)`);
}
