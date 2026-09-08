/**
 * Sets MixDB's version in the six files that carry it, and cuts the changelog for it.
 *
 *   node scripts/set-version.mjs 0.2.0
 *   node scripts/set-version.mjs 0.2.0 --no-notes    # a release with nothing user-facing in it
 *
 * The version has to match everywhere: `tauri.conf.json` is what the built app reports and what
 * the update check compares against, `Cargo.toml` is what the Windows installer stamps into the
 * binary, and a `Cargo.lock` left behind fails any build run with `--locked`, which CI is. Bumping
 * them by hand means one of them is eventually forgotten, and the symptom of that — an app that
 * announces an update to the version it is already running — only shows up after a release.
 * README.md's "Phiên bản mới nhất" line is the fifth: nothing depends on it, but it is the first
 * thing anyone reads about the project, so a stale one is a claim rather than a missing update.
 *
 * `package-lock.json` is the sixth, and the one this script used to miss. It carries the version
 * twice — at the root and again under `packages[""]` — and npm rewrites both from `package.json`
 * on the next install, so a lock left behind does not stay behind: it resurfaces as a version bump
 * inside whatever unrelated commit happened to install something. `npm ci` also refuses to run at
 * all when the two files disagree, which is how CI would find out.
 *
 * CHANGELOG.md is the seventh: its `## [Unreleased]` section becomes `## [0.2.0] - <today>` here,
 * and release.yml reads that section back out to fill in the draft release's notes. An empty
 * `## [Unreleased]` stops the bump rather than passing silently, since a release nobody can read
 * the notes of is the thing that file exists to prevent — `--no-notes` is the way past it for a
 * version that genuinely has nothing to tell users.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// The date the version is cut, in local time: the changelog and the README are read by people, and
// a UTC date is a day off for anyone who cuts a release in the evening east of Greenwich. `sv-SE`
// is the shortest way to ask for ISO 8601.
const today = new Date().toLocaleDateString("sv-SE");

const args = process.argv.slice(2);
const allowEmptyNotes = args.includes("--no-notes");
const version = args.find((arg) => !arg.startsWith("--"));
if (!version || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
  console.error("Usage: node scripts/set-version.mjs <version> [--no-notes]   e.g. 0.2.0 or 0.2.0-beta.1");
  process.exit(1);
}

/**
 * Rewrites one file, and says so.
 *
 * Throws unless the pattern is found exactly `expected` times, since a silent no-op is exactly the
 * half-bumped state this script exists to prevent — and one of these files carries the version
 * twice, where finding it once would be as wrong as finding it not at all.
 */
function patch(relative, pattern, replacement, expected = 1) {
  const path = join(root, relative);
  const before = readFileSync(path, "utf8");
  const every = new RegExp(pattern.source, `${pattern.flags.replace("g", "")}g`);
  const found = [...before.matchAll(every)].length;
  if (found !== expected) {
    throw new Error(
      `Expected the version ${expected}× in ${relative}, found it ${found}× — the file's shape has changed.`,
    );
  }
  const after = before.replace(every, replacement);
  if (after !== before) writeFileSync(path, after);
  console.log(`${after === before ? "already" : "set    "} ${relative}`);
}

/** Where the repository lives, for the compare links at the foot of the changelog. */
const REPO_URL = "https://github.com/mixnz/mixdb";

// First, because it is the one that can refuse. A changelog with nothing written in it stops the
// bump, and stopping it after four files had already been rewritten would leave exactly the
// half-bumped state the rest of this script exists to prevent.
cutChangelog();
linkChangelog();

patch("package.json", /("version"\s*:\s*)"[^"]*"/, `$1"${version}"`);
patch("src-tauri/tauri.conf.json", /("version"\s*:\s*)"[^"]*"/, `$1"${version}"`);

// Both of the lock's own entries, found by the name above them so no dependency is touched. Two
// and not one: the root object and `packages[""]` each carry it, and npm keeps them equal.
patch(
  "package-lock.json",
  /("name": "mixdb",\r?\n\s*"version": )"[^"]*"/,
  `$1"${version}"`,
  2,
);

// Only the `[package]` block at the top — every dependency below it has a version too.
patch("src-tauri/Cargo.toml", /(\[package\][\s\S]*?\nversion\s*=\s*)"[^"]*"/, `$1"${version}"`);

