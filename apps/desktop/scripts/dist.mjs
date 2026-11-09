// Runs electron-builder with electron-builder.yml plus settings that depend on the
// environment, so local builds and CI use the same entry point:
//
//   node scripts/dist.mjs            installers for the current OS
//   node scripts/dist.mjs --dir      unpacked app only (fast check)
//   node scripts/dist.mjs --win|--mac|--linux
//
// - Publishing metadata (latest*.yml / app-update.yml for a future auto-updater) is
//   generated only when GITHUB_REPOSITORY (owner/name) is set, as on GitHub Actions.
//   Nothing is ever uploaded from here: releases are created by the workflow.
// - Signing is optional. Without a certificate (CSC_LINK / WIN_CSC_LINK) builds are
//   unsigned; macOS notarizes only when APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD and
//   APPLE_TEAM_ID are all set.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import builder from "electron-builder";

const { build, Platform } = builder;
const desktopDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = new Set(process.argv.slice(2));

const env = process.env;
for (const key of ["CSC_LINK", "CSC_KEY_PASSWORD", "WIN_CSC_LINK", "WIN_CSC_KEY_PASSWORD", "APPLE_ID", "APPLE_APP_SPECIFIC_PASSWORD", "APPLE_TEAM_ID"]) {
  if (env[key] === "") delete env[key]; // unset GitHub secrets arrive as empty strings
}

const platform = args.has("--win") ? "win32" : args.has("--mac") ? "darwin" : args.has("--linux") ? "linux" : process.platform;
const target = { win32: Platform.WINDOWS, darwin: Platform.MAC, linux: Platform.LINUX }[platform];
if (!target) throw new Error(`Unsupported platform: ${platform}`);

/** @type {import("electron-builder").Configuration} */
const config = { extends: join(desktopDir, "electron-builder.yml") };

const [owner, repo] = (env.GITHUB_REPOSITORY ?? "").split("/");
config.publish = owner && repo ? [{ provider: "github", owner, repo, releaseType: "draft" }] : null;

const hasCert = platform === "win32" ? !!(env.WIN_CSC_LINK || env.CSC_LINK) : !!env.CSC_LINK;
if (!hasCert && platform !== "linux") {
  env.CSC_IDENTITY_AUTO_DISCOVERY = "false";
  if (platform === "darwin") config.mac = { identity: null };
  console.log(`dist: no ${platform === "darwin" ? "macOS" : "Windows"} signing certificate configured; building unsigned.`);
}
if (platform === "darwin" && hasCert && env.APPLE_ID && env.APPLE_APP_SPECIFIC_PASSWORD && env.APPLE_TEAM_ID) {
  config.mac = { ...config.mac, notarize: true };
}

await build({
  projectDir: desktopDir,
  targets: target.createTarget(args.has("--dir") ? ["dir"] : undefined),
  config,
  publish: "never",
});
