#!/usr/bin/env bash
# Build the installer for the operating system you are sitting in front of.
#
#   scripts/build-installer.sh                    # this OS, its default installer
#   scripts/build-installer.sh --format deb       # Linux only: which of the four
#   scripts/build-installer.sh --skip-desktop     # reuse the window staged by an earlier run
#
# **A wrapper over `packaging/`, never a second packager.** What goes into an artifact is
# `MIX_BINARIES` in `packaging/common.sh` and nothing else; `stage.sh` gathers the four headless
# binaries plus MixLab, and each `packaging/<os>/build.sh` opens what it just made and refuses to
# exit until all five names are inside it (the T85 design, D11; the window is T105). A script here
# that assembled its own list would be a second place for that list to be wrong, which is exactly
# what T85c already was — so this file chooses a script and checks a machine, and stops there.
#
# What it adds over typing the packaging script yourself is the two ways a packaging run wastes
# your afternoon, both checked before the first crate compiles:
#
#   * **a missing packaging tool.** The first CI run of the Windows script compiled the workspace
#     for seven minutes and then stopped at "missing tools: makensis". Every tool the chosen script
#     will reach for is resolved up front here.
#   * **a managed process still holding its own file.** `stage.sh` copies over
#     `target/release/mixengined`, and Windows refuses to overwrite a running image — reported as
#     `os error 5`, which reads as a permissions problem and is not one.
#
# Exit status: 0 when an artifact was written, 1 when something refused, 64 for a misuse of this
# script.

source "$(dirname "${BASH_SOURCE[0]}")/../packaging/common.sh"

format=""
skip_desktop=0
want_format=0
for arg in "$@"; do
  if [ "$want_format" -eq 1 ]; then
    format="$arg"
    want_format=0
    continue
  fi
  case "$arg" in
    --format) want_format=1 ;;
    --format=*) format="${arg#--format=}" ;;
    --skip-desktop) skip_desktop=1 ;;
    *) echo "unknown argument: $arg" >&2; exit 64 ;;
  esac
done

if [ "$want_format" -eq 1 ]; then
  echo "--format needs one of: deb rpm appimage tarball" >&2
  exit 64
fi

os="$(uname -s)"

# The script to run, the tools it will reach for, and what it leaves behind — decided here so that
# everything below this block is the same three steps on every system.
#
# The tool lists are each script's own `mix_require` line plus what it shells out to, named again
# here for one reason: `mix_require` inside those scripts runs *after* `stage.sh` on some of them.
case "$os" in
  MINGW* | MSYS* | CYGWIN*)
    [ -z "$format" ] || { echo "--format is a Linux option; Windows builds one installer" >&2; exit 64; }
    script="$MIX_ROOT/packaging/windows/build.sh"
    tools=(unzip 7z)
    label="a per-user NSIS installer, a portable zip and a headless zip"
    # **7-Zip's installer does not put itself on `PATH`, and never has.** `packaging/windows/build.sh`
    # calls `7z` as a bare command because the GitHub runner image has it there; on a machine where a
    # person installed it, `mix_require 7z` fails with the tool sitting in the one place it always
    # sits. Prepend that directory rather than asking someone to edit their environment for a build
    # script — exported through `PATH`, so the packaging script inherits it.
    if ! command -v 7z >/dev/null 2>&1; then
      for candidate in "/c/Program Files/7-Zip" "/c/Program Files (x86)/7-Zip"; do
        if [ -x "$candidate/7z.exe" ]; then
          PATH="$candidate:$PATH"
          export PATH
          break
        fi
      done
    fi
    # NSIS is not on `PATH` on a normal install, so `mix_require makensis` would be wrong here in
    # both directions. The same two places `packaging/windows/build.sh` looks, in the same order.
    makensis="${MAKENSIS:-/c/Program Files (x86)/NSIS/makensis.exe}"
    if [ ! -x "$makensis" ]; then
      command -v makensis >/dev/null 2>&1 || {
        echo "makensis not found: install NSIS, or set MAKENSIS to its path" >&2
        echo "  winget install NSIS.NSIS" >&2
        exit 1
      }
    fi
    ;;
  Darwin)
    [ -z "$format" ] || { echo "--format is a Linux option; macOS builds one installer" >&2; exit 64; }
    script="$MIX_ROOT/packaging/macos/build.sh"
    tools=(pkgbuild productbuild lipo)
    label="one universal .pkg and a headless .tar.gz"
    ;;
  Linux)
    case "${format:-appimage}" in
      appimage)
        script="$MIX_ROOT/packaging/linux/build-appimage.sh"
        tools=(curl desktop-file-validate)
        label="an AppImage"
        ;;
      deb)
        script="$MIX_ROOT/packaging/linux/build-deb.sh"
        tools=(dpkg-deb)
        label="a .deb"
        ;;
      rpm)
        script="$MIX_ROOT/packaging/linux/build-rpm.sh"
        tools=(rpmbuild)
        label="an .rpm"
        ;;
      tarball)
        script="$MIX_ROOT/packaging/linux/build-tarball.sh"
        tools=(tar)
        label="the update payload and a headless .tar.gz"
        ;;
      *)
        echo "unknown format: $format (deb rpm appimage tarball)" >&2
        exit 64
        ;;
    esac
    ;;
  *)
    echo "no packaging script for $os — see packaging/README.md" >&2
    exit 1
    ;;
