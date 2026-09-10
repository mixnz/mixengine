#!/usr/bin/env node
/**
 * Stage the four headless binaries beside the window, then run `tauri dev` — T111.
 *
 * The window looks for `mixengined` in its own directory first (T107), and `tauri dev` starts it
 * out of src-tauri/target/debug/, where nothing else ever puts a daemon. So the MixEngine tab of a
 * development window either showed the *not installed* gate or, on a machine with a release
 * installed, found *that* daemon at the second step and started it against the wrong home — the
 * release default is `MixEngine`, a build out of cargo defaults to `MixEngine-dev` (ADR 0024), and
 * the gate then never leaves "not running".
 *
 * Three things, then `tauri dev`:
 *
 *   1. read MIX_BINARIES/MIX_CRATES out of packaging/common.sh, minus the window;
 *   2. `cargo build -p …` the four crates at the repository root, debug profile, like the window;
 *   3. copy them into src-tauri/target/debug/, unconditionally — a stale daemon beside a fresh
 *      window is the mismatch this script exists to remove, and comparing timestamps to skip a
 *      copy that takes milliseconds buys nothing.
 *
 * `tauri dev` is started from here rather than by `&&` in package.json because MIXENGINE_HOME has
 * to reach it: two commands joined by `&&` are two processes, and an environment set in the first
 * does not survive into the second. The home is the repository's own .mixengine-home, which is
 * what the root .cargo/config.toml gives `cargo run -p mixengine-daemon`, so the daemon the window
 * starts and the one a terminal starts are the same daemon. A MIXENGINE_HOME already set wins,
 * exactly as it does for cargo.
 *
 * Node and not bash: `npm run dev:app` is typed into PowerShell, and on a Windows machine with WSL
 * a bare `bash` is System32\bash.exe, which is WSL's. The other scripts in packaging/ are run from
 * Git Bash on purpose; `npm run` is not.
 *
 * Usage:
 *   npm run dev:app
 *   node scripts/stage-daemon.mjs --stage-only     # build and copy, no window
 */
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { headlessBinaries } from "./packaging-lists.mjs";

const app = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const root = resolve(app, "..", "..");
const suffix = process.platform === "win32" ? ".exe" : "";
const stageOnly = process.argv.includes("--stage-only");

const home = process.env.MIXENGINE_HOME || join(root, ".mixengine-home");

// 1. The list, from the one file that declares it.
const binaries = headlessBinaries(readFileSync(join(root, "packaging", "common.sh"), "utf8"));

// 2. Build. One cargo invocation for all four; cargo's own output is the report, and its own
//    status is the exit code when it fails.
const build = spawnSync("cargo", ["build", ...binaries.flatMap(({ crate }) => ["-p", crate])], {
  cwd: root,
  stdio: "inherit",
});
if (build.error) {
  console.error(`could not run cargo: ${build.error.message}`);
  process.exit(1);
}
if (build.status !== 0) {
  process.exit(build.status ?? 1);
}

// 3. Copy. The directory is created because the first `tauri dev` on a fresh clone has not made it
//    yet.
const destination = join(app, "src-tauri", "target", "debug");
mkdirSync(destination, { recursive: true });
for (const { binary } of binaries) {
  const file = `${binary}${suffix}`;
  const target = join(destination, file);
  try {
    copyFileSync(join(root, "target", "debug", file), target);
  } catch (error) {
    // A running executable cannot be replaced on Windows, and the error reads as a permission
    // problem (os error 5). Say what it is and what to do; do not start a window beside a daemon
    // of the wrong age.
    if (error.code === "EPERM" || error.code === "EBUSY" || error.code === "ETXTBSY") {
      console.error(
        `cannot replace ${target}: it is running.\n` +
          `Stop it first — \`mix daemon stop\` with MIXENGINE_HOME=${home}, or the window's own ` +
          `Stop button — and run this again.`,
      );
      process.exit(1);
    }
    throw error;
  }
}
console.log(`staged ${binaries.map(({ binary }) => binary).join(", ")} in ${destination}`);

if (stageOnly) {
  process.exit(0);
}

// 4. The window, with the home the daemon beside it will share. `node tauri.js` rather than the
//    `tauri` command: on Windows that command is a .cmd shim, which spawnSync cannot start without
//    a shell.
const tauri = join(app, "node_modules", "@tauri-apps", "cli", "tauri.js");
const dev = spawnSync(process.execPath, [tauri, "dev"], {
  cwd: app,
  stdio: "inherit",
  env: { ...process.env, MIXENGINE_HOME: home },
});
process.exit(dev.status ?? 1);
