#!/usr/bin/env bash
# Build the release binaries and put the five of them in one directory.
#
# Four of the five are built here from the workspace root; the fifth, the window, is built by
# `packaging/desktop.sh` — its crate is a workspace of its own that this one excludes (ADR 0027,
# rule 5) — and copied in below. See the T105 design, D2.
#
# Every per-OS script starts here, so "what is in a release" is written once and not three times.
# Prints the staging directory on its last line; callers read it with `| tail -1`.
#
# `--target <triple>` is always passed by every caller — T85a, D5 — even on a native build, so no
# script is silently trusting cargo's own default. `--container <image>` additionally builds inside
# that image rather than on the runner directly, for a leg that wants an older glibc than the runner
# ships — T85a, D2/D3.

source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

target=""
container=""
build_only=""
while [ $# -gt 0 ]; do
  case "$1" in
    --target)
      target="$2"
      shift 2
      ;;
    --container)
      container="$2"
      shift 2
      ;;
    --build-only)
      build_only=1
      shift
      ;;
    *)
      echo "unknown argument: $1" >&2
      exit 64
      ;;
  esac
done

if [ -n "$container" ] && [ -z "$target" ]; then
  echo "--container needs --target" >&2
  exit 64
fi

# `-p` per crate, from the one list in `common.sh` — **minus the window's**, which is a workspace of
# its own that this root excludes (ADR 0027, rule 5) and which `packaging/desktop.sh` builds
# instead. Two shapes of the same thing: an array for the two branches that invoke cargo directly,
# and a string for the one that passes a command into a container.
packages=()
packages_string=""
for crate in "${MIX_CRATES[@]}"; do
  if [ "$crate" = "$MIX_WINDOW" ]; then
    continue
  fi
  packages+=(-p "$crate")
  packages_string="$packages_string -p $crate"
done

# **What makes these binaries releases** — roadmap task T95. `mixengine_platform::RELEASE` reads this
# at compile time and the default home directory follows it, so a binary built without it defaults to
# `MixEngine-dev` and one built with it defaults to `MixEngine`.
#
# Exported here rather than written on each of the three `cargo build` lines below: three places to
# set it is three places to forget it, and forgetting it ships an artifact that renames every user's
# home. `packaging/*/build.sh` checks the staged binary rather than trusting this line.
export MIXENGINE_RELEASE=1

# **The C runtime goes inside every Windows binary** — roadmap task T150, measured 2026-09-16. Built
# the default way, `mix.exe` and `mixengined.exe` import `vcruntime140.dll`, and a Windows Sandbox
# with no Visual C++ runtime refused to start `mix --version` at all (`0xC0000135`): the machine
# phase 18 exists to rescue could not run the thing that rescues it. The window already links it
# statically, because `tauri-build` does so for every Tauri application. Here, and not in
# `.cargo/config.toml`, which sets no flags: a release is what has to run on a bare machine, and a
# test build on a developer's machine does not. `--target` is what keeps the flag off build scripts.
case "${target:-$(mix_host_target)}" in
  *-windows-msvc) export RUSTFLAGS="${RUSTFLAGS:+$RUSTFLAGS }-C target-feature=+crt-static" ;;
esac

# `--locked`, so a packaging run cannot quietly resolve a dependency the tested build did not have.
if [ -n "$container" ]; then
  mix_in_container "$container" \
    "rustup target add '$target' && cargo build --release --locked --target '$target'$packages_string"
  built="$MIX_ROOT/target/$target/release"
  stage="$MIX_OUT/stage/$target"
elif [ -n "$target" ]; then
  cargo build --release --locked --target "$target" "${packages[@]}"
  built="$MIX_ROOT/target/$target/release"
  stage="$MIX_OUT/stage/$target"
else
  cargo build --release --locked "${packages[@]}"
  built="$MIX_ROOT/target/release"
  stage="$MIX_OUT/stage/host"
fi

# `--build-only` (T170i): the compile and nothing else, so CI can run it beside `desktop.sh` and the
# packaging scripts that call this file afterwards find every binary fresh. Every flag above —
# `MIXENGINE_RELEASE`, `crt-static`, `--locked`, the container — applies to it unchanged, which is why
# this is a flag here and not a second copy of the command in the workflow.
if [ -n "$build_only" ]; then
  exit 0
fi

rm -rf "$stage"
mkdir -p "$stage"

suffix="$(mix_exe_suffix)"

for binary in $(mix_headless_binaries); do
  cp "$built/$binary$suffix" "$stage/$binary$suffix"
done

# The window, from wherever this leg built it — T105, D2. **Built here only if nothing staged it**:
# CI runs `packaging/desktop.sh` as a step of its own, and the four Linux packaging scripts each
# call this file, so without the guard one leg would build a webview application four times.
window="$MIX_OUT/window/$(mix_window_key "$target")"
if [ ! -e "$(mix_window_in "$window")" ]; then
  if [ -n "$target" ]; then
    bash "$MIX_ROOT/packaging/desktop.sh" --target "$target" >/dev/null
  else
    bash "$MIX_ROOT/packaging/desktop.sh" >/dev/null
  fi
fi

# `-R`, because on macOS this is a directory.
cp -R "$(mix_window_in "$window")" "$(mix_window_in "$stage")"

# **A stage missing a binary is the failure this whole job exists to notice**, and it is not one any
# wrapper below would report: a zip of two files is a perfectly good zip, and a `.deb` with no helper
# in it installs cleanly and leaves the machine one file short of being able to elevate.
for binary in $(mix_headless_binaries); do
  test -f "$stage/$binary$suffix" || {
    echo "missing from the stage: $binary$suffix" >&2
    exit 1
  }
done

# `-e` and not `-f`: on macOS the window is a bundle directory.
test -e "$(mix_window_in "$stage")" || {
  echo "missing from the stage: $(basename "$(mix_window_in "$stage")")" >&2
  exit 1
}

echo "$stage"
