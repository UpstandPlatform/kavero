/**
 * Works out the next release version from the commits since the last tag and
 * writes the changelog. Used by .github/workflows/release.yml; safe to run locally.
 *
 *   bun scripts/release.ts                 # preview: next version and notes, changes nothing
 *   bun scripts/release.ts --write         # update CHANGELOG.md and package versions
 *   bun scripts/release.ts --bump minor    # force patch | minor | major (default: auto)
 *   bun scripts/release.ts --pre beta      # prerelease: 1.4.0-beta.1, 1.4.0-beta.2, …
 *
 * Version rules (Conventional Commits, see CONTRIBUTING.md):
 *   feat → minor · fix, perf → patch · "!" or BREAKING CHANGE → major (minor while 0.x)
 *   Older style subjects count too: "Add …" → minor, "Fix …" → patch.
 *   docs, chore, ci, test, style, build, refactor alone don't trigger an automatic release.
 * The first release (no tags yet) uses the version in apps/desktop/package.json.
 */
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

type Bump = "major" | "minor" | "patch";
type Kind = "breaking" | "feat" | "fix" | "perf" | "other";
interface Commit { sha: string; subject: string; body: string; kind: Kind; type?: string; scope?: string; text: string }

const ROOT = join(import.meta.dir, "..");
const VERSION_FILES = ["apps/desktop/package.json", "apps/web/package.json"];
const CHANGELOG = join(ROOT, "CHANGELOG.md");
const REPO = process.env.GITHUB_REPOSITORY || "UpstandPlatform/kavero";
const CHANGELOG_HEADER = `# Changelog

All notable changes to Kavero are listed here. Versions follow [Semantic Versioning](https://semver.org/).
This file is updated automatically by the release workflow from [Conventional Commits](https://www.conventionalcommits.org/) — see [CONTRIBUTING.md](CONTRIBUTING.md).
`;

// ---------- CLI ----------

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? (args[i + 1] && !args[i + 1]!.startsWith("--") ? args[i + 1] : "true") : undefined;
};
const write = flag("write") === "true";
const forced = flag("bump");
const pre = flag("pre")?.replace(/[^0-9A-Za-z-]/g, "") || undefined;
if (forced && !["auto", "patch", "minor", "major"].includes(forced)) fail(`--bump must be auto, patch, minor or major (got "${forced}")`);

function fail(msg: string): never {
  console.error(`release: ${msg}`);
  process.exit(1);
}

function git(...cmd: string[]) {
  const r = Bun.spawnSync(["git", ...cmd], { cwd: ROOT, stdout: "pipe", stderr: "pipe" });
  if (r.exitCode !== 0) fail(`git ${cmd.join(" ")}: ${r.stderr.toString().trim()}`);
  return r.stdout.toString().trim();
}

// ---------- Versions ----------

interface SemVer { major: number; minor: number; patch: number; pre?: string; preNum?: number }
const parse = (v: string): SemVer | null => {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-]+)\.(\d+))?$/.exec(v.trim());
  return m ? { major: +m[1]!, minor: +m[2]!, patch: +m[3]!, pre: m[4], preNum: m[5] ? +m[5] : undefined } : null;
};
const str = (v: SemVer) => `${v.major}.${v.minor}.${v.patch}${v.pre ? `-${v.pre}.${v.preNum}` : ""}`;
const cmp = (a: SemVer, b: SemVer) =>
  a.major - b.major || a.minor - b.minor || a.patch - b.patch || (a.pre ? (b.pre ? (a.preNum ?? 0) - (b.preNum ?? 0) : -1) : b.pre ? 1 : 0);

const tags = git("tag", "--list", "v*").split("\n").map((t) => ({ tag: t, v: parse(t) })).filter((t): t is { tag: string; v: SemVer } => !!t.v).sort((a, b) => cmp(a.v, b.v));
const lastTag = tags.at(-1);
const lastStable = [...tags].reverse().find((t) => !t.v.pre);
const pkgVersion = parse(JSON.parse(readFileSync(join(ROOT, VERSION_FILES[0]!), "utf8")).version ?? "0.1.0") ?? { major: 0, minor: 1, patch: 0 };

// ---------- Commits ----------

const SEP = "\u001f";
const END = "\u001e";
const raw = git("log", "--no-merges", `--format=%H${SEP}%s${SEP}%b${END}`, ...(lastTag ? [`${lastTag.tag}..HEAD`] : []));
const commits: Commit[] = raw
  .split(END)
  .map((r) => r.trim())
  .filter(Boolean)
  .map((r) => {
    const [sha = "", subject = "", body = ""] = r.split(SEP);
    return classify(sha, subject.trim(), body);
  })
  // Release bookkeeping commits never appear in notes.
  .filter((c) => !/^chore\(release\)/i.test(c.subject));

