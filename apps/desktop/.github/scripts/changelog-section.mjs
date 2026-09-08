/**
 * Prints one version's section of CHANGELOG.md to stdout.
 *
 * Run by .github/workflows/release.yml:
 *
 *   node .github/scripts/changelog-section.mjs CHANGELOG.md 0.2.0
 *
 * That output becomes the `## Changes` part of the draft release body, which update-notes.yml
 * later copies into the `notes` field of `latest.json` — so this is the first link in the chain
 * that ends at the update panel in the corner of every installed copy of MixDB.
 *
 * A missing file, or a version with no section in it, prints nothing and exits cleanly. The
 * release is a draft either way: notes can still be written by hand on it before publishing, and
 * failing the build of three platforms over a heading would cost far more than it saved.
 */

import { readFileSync } from "node:fs";

const [path, version] = process.argv.slice(2);
if (!path || !version) {
  console.error("usage: changelog-section.mjs <CHANGELOG.md> <version>");
  process.exit(1);
}

let text;
try {
  text = readFileSync(path, "utf8").replace(/\r\n/g, "\n");
} catch {
  process.exit(0);
}

const lines = text.split("\n");
// `## [0.2.0] - 2026-08-10`, matched on the bracketed version alone so the date is free to be
// written however, or left off.
const start = lines.findIndex((line) =>
  new RegExp(`^##\\s+\\[${version.replace(/[.\\+]/g, "\\$&")}\\]`).test(line.trim()),
);
if (start === -1) process.exit(0);

const rest = lines.slice(start + 1);
const end = rest.findIndex((line) => /^##\s+\S/.test(line));
const section = (end === -1 ? rest : rest.slice(0, end)).join("\n").trim();

if (section !== "") console.log(section);
