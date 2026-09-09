#!/usr/bin/env bash
# Build MixLab — the window — and put it where `stage.sh` can copy it from.
#
# **Its own script rather than a branch inside `stage.sh`**, and not because that would be untidy:
# `stage.sh` builds from the workspace root with `cargo build -p`, and the desktop application's
# crate is a workspace of its own that this one `exclude`s (ADR 0027, rule 5). `-p mixlab` there is
# an error, not a build. See the T105 design, D2.
#
# Run once per build leg. `stage.sh` runs it itself when nothing is staged, which is what keeps
# `bash packaging/linux/build-deb.sh` working end to end on a developer machine; CI runs it as a
# step of its own so that the four Linux packaging scripts, which each call `stage.sh`, do not race
# to be the one that pays for it.

source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

# Named rather than discovered: a machine without a Node toolchain should be told which one is
# missing, not watch `npm` fail to be a command halfway through a release.
mix_require node npm

target=""
while [ $# -gt 0 ]; do
  case "$1" in
    --target)
      target="$2"
      shift 2
      ;;
    *)
      echo "unknown argument: $1" >&2
      exit 64
      ;;
  esac
done

[ -n "$target" ] || target="$(mix_host_target)"

# **What makes this binary a release** — T95, and read from the client's side for the same reason
# `stage.sh` exports it for the other four: `mixengine_platform::RELEASE` is compiled in from this,
# and a window built without it looks for a daemon under `MixEngine-dev` and reports the one a user
# installed as not running. Measured on run 34244691840.
export MIXENGINE_RELEASE=1

app="$MIX_ROOT/apps/desktop"

# `npm ci` and not `npm install`: a packaging run may not quietly resolve a dependency the tested
# build did not have, which is `stage.sh`'s `--locked` said in the other language.
(cd "$app" && npm ci)

shopt -s nullglob

case "$(uname -s)" in
  Darwin)
    # `--bundles app`, because a webview application on macOS is a directory rather than a file, and
    # that directory is what goes into `/Applications`. Universal in one build: both slices are
    # `rustup` targets here, exactly as `packaging/macos/build.sh` arranges for the other four.
    rustup target add x86_64-apple-darwin aarch64-apple-darwin
    (cd "$app" && npm run tauri -- build --bundles app --target universal-apple-darwin)

    bundles=("$app/src-tauri/target/universal-apple-darwin/release/bundle/macos"/*.app)
    if [ ${#bundles[@]} -ne 1 ]; then
      echo "expected one .app under the macOS bundle directory, found ${#bundles[@]}" >&2
      printf '  %s\n' "${bundles[@]}" >&2
      exit 1
    fi
    built="${bundles[0]}"

    # **The name is asserted rather than accepted.** `MIX_WINDOW_APP` is what every path below and
    # in `macos/build.sh` is built from; a Tauri release that started naming the bundle differently
    # would otherwise be discovered by `pkgutil` three artifacts later.
    test "$(basename "$built")" = "$MIX_WINDOW_APP" || {
      echo "the bundle is $(basename "$built") and this product expects $MIX_WINDOW_APP" >&2
      exit 1
    }
    ;;
  *)
    # `--no-bundle`: packaging is `packaging/`'s, and Tauri's own installers are not what this
    # product ships.
    (cd "$app" && npm run tauri -- build --no-bundle --target "$target")

    built="$app/src-tauri/target/$target/release/$MIX_WINDOW$(mix_exe_suffix)"
    test -f "$built" || {
      echo "the window was not built at $built" >&2
      echo "cargo names it after [package].name and tauri.conf.json sets no mainBinaryName;" >&2
      echo "if either changed, packaging/common.sh's MIX_WINDOW has to change with it" >&2
      exit 1
    }
    ;;
esac

window="$MIX_OUT/window/$(mix_window_key "$target")"
rm -rf "$window"
mkdir -p "$window"
cp -R "$built" "$window/"

# **Open what was just made**, on the rule every other script here follows.
test -e "$(mix_window_in "$window")" || {
  echo "the window was not staged at $(mix_window_in "$window")" >&2
  exit 1
}

# **And what it will need from the machine it runs on** — T105a, ADR 0028. Read here rather than at
# packaging time because this is where the binary is newest and the machine that built it is still
# the one being asked; the four Linux packaging scripts downstream all copy this same file.
#
# Linux only: the floors a macOS or a Windows build clears are neither glibc nor WebKitGTK.
if [ "$(uname -s)" = "Linux" ]; then
  bash "$MIX_ROOT/packaging/linux/window-floor.sh" "$(mix_window_in "$window")"
fi

echo "$window"
