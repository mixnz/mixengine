/**
 * Lists the commits since the last release tag, grouped the way CHANGELOG.md wants them.
 *
 *   npm run notes                  # since the newest tag, up to HEAD
 *   npm run notes -- v0.0.4..v0.0.5   # any range, e.g. to reconstruct an old release
 *   npm run notes -- --all         # include the commits normally left out
 *
 * This is a *starting draft*, not the finished notes. It knows what was done, because the commit
 * subjects say so; it does not know which of it a user would notice, or how to say it to them. So
 * what it prints is meant to be pasted under `## [Unreleased]` and then edited down into plain
 * sentences — the entries that survive that edit are the release notes.
 *
 * Commit types map to Keep a Changelog headings: `feat` is Added, `fix` is Fixed, and `perf`,
 * `refactor` and `style` are Changed. Everything else — `chore`, `ci`, `build`, `docs`, `test` —
 * is dropped, because the changelog is written for people who use MixDB rather than people who
 * work on it. `--all` prints those too, under Other, for when one of them turns out to matter.
 */

import { execFileSync } from "node:child_process";

const args = process.argv.slice(2);
const includeAll = args.includes("--all");
const range = args.find((arg) => !arg.startsWith("--"));

function git(...argv) {
  return execFileSync("git", argv, { encoding: "utf8" }).trim();
}

/** The newest tag reachable from HEAD, or null in a repository that has none yet. */
function lastTag() {
  try {
    return git("describe", "--tags", "--abbrev=0");
  } catch {
    return null;
  }
}

const from = range ?? (lastTag() ? `${lastTag()}..HEAD` : "HEAD");

/** `feat(redis): message` -> its three parts; anything else is left whole as an untyped subject. */
function parse(subject) {
  const match = /^(\w+)(?:\(([^)]*)\))?!?:\s*(.+)$/.exec(subject);
  if (!match) return { type: "", scope: "", message: subject };
  return { type: match[1].toLowerCase(), scope: match[2] ?? "", message: match[3] };
}

/** Which Keep a Changelog heading a commit type belongs under, or null for one that is dropped. */
const HEADINGS = {
  feat: "Added",
  fix: "Fixed",
  perf: "Changed",
  refactor: "Changed",
  style: "Changed",
};

/** The order the headings print in, whichever of them turn out to be used. */
const ORDER = ["Added", "Changed", "Fixed", "Other"];

const subjects = git("log", "--no-merges", "--format=%s", from)
  .split("\n")
  .filter((line) => line !== "");

const groups = new Map();
let dropped = 0;

for (const subject of subjects) {
  const { type, scope, message } = parse(subject);
  const heading = HEADINGS[type] ?? (includeAll ? "Other" : null);
  if (heading === null) {
    dropped += 1;
    continue;
  }
  const entry = scope ? `- ${scope}: ${message}` : `- ${message}`;
  groups.set(heading, [...(groups.get(heading) ?? []), entry]);
}

console.log(`# ${from} — ${subjects.length} commit${subjects.length === 1 ? "" : "s"}\n`);

if (groups.size === 0) {
  console.log("Nothing to write up.\n");
} else {
  for (const heading of ORDER) {
    const entries = groups.get(heading);
    if (!entries) continue;
    console.log(`### ${heading}\n`);
    console.log(`${entries.join("\n")}\n`);
  }
}

if (dropped > 0) {
  console.log(
    `${dropped} commit${dropped === 1 ? "" : "s"} left out (chore, ci, build, docs, test).` +
      " Run with --all to see them.",
  );
}

console.log("\nEdit these into sentences a user would recognise, then put them under ## [Unreleased] in CHANGELOG.md.");
