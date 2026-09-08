/**
 * Puts the `## Changes` section of a release body into the `notes` field of `latest.json`.
 *
 * Run by .github/workflows/update-notes.yml:
 *
 *   node .github/scripts/sync-notes.mjs latest.json body.md
 *
 * Writes `latest.json` back in place and touches `latest.json.changed` when it actually differed —
 * the workflow only re-uploads the asset if that marker appears, which is what stops the edit it
 * makes from setting off another round of itself.
 *
 * Only the `## Changes` section, not the whole body. The rest of a MixDB release body is
 * first-install instructions — SmartScreen, Gatekeeper, `chmod +x` — and the panel in the corner of
 * the app shows the first line of whatever it is handed. Handed the whole body, it says "Download
 * the file for your machine below", which tells a user who already has MixDB installed nothing.
 */

import { readFileSync, writeFileSync } from "node:fs";

const [manifestPath, bodyPath] = process.argv.slice(2);
if (!manifestPath || !bodyPath) {
  console.error("usage: sync-notes.mjs <latest.json> <body.md>");
  process.exit(1);
}

/**
 * The lines under `## Changes`, up to the next heading of the same level or higher.
 *
 * Comments are dropped: the workflow's template leaves an HTML comment there as a reminder to write
 * something, and a release published without that being done should end up with empty notes rather
 * than with the reminder.
 */
function extractChanges(body) {
  const lines = body.replace(/\r\n/g, "\n").split("\n");
  const start = lines.findIndex((line) => /^##\s+Changes\s*$/i.test(line.trim()));
  if (start === -1) return "";

  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^#{1,2}\s+\S/.test(line.trim()));
  const section = (end === -1 ? rest : rest.slice(0, end)).join("\n");

  return section
    .replace(/<!--[\s\S]*?-->/g, "")
    .trim();
}

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const changes = extractChanges(readFileSync(bodyPath, "utf8"));

if (changes === "") {
  // Nothing was written. Leaving the build-time placeholder in place would be worse than saying
  // nothing at all, so the field is cleared and the panel falls back to just naming the version.
  console.log("No ## Changes section in the release body.");
}

if ((manifest.notes ?? "") === changes) {
  console.log("latest.json notes already match the release body.");
  process.exit(0);
}

manifest.notes = changes;
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
writeFileSync(`${manifestPath}.changed`, "");
console.log(`Updated notes (${changes.length} chars).`);
