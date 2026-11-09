/**
 * Builds the standalone player used by "Export → Website (single HTML file)".
 * Output: public/kavero-player.js (generated; not committed).
 * Run: bun scripts/build-player.ts
 */
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const result = await Bun.build({
  entrypoints: [join(root, "src/player/standalone.tsx")],
  outdir: join(root, "public"),
  naming: "kavero-player.js",
  target: "browser",
  format: "iife",
  minify: true,
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
});
if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}
const size = result.outputs[0]?.size ?? 0;
console.log(`kavero-player.js built (${Math.round(size / 1024)} KB)`);
