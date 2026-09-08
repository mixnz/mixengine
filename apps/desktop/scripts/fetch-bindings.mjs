// Vendor MixEngine's published API contract into `src/modules/mixengine/api/types/`.
//
// The types are generated from the `mixengine-proto` crate by ts-rs and checked current by that
// project's CI, so keeping a second hand-written copy here is how the two drift apart. This script
// is the only way that directory is ever written.
//
// Extraction goes through the system `tar` rather than an npm package: Windows 10 and later ship
// bsdtar as `tar.exe`, macOS and Linux have their own, and this repository does not need a
// dependency for one dev-time script.
//
//   npm run bindings -- 0.0.1-beta.1
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

const version = process.argv[2];
if (!version) {
  console.error("usage: npm run bindings -- <version>   e.g. 0.0.1-beta.1");
  process.exit(1);
}

const base = `https://github.com/mixnz/mixengine/releases/download/v${version}`;
const archiveName = `mixengine-api-${version}-typescript.tar.gz`;
const out = fileURLToPath(new URL("../src/modules/mixengine/api/types/", import.meta.url));
const archive = `${out}${archiveName}`;

/** Fetch, or say what was asked for and stop. A 404 here is almost always a version that has no
 *  release rather than anything wrong with this script. */
async function fetchOrDie(url) {
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) {
    console.error(`${url} answered ${response.status}`);
    console.error("If that release carries no such asset, stop and open an issue on mixnz/mixengine.");
    console.error("Do not copy the types by hand: a second hand-kept copy is what this script exists to avoid.");
    process.exit(1);
  }
  return response;
}

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

await pipeline((await fetchOrDie(`${base}/${archiveName}`)).body, createWriteStream(archive));

// The release also carries a `.minisig` signed with the same key as the binaries. Checking it needs
// minisign, which is not a dependency of this repository, so what is checked here is the published
// SHA-256 — enough to catch a truncated or swapped download, and not a substitute for the
// signature. Verify the `.minisig` by hand when the provenance matters.
const published = (await (await fetchOrDie(`${base}/${archiveName}.sha256`)).text()).trim().split(/\s+/)[0];
const actual = createHash("sha256").update(await readFile(archive)).digest("hex");
if (published !== actual) {
  console.error(`SHA-256 mismatch: published ${published}, downloaded ${actual}`);
  await rm(archive, { force: true });
  process.exit(1);
}

// The archive is npm-package shaped, so every entry sits under `package/`.
//
// Run from `out` and name the archive without its directory: GNU tar — which is what Git Bash puts
// on PATH on Windows — reads a leading `C:` as `host:path` and tries to fetch the archive over the
// network. A bare filename has no drive letter to misread, and both GNU tar and the bsdtar that
// ships with Windows 10 accept it.
execFileSync("tar", ["-xzf", archiveName, "--strip-components=1"], { cwd: out, stdio: "inherit" });
await rm(archive);
await writeFile(`${out}VERSION`, `${version}\n`);

console.log(`bindings ${version} vendored into src/modules/mixengine/api/types/ (sha256 ${actual.slice(0, 12)}…)`);
