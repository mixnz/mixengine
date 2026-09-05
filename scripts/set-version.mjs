#!/usr/bin/env node
// Set the workspace version, and nothing else.
//
//   node scripts/set-version.mjs 0.0.1-beta.1
//   node scripts/set-version.mjs 0.0.1-beta.1 --dry-run
//
// **There is one place the version is written**, `[workspace.package]` in the root `Cargo.toml`.
// Every crate takes `version.workspace = true`, and everything in `packaging/` reads it back with
// `mix_version()` in `packaging/common.sh` — which is what makes "cutting a release is a version
// bump and nothing else" true. So this script edits one line and then lets cargo write `Cargo.lock`.
//
// **What it must not do is replace the old version wherever it appears.** Six blueprints in
// `crates/mixengine-core/src/blueprints/gallery/` and one CLI fixture carry a
// `[blueprint.created_on] version`, which is the MixEngine a blueprint was *captured on* — a fact
// about the past. Rewriting those would make six documents claim they were captured on a release
// that did not exist when they were written. They are reported at the end and never touched.

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MANIFEST = join(ROOT, "Cargo.toml");

/** Semantic versions, with an optional pre-release and build metadata. */
const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

function fail(message) {
  console.error(`set-version: ${message}`);
  process.exit(1);
}

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const wanted = args.find((arg) => !arg.startsWith("-"));

if (!wanted) {
  fail("usage: node scripts/set-version.mjs <version> [--dry-run]");
}
if (!SEMVER.test(wanted)) {
  fail(`${wanted} is not a semantic version — e.g. 0.1.0, or 0.0.1-beta.1`);
}

// Replace the `version` line inside `[workspace.package]` and inside no other table. A file-wide
// regex would also match `[package]`, `[dependencies]` entries and `rust-version`.
const manifest = readFileSync(MANIFEST, "utf8");
const lines = manifest.split("\n");

let inWorkspacePackage = false;
let at = -1;
let current = null;

for (const [index, line] of lines.entries()) {
  if (line.startsWith("[")) {
    inWorkspacePackage = line.trim() === "[workspace.package]";
    continue;
  }
  if (!inWorkspacePackage) continue;

  const found = line.match(/^version = "(.*)"$/);
  if (found) {
    [at, current] = [index, found[1]];
    break;
  }
}

if (at === -1) {
  fail(`no version under [workspace.package] in ${relative(ROOT, MANIFEST)}`);
}
if (current === wanted) {
  fail(`the workspace version is already ${wanted}`);
}

console.log(`${relative(ROOT, MANIFEST)}: ${current} -> ${wanted}`);

if (dryRun) {
  console.log("--dry-run: nothing written");
} else {
  lines[at] = `version = "${wanted}"`;
  writeFileSync(MANIFEST, lines.join("\n"));

  // Cargo owns `Cargo.lock`. `--workspace` re-resolves the members only, so a version bump does not
  // quietly pull in new dependency versions along with it.
  try {
    execFileSync("cargo", ["update", "--workspace", "--quiet"], {
      cwd: ROOT,
      stdio: "inherit",
    });
    console.log("Cargo.lock: refreshed by cargo update --workspace");
  } catch {
    fail("cargo update --workspace failed — Cargo.lock still names the old version");
  }
}

// Look for a hardcoded version only where one would be a *bug*: everything under `packaging/` and
// `.github/` is supposed to read `mix_version()` instead. Searching the whole tree would report
// dozens of test fixtures, doc examples and `created_on` fields — noise this script would then have
// to tell the reader to ignore, which is a habit worth not starting.
let hardcoded = [];
try {
  const listed = execFileSync(
    "git",
    ["grep", "-l", "--fixed-strings", current, "--", "packaging", ".github"],
    { cwd: ROOT, encoding: "utf8" },
  );
  hardcoded = listed.split("\n").filter(Boolean);
} catch {
  // `git grep` exits non-zero when it matches nothing, which is the answer we want.
}

if (hardcoded.length > 0) {
  console.log(`\nWarning: ${current} is written out in these, which derive it everywhere else:`);
  for (const path of hardcoded) console.log(`  ${path}`);
}

console.log("\nNext: commit Cargo.toml and Cargo.lock, then tag — see docs/releasing.md");