// The lock file's own entry for this crate, found by name so the dependencies are left alone.
// `\r?` because cargo writes this file with LF and git hands it back with CRLF on a Windows
// checkout, so the same file has either ending depending on which of them touched it last.
patch(
  "src-tauri/Cargo.lock",
  /(name = "mixdb"\r?\nversion = )"[^"]*"/,
  `$1"${version}"`,
);

// The one line in the README that names a version, date and all.
patch("README.md", /(Phiên bản mới nhất: \*\*)[^*]*(\*\* \()[^)]*(\))/, `$1${version}$2${today}$3`);

/**
 * Turns `## [Unreleased]` into `## [<version>] - <today>` and opens a fresh empty one above it.
 *
 * Idempotent by way of the same check the version patches make: a file that already has a section
 * for this version is left exactly as it is, so re-running the bump cannot cut a second one.
 */
function cutChangelog() {
  const path = join(root, "CHANGELOG.md");
  const before = readFileSync(path, "utf8");

  const heading = /^##\s+\[Unreleased\]\s*$/m;
  if (!heading.test(before)) {
    throw new Error("Cannot find a `## [Unreleased]` heading in CHANGELOG.md.");
  }

  if (new RegExp(`^##\\s+\\[${version.replace(/\./g, "\\.")}\\]`, "m").test(before)) {
    console.log("already CHANGELOG.md");
    return;
  }

  // What sits under the heading, up to the next release section — or to the end of the file, on
  // a changelog that has no released sections yet.
  const start = before.search(heading);
  const bodyStart = before.indexOf("\n", start) + 1;
  const nextSection = before.slice(bodyStart).search(/^##\s+\[/m);
  const body = (nextSection === -1 ? before.slice(bodyStart) : before.slice(bodyStart, bodyStart + nextSection)).trim();
  const tail = nextSection === -1 ? "" : before.slice(bodyStart + nextSection);

  if (body === "" && !allowEmptyNotes) {
    // Not thrown: an empty section is something the user has to decide about, not a bug in this
    // script, and a stack trace above the instructions buries them.
    console.error("`## [Unreleased]` in CHANGELOG.md is empty — this release would ship with no notes.");
    console.error("  Write what changed (`npm run notes` drafts it from the commits), or pass --no-notes.");
    process.exit(1);
  }

  const cut = `## [Unreleased]\n\n## [${version}] - ${today}\n\n${body === "" ? "Nothing user-facing." : body}\n`;

  writeFileSync(path, `${before.slice(0, start)}${cut}${tail === "" ? "" : `\n${tail}`}`);
  console.log("set     CHANGELOG.md");
}

/**
 * Adds this version's link definition and moves `[Unreleased]` on to compare from it.
 *
 * The bracketed names in the headings are links in Keep a Changelog, and a file whose definitions
 * stop being written is worse than one that never had them: the headings still look like links and
 * silently render as plain text. So this is done by the script that cuts the section rather than by
 * whoever remembers.
 *
 * Idempotent the same way `cutChangelog` is — a definition for this version already present means
 * the bump has been run before.
 */
function linkChangelog() {
  const path = join(root, "CHANGELOG.md");
  const before = readFileSync(path, "utf8");
  const escaped = version.replace(/\./g, "\\.");

  if (new RegExp(`^\\[${escaped}\\]:`, "m").test(before)) {
    console.log("already CHANGELOG.md links");
    return;
  }
  const unreleased = /^\[Unreleased\]:.*$/m;
  if (!unreleased.test(before)) {
    throw new Error("Cannot find the `[Unreleased]:` link definition in CHANGELOG.md.");
  }

  // The version currently at the top of the definitions, which is the one this release follows.
  const previous = before.match(/^\[(\d+\.\d+\.\d+)\]:/m)?.[1];
  const link = previous
    ? `[${version}]: ${REPO_URL}/compare/v${previous}...v${version}`
    : `[${version}]: ${REPO_URL}/releases/tag/v${version}`;

  writeFileSync(
    path,
    before.replace(unreleased, `[Unreleased]: ${REPO_URL}/compare/v${version}...HEAD\n${link}`),
  );
  console.log("set     CHANGELOG.md links");
}

console.log(`\nMixDB is now ${version}. Commit, then tag it:\n  git tag v${version} && git push origin v${version}`);