function classify(sha: string, subject: string, body: string): Commit {
  const m = /^(\w+)(?:\(([^)]+)\))?(!)?:\s*(.+)$/.exec(subject);
  const breaking = /^BREAKING[ -]CHANGE:/m.test(body) || !!m?.[3];
  if (m) {
    const type = m[1]!.toLowerCase();
    const kind: Kind = breaking ? "breaking" : type === "feat" ? "feat" : type === "fix" ? "fix" : type === "perf" ? "perf" : "other";
    return { sha, subject, body, kind, type, scope: m[2], text: m[4]! };
  }
  // Commits written before Conventional Commits: "Add …" is a feature, "Fix …" a fix.
  const kind: Kind = breaking ? "breaking" : /^(add|introduce|support|implement)\b/i.test(subject) ? "feat" : /^(fix|correct|repair|resolve)\b/i.test(subject) ? "fix" : "other";
  return { sha, subject, body, kind, text: subject };
}

const releasable = commits.filter((c) => c.kind !== "other");
const auto: Bump | null = commits.some((c) => c.kind === "breaking") ? "major" : commits.some((c) => c.kind === "feat") ? "minor" : releasable.length ? "patch" : null;
const bump: Bump | null = forced && forced !== "auto" ? (forced as Bump) : auto;

// ---------- Next version ----------

let next: SemVer | null = null;
if (!lastTag) {
  // First release: ship the version already in package.json.
  next = { ...pkgVersion, pre: undefined, preNum: undefined };
} else if (bump && commits.length) {
  const base = lastStable?.v ?? { major: 0, minor: 0, patch: 0 };
  const effective: Bump = bump === "major" && base.major === 0 && forced !== "major" ? "minor" : bump; // 0.x: breaking → minor
  next =
    effective === "major" ? { major: base.major + 1, minor: 0, patch: 0 }
    : effective === "minor" ? { major: base.major, minor: base.minor + 1, patch: 0 }
    : { major: base.major, minor: base.minor, patch: base.patch + 1 };
}
if (next && pre) {
  const same = tags.filter((t) => t.v.pre === pre && t.v.major === next!.major && t.v.minor === next!.minor && t.v.patch === next!.patch);
  next = { ...next, pre, preNum: Math.max(0, ...same.map((t) => t.v.preNum ?? 0)) + 1 };
}
if (next && tags.some((t) => cmp(t.v, next!) === 0)) fail(`v${str(next)} is already tagged`);

// ---------- Notes ----------

const SECTIONS: [Kind, string][] = [["breaking", "Breaking changes"], ["feat", "Features"], ["fix", "Fixes"], ["perf", "Performance"], ["other", "Other changes"]];
const line = (c: Commit) => {
  const text = c.text.charAt(0).toUpperCase() + c.text.slice(1);
  // Other changes show their type ("docs", "ci"…) when there's no scope.
  const label = c.scope ?? (c.kind === "other" ? c.type : undefined);
  return `- ${label ? `**${label}:** ` : ""}${text} ([${c.sha.slice(0, 7)}](https://github.com/${REPO}/commit/${c.sha}))`;
};
function notes(version: string) {
  const date = new Date().toISOString().slice(0, 10);
  const compare = lastTag ? `https://github.com/${REPO}/compare/${lastTag.tag}...v${version}` : `https://github.com/${REPO}/commits/v${version}`;
  const parts = [`## [${version}](${compare}) - ${date}`];
  for (const [kind, title] of SECTIONS) {
    const list = commits.filter((c) => c.kind === kind);
    if (list.length) parts.push(`### ${title}\n\n${list.map(line).join("\n")}`);
  }
  return parts.join("\n\n");
}

// ---------- Output ----------

const version = next ? str(next) : null;
const section = version ? notes(version) : "";
const summary = { release: !!version, version, tag: version ? `v${version}` : null, previous: lastTag?.tag ?? null, bump: lastTag ? bump : "initial", prerelease: !!next?.pre, commits: commits.length, releasable: releasable.length };
console.log(JSON.stringify(summary, null, 2));
if (!version) console.log(commits.length ? "\nNo release: only docs/chore/ci/test changes since the last tag. Use --bump to force one." : "\nNo release: no commits since the last tag.");
else console.log(`\n${section}`);

if (write && version) {
  const existing = existsSync(CHANGELOG) ? readFileSync(CHANGELOG, "utf8") : CHANGELOG_HEADER;
  const start = existing.indexOf("\n## ");
  const sections = start >= 0 ? existing.slice(start + 1) : existing.startsWith("# Changelog") ? "" : existing;
  // Re-running for the same version replaces its section instead of adding a second one.
  const body = sections
    .split(/^(?=## )/m)
    .filter((s) => !s.startsWith(`## [${version}]`))
    .join("");
  writeFileSync(CHANGELOG, `${CHANGELOG_HEADER}\n${section}\n${body ? `\n${body.trimStart()}` : ""}`.replace(/\n{3,}/g, "\n\n"));
  for (const f of VERSION_FILES) {
    const p = join(ROOT, f);
    writeFileSync(p, readFileSync(p, "utf8").replace(/("version"\s*:\s*")[^"]+(")/, `$1${version}$2`));
  }
  // Release notes for the GitHub release (the section without its heading).
  writeFileSync(join(ROOT, "release-notes.md"), section.split("\n").slice(1).join("\n").trim() + "\n");
  console.log(`\nWrote CHANGELOG.md, ${VERSION_FILES.join(", ")} and release-notes.md for v${version}.`);
}

if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, Object.entries({ release: String(!!version), version: version ?? "", tag: summary.tag ?? "", prerelease: String(summary.prerelease) }).map(([k, v]) => `${k}=${v}\n`).join(""));
}