esac

# `node` and `npm` because every one of those scripts reaches `packaging/desktop.sh`, directly or
# through `stage.sh`: an installer without MixLab in it is not one this product ships (T105).
mix_require cargo node npm "${tools[@]}"

# **The one failure that looks like something else.** A build cannot replace a binary that is
# running: Windows reports `os error 5`, which reads as a permissions problem, and on the other two
# an overwritten-in-place executable is worse than a refusal. Name the process and the command that
# stops it rather than letting cargo say `Permission denied` forty crates from now.
running=()
case "$os" in
  MINGW* | MSYS* | CYGWIN*)
    # `//NH //FO` and not `/NH /FO`: MSYS rewrites a single leading slash into a Windows path, and
    # `tasklist` then rejects an argument nobody typed.
    processes="$(tasklist //NH //FO CSV 2>/dev/null || true)"
    for binary in "${MIX_BINARIES[@]}"; do
      case "$processes" in
        *"\"$binary.exe\""*) running+=("$binary") ;;
      esac
    done
    ;;
  *)
    # `if` and not `pgrep … && running+=(…)`: `common.sh` sets `set -e`, under which an AND-list
    # whose left side fails is a failing statement — so the no-match case, which is the ordinary
    # one, would end the script here.
    for binary in "${MIX_BINARIES[@]}"; do
      if pgrep -x "$binary" >/dev/null 2>&1; then
        running+=("$binary")
      fi
    done
    ;;
esac

if [ ${#running[@]} -ne 0 ]; then
  echo "still running: ${running[*]}" >&2
  echo "the build would fail to overwrite them — stop them first:" >&2
  echo "  cargo run -p mixengine-cli -- daemon stop" >&2
  exit 1
fi

version="$(mix_version)"
echo "MixEngine $version — $label"
echo "  $(basename "$script")"
echo

# **Once, up front, rather than inside the packaging run.** `stage.sh` builds the window itself when
# nothing has staged it, so this line is only ever about where the ten minutes are spent and what
# you are looking at while they are — except on Linux, where each of the four scripts calls
# `stage.sh` and the guard is what keeps a second format from paying for the webview again.
if [ "$skip_desktop" -eq 1 ]; then
  window="$MIX_OUT/window/$(mix_window_key "")"
  test -e "$(mix_window_in "$window")" || {
    echo "--skip-desktop, but nothing is staged at $window" >&2
    exit 1
  }
  echo "using the staged window at $window"
else
  bash "$MIX_ROOT/packaging/desktop.sh"
fi

# Every packaging script prints the files it wrote, one per line, and this is a wrapper: pass them
# through as they are rather than summarising them into something a reader has to trust.
bash "$script"
