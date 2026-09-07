#!/usr/bin/env bash
# Linux: an AppImage that installs nothing.
#
# See `AppRun` beside this for the one thing it does before running `mix`, and why.

source "$(dirname "${BASH_SOURCE[0]}")/../common.sh"

# `desktop-file-validate` is `desktop-file-utils`, and appimagetool refuses to start without it —
# measured, not assumed: it exits with "desktop-file-validate command is missing" before it looks at
# the AppDir at all. Named here so a machine without it says which package to install rather than
# leaving that to a tool this script downloaded.
mix_require curl desktop-file-validate

version="$(mix_version)"
target="$(mix_host_target)"
arch="$(mix_arch_label "$target")"
stage_args=(--target "$target")
[ -n "${MIX_CONTAINER:-}" ] && stage_args+=(--container "$MIX_CONTAINER")
stage="$(bash "$MIX_ROOT/packaging/stage.sh" "${stage_args[@]}" | tail -1)"
dist="$MIX_OUT/dist"
mkdir -p "$dist"

here="$MIX_ROOT/packaging/linux"
appdir="$MIX_OUT/AppDir"
rm -rf "$appdir"
mkdir -p "$appdir/usr/bin"

for binary in "${MIX_BINARIES[@]}"; do
  install -m 0755 "$stage/$binary" "$appdir/usr/bin/$binary"
done

install -m 0755 "$here/AppRun" "$appdir/AppRun"
install -m 0644 "$here/mixengine.desktop" "$appdir/mixengine.desktop"

# A 16x16 placeholder, because appimagetool refuses an AppDir with no icon and this product has no
# artwork yet. Committed rather than generated, and named here rather than smuggled: replacing it is
# a design task and not a packaging one.
install -m 0644 "$here/mixengine.png" "$appdir/mixengine.png"

printf '%s\n' "$version" >"$appdir/VERSION"

# Pinned to a release rather than to `continuous`, so a tool that changes its output changes it when
# this line changes and not on somebody else's Tuesday.
#
# `-$arch`, not a bare cache name: a developer machine that has built one architecture must not hand
# the other architecture's `appimagetool` binary to a leg that cannot execute it — T85a.
tool="$MIX_OUT/appimagetool-$arch"
if [ ! -x "$tool" ]; then
  curl --fail --silent --show-error --location --retry 3 --output "$tool" \
    "https://github.com/AppImage/appimagetool/releases/download/1.9.0/appimagetool-$arch.AppImage"
  chmod 755 "$tool"
fi

# **The runtime the AppImage boots with, fetched here rather than left to the tool.** Given nothing,
# appimagetool downloads it itself at every run — from type2-runtime's `continuous` build, with no
# retry, so a GitHub 504 on that one request is a failed release leg (run 34128004289, the aarch64
# leg). Fetching it here gets the same pin and the same `--retry` as the tool above, and the same
# per-architecture cache: the runtime is the one part of an AppImage that runs on the *user's*
# machine, so handing an x86_64 leg an aarch64 runtime would build an image that cannot start.
runtime="$MIX_OUT/appimage-runtime-$arch"
if [ ! -s "$runtime" ]; then
  curl --fail --silent --show-error --location --retry 3 --output "$runtime" \
    "https://github.com/AppImage/type2-runtime/releases/download/20251108/runtime-$arch"
fi

name="mixengine-$version-linux-$arch.AppImage"
rm -f "$dist/$name"

# `APPIMAGE_EXTRACT_AND_RUN=1`: the runner has no FUSE, and an AppImage that cannot mount itself
# cannot run the tool inside it. The environment variable rather than the `--appimage-extract-and-run`
# argument, because every type-2 runtime honours the variable and only newer ones parse the flag —
# and a flag the runtime does not recognise is one it passes through to the program inside.
ARCH="$arch" APPIMAGE_EXTRACT_AND_RUN=1 "$tool" --runtime-file "$runtime" "$appdir" "$dist/$name"
chmod 755 "$dist/$name"

# **Run what was just made rather than reading its table of contents** — the T85 design, D11, and
# the one artifact where that is possible. `mix --version` is the cheapest end-to-end proof that the
# AppRun, the extraction and the binary all work; the printed version is what says the binary inside
# is this build.
printed="$(APPIMAGE_EXTRACT_AND_RUN=1 "$dist/$name" --version)"
case "$printed" in
  *"$version"*) ;;
  *)
    echo "the AppImage printed '$printed', which does not name version $version" >&2
    exit 1
    ;;
esac

# **T95: a release must not admit to being a development build.** `mixengine_platform::RELEASE` is
# compiled in from `MIXENGINE_RELEASE`, which `packaging/stage.sh` exports; if that ever stops
# reaching the compiler, every artifact on this leg would default to `MixEngine-dev` and rename the
# home of everybody who upgraded. Nothing else would notice — the binaries run, the packages install,
# and the damage appears on a user's machine.
#
# **One check for all four Linux artifacts.** The `.deb`, the `.rpm` and the update tarball are
# copied from the same `stage.sh` output this AppImage was built from, so a leg that gets here with a
# clean answer has four clean artifacts. Reusing `$printed` rather than running the binary again,
# because extracting an AppImage to ask it twice is a second answer to a question already answered.
case "$printed" in
  *"(development build)"*)
    echo "the AppImage says '$printed' — MIXENGINE_RELEASE did not reach the build" >&2
    exit 1
    ;;
esac

# And the helper really is in there, since nothing above would have run it.
test -x "$appdir/usr/bin/mixengine-elevate" || {
  echo "mixengine-elevate is not in the AppDir" >&2
  exit 1
}

mix_checksum "$dist/$name"

# The handbook's install page links this one, unversioned — see `mix_publish_alias` in `common.sh`.
alias_appimage="$(mix_publish_alias "$dist/$name" "mixengine-linux-$arch.AppImage")"

echo "$dist/$name"
echo "$alias_appimage"
