// Stages the Next standalone build of apps/web into apps/desktop/web-bundle, which
// electron-builder ships as <resources>/web. Run `bun run --filter web build` first.
//
// Why not copy the standalone folder as-is: bun's isolated installs leave a symlinked
// store (node_modules/.bun/<pkg@ver>/node_modules/*) in the standalone output, and
// installers (NSIS in particular) can't carry symlinks. Dereferencing them naively breaks
// module resolution (Node resolves through the link's real path) and duplicates
// singletons like `next`/`react`. So this script rebuilds a plain, npm-style
// node_modules tree from the store: hoisted packages at the root, and a package's
// dependency nested under it only when the hoisted copy is a different version.
//
// It also adds .next/static, public/ and .env.schema (not part of standalone output) and
// drops what must not ship: .env files, local storage, app sources.
import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, realpathSync, rmSync, statSync } from "node:fs";
import { basename, dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const desktopDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const webDir = join(desktopDir, "..", "web");
const standalone = join(webDir, ".next", "standalone");
const out = join(desktopDir, "web-bundle");

const serverJs = join(standalone, "apps", "web", "server.js");
if (!existsSync(serverJs)) {
  console.error(`prepare-web: ${relative(process.cwd(), serverJs)} not found.`);
  console.error("Build the web app first: bun run --filter web build (from the repo root).");
  process.exit(1);
}

// Top-level entries of apps/web that standalone tracing copies but the server never needs
// (.storage would even contain the developer's local assets).
const EXCLUDED_APP_ENTRIES = new Set([".storage", "src", "tsconfig.tsbuildinfo", "Dockerfile", "AGENTS.md"]);

const storeDir = join(standalone, "node_modules", ".bun");
// Packages are copied from the traced standalone store (only the files the server uses).
// serverExternalPackages are loaded unbundled and read data files that tracing misses
// (e.g. playwright-core/browsers.json), so those come in full from the repo's own store
// (same entry names).
const FULL_COPY = /^(playwright-core|@ffmpeg-installer\/.*)$/;
const repoStoreDir = join(desktopDir, "..", "..", "node_modules", ".bun");
const storeReal = existsSync(storeDir) ? realpathSync(storeDir) : null;

/** Lists package dirs (incl. scoped) directly inside a node_modules dir. */
function listPackages(nmDir) {
  if (!existsSync(nmDir)) return [];
  const out = [];
  for (const name of readdirSync(nmDir)) {
    if (name.startsWith(".")) continue;
    const p = join(nmDir, name);
    if (name.startsWith("@") && !lstatSync(p).isSymbolicLink()) {
      for (const sub of readdirSync(p)) out.push({ name: `${name}/${sub}`, path: join(p, sub) });
    } else out.push({ name, path: p });
  }
  return out;
}

/** Maps a real path inside the store to its { entry, name } ("pg@8.1.0", "pg"). */
function storeRef(realPath) {
  if (!storeReal) return null;
  const rel = relative(storeReal, realPath);
  if (rel.startsWith("..")) return null;
  const parts = rel.split(sep);
  if (parts.length < 3 || parts[1] !== "node_modules" || parts[0] === "node_modules") return null;
  return { entry: parts[0], name: parts.slice(2).join("/") };
}

const keyOf = (ref) => `${ref.entry}|${ref.name}`;

/** Direct dependencies of a store package = the other packages in its entry's node_modules. */
const depsCache = new Map();
function depsOf(ref) {
  const key = keyOf(ref);
  if (depsCache.has(key)) return depsCache.get(key);
  const deps = [];
  for (const pkg of listPackages(join(storeReal, ref.entry, "node_modules"))) {
    if (pkg.name === ref.name) continue;
    let target;
    try {
      target = storeRef(realpathSync(pkg.path));
    } catch {
      continue; // dangling link: dependency not traced into the standalone output
    }
    if (target) deps.push({ name: pkg.name, ref: target });
  }
  depsCache.set(key, deps);
  return deps;
}

/** nodeModulesDir -> Map(name -> storeKey) of packages placed in the bundle. */
const placed = new Map();
const queue = [];
const tracedOnly = [];
let packageCount = 0;

function placeAt(ref, nmDir, asName = ref.name) {
  const dest = join(nmDir, ...asName.split("/"));
  let names = placed.get(nmDir);
  if (!names) placed.set(nmDir, (names = new Map()));
  if (names.has(asName)) return;
  names.set(asName, keyOf(ref));
  const rel = join(ref.entry, "node_modules", ...ref.name.split("/"));
  const full = join(repoStoreDir, rel);
  let src = join(storeReal, rel);
  if (FULL_COPY.test(ref.name)) {
    if (existsSync(join(full, "package.json"))) src = full;
    else tracedOnly.push(ref.name);
  }
  // dereference: a package dir itself has no links, except an occasional bin shim
  cpSync(src, dest, { recursive: true, dereference: true, filter: (p) => basename(p) !== "node_modules" || p === src });
  packageCount++;
  queue.push({ dest, ref, aliased: asName !== ref.name });
}

/** What `require(name)` from inside pkgDir would find, per Node's node_modules lookup. */
function lookup(pkgDir, name) {
  for (let dir = pkgDir; dir.startsWith(out); dir = dirname(dir)) {
    if (basename(dir) === "node_modules") continue;
    const hit = placed.get(join(dir, "node_modules"))?.get(name);
    if (hit) return hit;
    if (dir === out) break;
  }
  return undefined;
}

function resolveQueue() {
  const rootNm = join(out, "node_modules");
  while (queue.length) {
    const { dest, ref, aliased } = queue.shift();
    for (const dep of depsOf(ref)) {
      // Packages Next aliases as .next/node_modules/<name>-<hash> sometimes locate files of
      // their deps by path, not require() (@ffmpeg-installer/ffmpeg looks for its platform
      // binary package next to itself or in its own node_modules), so nest those.
      if (aliased && FULL_COPY.test(dep.name)) {
        placeAt(dep.ref, join(dest, "node_modules"), dep.name);
        continue;
      }
      const found = lookup(dest, dep.name);
      if (found === keyOf(dep.ref)) continue;
      // hoist to the root when free, otherwise nest under the dependent
      if (!found && !placed.get(rootNm)?.has(dep.name)) placeAt(dep.ref, rootNm, dep.name);
      else placeAt(dep.ref, join(dest, "node_modules"), dep.name);
    }
  }
}

const started = Date.now();
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

// 1. Copy everything except the store; remember symlinks to re-create as real packages.
const links = [];
cpSync(standalone, out, {
  recursive: true,
  filter: (src) => {
    const rel = relative(standalone, src);
    if (!rel) return true;
    const name = basename(src);
    if (name.startsWith(".env")) return false; // never ship build-time secrets
    if (dirname(rel) === join("apps", "web") && EXCLUDED_APP_ENTRIES.has(name)) return false;
    if (rel === join("node_modules", ".bun")) return false;
    if (lstatSync(src).isSymbolicLink()) {
      links.push(rel);
      return false;
    }
    return true;
  },
});

// 2. Hoisted packages (bun keeps them in .bun/node_modules) go to the root node_modules.
for (const pkg of listPackages(join(storeDir, "node_modules"))) {
  try {
    const ref = storeRef(realpathSync(pkg.path));
    if (ref) placeAt(ref, join(out, "node_modules"), pkg.name);
  } catch {
    // dangling
  }
}
resolveQueue();

// 3. Links outside the store (apps/web/node_modules/next, .next/node_modules/<pkg>-<hash>).
for (const rel of links) {
  const src = join(standalone, rel);
  let real;
  try {
    real = realpathSync(src);
  } catch {
    console.warn(`prepare-web: skipping dangling link ${rel}`);
    continue;
  }
  const ref = storeRef(real);
  const destDir = dirname(join(out, rel));
  if (ref) {
    // Same package already reachable from here (e.g. hoisted `next`): no copy needed.
    if (lookup(destDir, basename(rel)) === keyOf(ref) && basename(rel) === ref.name.split("/").pop()) continue;
    placeAt(ref, destDir, basename(rel));
  } else {
    cpSync(real, join(out, rel), { recursive: true, dereference: true });
  }
}
resolveQueue();

// 4. Assets the standalone output leaves out.
const outWeb = join(out, "apps", "web");
cpSync(join(webDir, ".next", "static"), join(outWeb, ".next", "static"), { recursive: true });
if (existsSync(join(webDir, "public"))) cpSync(join(webDir, "public"), join(outWeb, "public"), { recursive: true });
else mkdirSync(join(outWeb, "public"), { recursive: true });
cpSync(join(webDir, ".env.schema"), join(outWeb, ".env.schema"));

if (tracedOnly.length) console.warn(`prepare-web: not in the repo store, shipping the traced (possibly incomplete) copy of: ${tracedOnly.join(", ")}`);
const age = Math.round((Date.now() - statSync(serverJs).mtimeMs) / 60000);
console.log(
  `prepare-web: staged ${relative(process.cwd(), out) || out} (${packageCount} packages) in ` +
    `${((Date.now() - started) / 1000).toFixed(1)}s; web build is ${age} min old`,
);
