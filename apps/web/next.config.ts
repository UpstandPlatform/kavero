import { varlockNextConfigPlugin } from "@varlock/nextjs-integration/plugin";

const withVarlock = varlockNextConfigPlugin();
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typedRoutes: true,
  reactCompiler: true,
  output: "standalone",
  transpilePackages: ["@Kavero/catalog-engine", "@Kavero/local-storage", "@Kavero/editor-core", "@Kavero/renderer", "@Kavero/animation-engine", "@Kavero/export-chromium", "@Kavero/export-pptx", "@Kavero/mcp-server"],
  // Native/binary packages used by video export must stay outside the bundle.
  serverExternalPackages: ["playwright-core", "@ffmpeg-installer/ffmpeg"],
};

export default withVarlock(nextConfig);
