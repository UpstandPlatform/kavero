import { varlockNextConfigPlugin } from "@varlock/nextjs-integration/plugin";

const withVarlock = varlockNextConfigPlugin();
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typedRoutes: true,
  reactCompiler: true,
  output: "standalone",
  transpilePackages: ["@Kavero/catalog-engine", "@Kavero/local-storage", "@Kavero/editor-core", "@Kavero/renderer", "@Kavero/animation-engine", "@Kavero/export-chromium", "@Kavero/export-pptx", "@Kavero/mcp-server", "@Kavero/ai"],
  // Native/binary packages used by video export must stay outside the bundle.
  // PGlite (the desktop app's embedded database) loads its WebAssembly and data files at runtime.
  serverExternalPackages: ["playwright-core", "@ffmpeg-installer/ffmpeg", "@electric-sql/pglite"],
  // Keep build-only / dev-only packages out of the standalone output (which the desktop
  // app ships as resources/web). Globs are resolved from apps/web; "../../node_modules"
  // is the monorepo root, where bun keeps its store (node_modules/.bun/<pkg@ver>/...).
  outputFileTracingExcludes: {
    "*": [
      // playwright-core (external, so traced as a whole package) has an Electron
      // automation loader, lib/server/electron/loader.js, that does require("electron");
      // bun hoists apps/desktop's electron into node_modules/.bun/node_modules, so the
      // tracer resolved it and pulled the entire Electron runtime (~370 MB) into every
      // server route. The server never launches Electron (only Chromium via playwright).
      ...nodeModule("electron"),
      // Desktop packaging and build/type-check tooling: never needed at runtime.
      ...nodeModule("electron-builder"),
      ...nodeModule("app-builder-bin"),
      ...nodeModule("app-builder-lib"),
      ...nodeModule("typescript"),
      ...nodeModule("drizzle-kit"),
      ...nodeModule("@types/*"),
      // Local development storage (uploaded assets of the developer's own catalogs).
      "./.storage/**",
    ],
  },
};

/** Trace-exclude globs for a package (its directory and files), wherever bun/npm placed it. */
function nodeModule(name: string): string[] {
  const storeName = name.replace("/", "+"); // bun store entry: @scope+pkg@version
  return [
    `../../node_modules/.bun/${storeName}@*/node_modules/${name}`,
    `../../node_modules/**/node_modules/${name}`,
    `../../node_modules/${name}`,
    `./node_modules/${name}`,
  ].flatMap((dir) => [dir, `${dir}/**`]);
}

export default withVarlock(nextConfig);
