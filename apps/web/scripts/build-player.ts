/**
 * Builds the standalone players:
 *  - public/kavero-player.js   → "Export → Website (single HTML file)"
 *  - public/kavero-flipbook.js → "Export → Flipbook (.zip)"
 * Output is generated; not committed. Run: bun scripts/build-player.ts
 */
import { join } from "node:path";

const root = join(import.meta.dir, "..");

const builds = [
  { entry: "src/player/standalone.tsx", name: "kavero-player.js" },
  { entry: "src/player/flipbook.tsx", name: "kavero-flipbook.js" },
];

for (const { entry, name } of builds) {
  const result = await Bun.build({
    entrypoints: [join(root, entry)],
    outdir: join(root, "public"),
    naming: name,
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
  console.log(`${name} built (${Math.round(size / 1024)} KB)`);
}
