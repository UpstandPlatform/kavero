// Bundles the main process (dist/main.js) with its runtime dependencies (electron-updater),
// because the packaged app ships no node_modules. The preload stays tsc's output: it only uses electron.
// Run with bun: `bun scripts/bundle-main.mjs` (after `tsc`).
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const desktopDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const result = await Bun.build({
  entrypoints: [join(desktopDir, "src", "main.ts")],
  outdir: join(desktopDir, "dist"),
  naming: "main.js",
  target: "node",
  format: "cjs",
  external: ["electron"],
  sourcemap: "linked",
});
if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}
console.log(`bundle-main: dist/main.js (${Math.round(result.outputs[0].size / 1024)} KB)`);
