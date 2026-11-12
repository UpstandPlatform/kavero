const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

export function isSemver(version: string) {
  return typeof version === "string" && SEMVER.test(version);
}

function parseSemver(version: string) {
  // Only the first "-" separates the core from the prerelease; later dashes belong to the prerelease.
  const dash = version.indexOf("-");
  const core = dash < 0 ? version : version.slice(0, dash);
  const prerelease = dash < 0 ? undefined : version.slice(dash + 1);
  return { numbers: core.split(".").map((part) => Number.parseInt(part, 10)), prerelease: prerelease?.split(".") };
}

/** Semantic-version precedence: -1, 0 or 1. */
export function compareSemver(a: string, b: string) {
  const left = parseSemver(a);
  const right = parseSemver(b);
  for (let i = 0; i < 3; i += 1) {
    const delta = (left.numbers[i] ?? 0) - (right.numbers[i] ?? 0);
    if (delta) return Math.sign(delta);
  }
  if (left.prerelease === undefined && right.prerelease === undefined) return 0;
  if (left.prerelease === undefined) return 1;
  if (right.prerelease === undefined) return -1;
  for (let i = 0; i < Math.max(left.prerelease.length, right.prerelease.length); i += 1) {
    const aPart = left.prerelease[i];
    const bPart = right.prerelease[i];
    if (aPart === undefined) return -1;
    if (bPart === undefined) return 1;
    if (aPart === bPart) continue;
    const aNumeric = /^\d+$/.test(aPart);
    const bNumeric = /^\d+$/.test(bPart);
    if (aNumeric && bNumeric) return Number(aPart) < Number(bPart) ? -1 : 1;
    if (aNumeric !== bNumeric) return aNumeric ? -1 : 1;
    return aPart < bPart ? -1 : 1;
  }
  return 0;
}

/**
 * Whether extension code at `codeVersion` can run against catalog state written by `storedVersion`.
 * Versions in the same major line are compatible in both directions, so a desktop build with an
 * older bundle keeps running a catalog last saved by a newer cloud build (and vice versa).
 * In the 0.x line every minor version is treated as a breaking change, per semver.
 */
export function isVersionCompatible(storedVersion: string, codeVersion: string) {
  if (!isSemver(storedVersion) || !isSemver(codeVersion)) return false;
  const stored = parseSemver(storedVersion).numbers;
  const code = parseSemver(codeVersion).numbers;
  if (stored[0] !== code[0]) return false;
  return stored[0] !== 0 || stored[1] === code[1];
}
