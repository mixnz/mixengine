/**
 * Builds latest.json for a release from scratch, from the installers already uploaded to it and
 * their .sig sidecars — rather than the three matrix jobs each merging their own platform into a
 * shared copy of the file, which is a race across jobs writing to the same release asset. v0.0.30
 * lost its windows and linux entries that way: the macOS job's write overwrote the file instead of
 * extending it, most likely because its own fetch of the file-to-merge-into missed what the other
 * two jobs had already uploaded.
 *
 * Run by .github/workflows/release.yml, once, after every platform build has finished:
 *
 *   node .github/scripts/build-manifest.mjs <version> <notes-file> <sigs-dir> <out-file>
 *
 * <sigs-dir> holds every *.sig already downloaded from the release. A platform is included only
 * when its installer's .sig is present there — a platform whose build failed (fail-fast is off)
 * is silently left out rather than pointing at a file that was never uploaded, and can be topped
 * up later the same way a failed build is today: re-run that job, then re-run this one.
 */
import { readFileSync, existsSync, writeFileSync } from "node:fs";

const [version, notesPath, sigsDir, outPath] = process.argv.slice(2);
if (!version || !notesPath || !sigsDir || !outPath) {
  console.error("usage: build-manifest.mjs <version> <notes-file> <sigs-dir> <out-file>");
  process.exit(1);
}

const base = `https://github.com/mixnz/mixdb/releases/download/v${version}`;
const notes = readFileSync(notesPath, "utf8").trim();

const sigPath = (name) => `${sigsDir}/${name}.sig`;
const has = (name) => existsSync(sigPath(name));
const entryFor = (name) => ({
  signature: readFileSync(sigPath(name), "utf8").trim(),
  url: `${base}/${name}`,
});

const platforms = {};

// windows-latest, target "" (NSIS only — the .msi was dropped, see docs/RELEASING.md).
const setup = `MixDB_${version}_x64-setup.exe`;
if (has(setup)) {
  const entry = entryFor(setup);
  platforms["windows-x86_64"] = entry;
  platforms["windows-x86_64-nsis"] = entry;
}

// ubuntu-22.04.
const appImage = `MixDB_${version}_amd64.AppImage`;
if (has(appImage)) {
  const entry = entryFor(appImage);
  platforms["linux-x86_64"] = entry;
  platforms["linux-x86_64-appimage"] = entry;
}
const deb = `MixDB_${version}_amd64.deb`;
if (has(deb)) {
  platforms["linux-x86_64-deb"] = entryFor(deb);
}

// macos-latest, universal-apple-darwin — one bundle for both architectures.
const darwin = "MixDB_universal.app.tar.gz";
if (has(darwin)) {
  const entry = entryFor(darwin);
  platforms["darwin-aarch64"] = entry;
  platforms["darwin-x86_64"] = entry;
  platforms["darwin-aarch64-app"] = entry;
  platforms["darwin-x86_64-app"] = entry;
}

if (Object.keys(platforms).length === 0) {
  console.error("No installer had a matching .sig in " + sigsDir + " — nothing to write.");
  process.exit(1);
}

const manifest = {
  version,
  notes,
  pub_date: new Date().toISOString(),
  platforms,
};

writeFileSync(outPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Wrote ${outPath} with platforms: ${Object.keys(platforms).join(", ")}`);
