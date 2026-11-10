import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = import.meta.dir ? join(import.meta.dir, "..") : process.cwd();
const envPath = join(root, "apps", "web", ".env");
const envExamplePath = join(root, "apps", "web", ".env.example");
const minimumBunVersion = [1, 4, 2];

function fail(message: string): never {
  console.error(`\nSetup failed: ${message}`);
  process.exit(1);
}

function run(command: string, args: string[], cwd = root): void {
  console.log(`\n> ${command} ${args.join(" ")}`);
  const result = spawnSync(command, args, { cwd, stdio: "inherit", shell: process.platform === "win32" });
  if (result.error) fail(`Could not run ${command}: ${result.error.message}`);
  if (result.status !== 0) fail(`${command} exited with code ${result.status ?? "unknown"}.`);
}

function versionAtLeast(actual: string, minimum: number[]): boolean {
  const parts = actual.split(".").map((part) => Number.parseInt(part, 10));
  if (parts.length < 3 || parts.some((part) => !Number.isFinite(part))) return false;
  for (let index = 0; index < minimum.length; index++) {
    if (parts[index] > minimum[index]) return true;
    if (parts[index] < minimum[index]) return false;
  }
  return true;
}

function ensureEnvFile(): void {
  if (!existsSync(envPath)) {
    if (!existsSync(envExamplePath)) fail(`Missing environment template: ${envExamplePath}`);
    writeFileSync(envPath, readFileSync(envExamplePath, "utf8"), { flag: "wx" });
    console.log("Created apps/web/.env from apps/web/.env.example.");
  } else {
    console.log("Keeping existing apps/web/.env.");
  }

  const env = readFileSync(envPath, "utf8");
  const match = env.match(/^BETTER_AUTH_SECRET[ \t]*=[ \t]*([^\r\n]*)$/m);
  if (!match) fail("apps/web/.env must define BETTER_AUTH_SECRET.");

  const currentSecret = match[1].trim().replace(/^(["'])(.*)\1$/, "$2");
  if (currentSecret.length === 0) {
    const secret = randomBytes(48).toString("base64url");
    writeFileSync(envPath, env.replace(/^BETTER_AUTH_SECRET[ \t]*=.*$/m, `BETTER_AUTH_SECRET=${secret}`));
    console.log("Generated BETTER_AUTH_SECRET in apps/web/.env.");
  } else if (currentSecret.length < 32) {
    fail("BETTER_AUTH_SECRET in apps/web/.env must be at least 32 characters.");
  }
}

console.log("Preparing Kavero for local web development...");

if (!versionAtLeast(Bun.version, minimumBunVersion)) {
  fail(`Bun 1.4.2 or later is required; found ${Bun.version}.`);
}

ensureEnvFile();

const docker = spawnSync("docker", ["info"], { cwd: root, stdio: "ignore", shell: process.platform === "win32" });
if (docker.error || docker.status !== 0) {
  fail("Docker is required for the local Postgres database. Install/start Docker Desktop (or Docker Engine with Compose) and run setup again.");
}

run("bun", ["install", "--frozen-lockfile"]);
run("docker", ["compose", "up", "-d", "postgres"]);

console.log("\nWaiting for Postgres to become ready...");
const deadline = Date.now() + 120_000;
let databaseReady = false;
while (Date.now() < deadline) {
  const ready = spawnSync("docker", ["compose", "exec", "-T", "postgres", "pg_isready", "-U", "postgres"], {
    cwd: root,
    stdio: "ignore",
    shell: process.platform === "win32",
  });
  if (ready.status === 0) {
    databaseReady = true;
    break;
  }
  Bun.sleepSync(2_000);
}
if (!databaseReady) fail("Postgres did not become ready within 120 seconds. Check `docker compose logs postgres`.");

run("bunx", ["drizzle-kit", "migrate"], join(root, "packages", "db"));

console.log("\nKavero is ready for development.");
console.log("Start the web app and API server with: bun dev");
console.log("Open: http://localhost:3001");
