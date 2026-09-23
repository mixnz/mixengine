#!/usr/bin/env bash
# macOS: one `.pkg`, universal on a tag and on `master` (T171).
#
# **A `.pkg` and not the `.dmg` the roadmap first asked for** — the T85 design, D8. A disk image is a
# carrier for something you drag out of it, and the thing that used to be dragged was an application
# bundle ADR 0011 deleted; what was left to ship here was four command-line binaries. A `.pkg` also
# runs as root, which is what lets it place the privileged helper at install time instead of leaving
# it to the first elevation prompt.
#
# **An application bundle is back, and it changes none of that** — T105. ADR 0027 brought a window
# into this repository and D8 puts it in every installer, so this package now places `MixLab.app` in
# `/Applications` beside the four. It is still not a thing anybody drags: `installer(8)` and a
# double-clicked `.pkg` both place it, and the reasons for the format are the ones above.

source "$(dirname "${BASH_SOURCE[0]}")/../common.sh"

# `ditto` is what copies an application bundle on this system; `PlistBuddy` is how the bundle is
# asked what it will launch. Both are in the box on every macOS, and named here on this file's own
# rule that a missing tool says which.
mix_require lipo pkgbuild pkgutil ditto

version="$(mix_version)"
dist="$MIX_OUT/dist"
mkdir -p "$dist"

# Every slice, then one binary per name. Apple's toolchain cross-compiles the other architecture
# with no extra sysroot, which is why macOS is universal here while Windows and Linux ship the host
# architecture alone — that second one is roadmap task T85a.
#
# **Which slices is `mix_macos_slices`'s to say** — T171, E2: both on a tag, on `master` and on a
# developer's machine, `aarch64` alone on any other branch in CI. Read into a variable first, because
# a failing substitution in a `for` list is an empty loop rather than an error under `set -e`.
slices="$(mix_macos_slices)"
label="$(mix_macos_label)"

# A tag ships universal and nothing else. A one-slice build names its files `macos-arm64`, which
# `feed.sh` would not know what to do with; this is the line that keeps one from reaching `release`.
if [[ "${GITHUB_REF:-}" == refs/tags/* ]] && [ "$label" != "universal" ]; then
  echo "a tag builds universal, and MIX_MACOS_SLICES is '$MIX_MACOS_SLICES'" >&2
  exit 1
fi

stages=()
for slice in $slices; do
  # Not under `MIX_PREBUILT`: nothing is compiled then, and CI's `build` job has no toolchain to add
  # a target to.
  if [ "${MIX_PREBUILT:-0}" != "1" ]; then
    rustup target add "$slice-apple-darwin"
  fi
  stages+=("$(bash "$MIX_ROOT/packaging/stage.sh" --target "$slice-apple-darwin" | tail -1)")
done

# One file out of every stage: `lipo` when there are two slices, a copy when there is one, so the
# rest of this script says "merge" once and does not care which. $1 the name in a stage, $2 the
# output.
merge() {
  local inputs=() stage
  for stage in "${stages[@]}"; do
    inputs+=("$stage/$1")
  done
  if [ ${#inputs[@]} -eq 1 ]; then
    cp "${inputs[0]}" "$2"
  else
    lipo -create "${inputs[@]}" -output "$2"
  fi
}

root="$MIX_OUT/pkgroot"
rm -rf "$root"
mkdir -p "$root$MIX_INSTALL_MACOS" "$root/Library/PrivilegedHelperTools" "$root/Applications"

merge mix "$root$MIX_INSTALL_MACOS/mix"
merge mixengined "$root$MIX_INSTALL_MACOS/mixengined"

# Beside `mixengined`, which is the only place `core::shims::source` looks — T85c. Made of the same
# slices as its neighbours, because a `.pkg` that is universal in three of four binaries is not
# universal.
merge mixengine-shim "$root$MIX_INSTALL_MACOS/mixengine-shim"

# The one file that goes somewhere only root can write, at exactly the path
# `mixengine_platform::install::helper_path()` returns — so a machine installed from this package
# finds `HelperInstall` already done and answers `AlreadyDone`.
merge mixengine-elevate "$root/Library/PrivilegedHelperTools/dev.mixengine.elevate"

# MixLab, the window — T105. **Copied and never `lipo`d**: `packaging/desktop.sh` built it for the
# whole slice set at once (`--target universal-apple-darwin` for two), so the binary inside already
# holds every slice, and `lipo -create` on a directory is not a thing. `ditto` rather than `cp -R`
# because this is an application bundle and `ditto` is what preserves one.
#
# From the first stage only because a choice had to be made: every stage holds the same bundle,
# which is what `mix_window_key` arranges.
ditto "$(mix_window_in "${stages[0]}")" "$root/Applications/$MIX_WINDOW_APP"

# What macOS will actually launch, read out of the bundle rather than assumed — so a Tauri release
# that changes `CFBundleExecutable` is caught here and not by a user double-clicking nothing.
window_exe="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' \
  "$root/Applications/$MIX_WINDOW_APP/Contents/Info.plist")"
test -n "$window_exe" || {
  echo "$MIX_WINDOW_APP has no CFBundleExecutable" >&2
  exit 1
}

# **The copy MixEngine installs *from*, inside the bundle** — roadmap task T88d. `mix uninstall`
# removes `/Library/PrivilegedHelperTools/dev.mixengine.elevate`; until this copy existed there was
# nothing left on the machine for `HelperInstall {}` to copy, so reinstalling this package was the
# only way back to a Mac that could elevate anything at all.
#
# Inside `MixLab.app` rather than beside `mixengined`, because a source has to survive an uninstall
# and **not** survive removing the application — one of the app's own files is the only thing here
# that does both. `/usr/local/bin` is refused for the reason the helper is not installed there
# either: Homebrew on an Intel Mac owns that directory.
mkdir -p "$root/Applications/$MIX_WINDOW_APP/Contents/Resources"
cp "$root/Library/PrivilegedHelperTools/dev.mixengine.elevate" \
  "$root/Applications/$MIX_WINDOW_APP/Contents/Resources/mixengine-elevate"

chmod 755 \
  "$root$MIX_INSTALL_MACOS/mix" \
  "$root$MIX_INSTALL_MACOS/mixengined" \
  "$root$MIX_INSTALL_MACOS/mixengine-shim" \
  "$root/Library/PrivilegedHelperTools/dev.mixengine.elevate" \
  "$root/Applications/$MIX_WINDOW_APP/Contents/Resources/mixengine-elevate" \
  "$root/Applications/$MIX_WINDOW_APP/Contents/MacOS/$window_exe"

# **T95: a release must not admit to being a development build.** `mixengine_platform::RELEASE` is
# compiled in from `MIXENGINE_RELEASE`, which `packaging/stage.sh` exports; if that ever stops
# reaching the compiler, every artifact on this leg would default to `MixEngine-dev` and rename the
# home of everybody who upgraded. Nothing else would notice — the binaries run, the installer opens,
# and the damage appears on a user's machine.
#
# Asked of the merged binary rather than of any one slice, because that is the file this package
# installs and the one a user ends up running.
printed="$("$root$MIX_INSTALL_MACOS/mix" --version)"
case "$printed" in
  *"(development build)"*)
    echo "the staged mix says '$printed' — MIXENGINE_RELEASE did not reach the build" >&2
    exit 1
    ;;
esac

name="$MIX_ARTIFACT-$version-macos-$label.pkg"
rm -f "$dist/$name"

# **The component list, with relocation turned off — and that is not a nicety.**
#
# `pkgbuild` turns any `.app` it finds under `--root` into a *component* (it says so:
# "Adding component at Applications/MixLab.app") and makes it **relocatable** by default. A
# relocatable component is not installed at the path the package names: at install time the
# installer asks Launch Services where a bundle with this identifier already lives and writes it
# *there* instead. Measured on run 34274920375 — `installer(8)` reported success, every other path
# was written, and `/Applications/MixLab.app` did not exist, because Launch Services had indexed the
# copy `packaging/desktop.sh` had just built inside the work tree. On a user's machine the same rule
# would quietly install MixLab wherever an older one had been dragged.
#
# `BundleIsVersionChecked` goes with it. Left on, a machine that already has this version keeps the
# copy it has and the package writes nothing — which is fine when the bytes are identical and wrong
# the moment they are not. The other four paths are plain files and are always written; the window
# is now the same.
components="$MIX_OUT/components.plist"
rm -f "$components"
pkgbuild --analyze --root "$root" "$components"

# Exactly one bundle, so the index below is a fact rather than a guess. A second `.app` appearing
# here is a packaging change that has to decide this question again, and it should not do so by
# silently keeping the default for the one this loop did not reach.
if /usr/libexec/PlistBuddy -c 'Print :1' "$components" >/dev/null 2>&1; then
  echo "the package root holds more than one bundle; this script assumes exactly one" >&2
  /usr/libexec/PlistBuddy -c 'Print :' "$components" >&2
  exit 1
fi

/usr/libexec/PlistBuddy -c 'Set :0:BundleIsRelocatable false' "$components"
/usr/libexec/PlistBuddy -c 'Set :0:BundleIsVersionChecked false' "$components"

# Read back, because the two lines above are the whole of what stops the failure described there and
# `PlistBuddy` reports a key it did not find on stdout rather than by failing.
for key in BundleIsRelocatable BundleIsVersionChecked; do
  value="$(/usr/libexec/PlistBuddy -c "Print :0:$key" "$components")"
  test "$value" = "false" || {
    echo "$key is '$value' in the component list, and this package needs it false" >&2
    exit 1
  }
done

# `--ownership recommended`: the payload is installed as `root:wheel` whatever the account that
# built it happened to be, which is the whole reason the helper can be shipped in here at all.
pkgbuild \
  --root "$root" \
  --component-plist "$components" \
  --identifier dev.mixengine.cli \
  --version "$version" \
  --ownership recommended \
  --install-location / \
  "$dist/$name"

# **Open what was just made and check the binaries are in it** — the T85 design, D11.
files="$(pkgutil --payload-files "$dist/$name")"
for expected in \
  .$MIX_INSTALL_MACOS/mix \
  .$MIX_INSTALL_MACOS/mixengined \
  .$MIX_INSTALL_MACOS/mixengine-shim \
  ./Library/PrivilegedHelperTools/dev.mixengine.elevate \
  "./Applications/$MIX_WINDOW_APP/Contents/Resources/mixengine-elevate" \
  "./Applications/$MIX_WINDOW_APP/Contents/MacOS/$window_exe"; do
  printf '%s\n' "$files" | grep -qx "$expected" || {
    echo "$expected is not in the package" >&2
    exit 1
  }
done

# And that the slices are true rather than asserted by the file name — **exactly** the slices this
# build made, T171: a universal package missing one is the failure this always caught, and a
# one-slice package that somehow held two would be a `macos-arm64` file that is not what it says.
# `lipo` spells `aarch64` as `arm64`.
#
# The `case` is in a function and not written inside the `$( … )`: macOS's own bash is 3.2, which
# reads a `pattern)` inside a command substitution as the end of it — measured on run 35463527479.
lipo_name() {
  case "$1" in
    aarch64) echo arm64 ;;
    *) echo "$1" ;;
  esac
}
expected_archs="$(for slice in $slices; do lipo_name "$slice"; done | sort | tr '\n' ' ')"
archs_of() {
  lipo -archs "$1" | tr ' ' '\n' | sed '/^$/d' | sort | tr '\n' ' '
}
for binary in mix mixengined mixengine-shim; do
  architectures="$(archs_of "$root$MIX_INSTALL_MACOS/$binary")"
  test "$architectures" = "$expected_archs" || {
    echo "$binary holds the slices '$architectures', and this build made '$expected_archs'" >&2
    exit 1
  }
done

# The window too. A `.pkg` that is universal in four of five binaries is not universal, and this one
# is built by a different command from the other four — `cargo tauri build --target` the whole slice
# set, rather than one `stage.sh` run per slice and a `lipo`.
architectures="$(archs_of "$root/Applications/$MIX_WINDOW_APP/Contents/MacOS/$window_exe")"
test "$architectures" = "$expected_archs" || {
  echo "$MIX_WINDOW_APP holds the slices '$architectures', and this build made '$expected_archs'" >&2
  exit 1
}

mix_checksum "$dist/$name"

# **The update payload** — roadmap task T88, the design's D6. None of the five installers is a thing
# an updater can apply: three need root, this one needs a Finder dialog on macOS 15, and an AppImage
# is a file the user placed rather than a directory of binaries. So every OS additionally publishes a
# plain archive of the release's binaries, all of them holding **one top-level `mixengine/`
# directory** — which is what the Windows portable zip already does and what lets one `provides`
# shape in `latest.json` describe six artifacts.
#
# Universal, like the `.pkg` above, so `packaging/feed.sh` lists it under both architectures.
#
# **And the window, since T106.** `packaging/feed.sh` now emits one `provides` row for
# `mixengine/$MIX_WINDOW_APP` and `updates::apply::swap` replaces what it names as a tree, so this is
# where a `mix self-update` on macOS gets its window from. `ditto` and not `cp -R`: this is an
# application bundle and `ditto` is what preserves one on this system.
#
# **Two roots and not one.** The headless archive below used to be built from this same directory,
# which was correct while both held the same four files and is a bug the moment one of them gains a
# fifth — a machine with no display would download a webview it cannot use.
payload="$MIX_ARTIFACT-$version-macos-$label.tar.gz"
rm -rf "$MIX_OUT/tar" "$MIX_OUT/tar-headless"
mkdir -p "$MIX_OUT/tar/mixengine" "$MIX_OUT/tar-headless/mixengine"
for binary in $(mix_headless_binaries); do
  merge "$binary" "$MIX_OUT/tar/mixengine/$binary"
  chmod 755 "$MIX_OUT/tar/mixengine/$binary"
  cp "$MIX_OUT/tar/mixengine/$binary" "$MIX_OUT/tar-headless/mixengine/$binary"
done
ditto "$root/Applications/$MIX_WINDOW_APP" "$MIX_OUT/tar/mixengine/$MIX_WINDOW_APP"
rm -f "$dist/$payload"
tar -czf "$dist/$payload" -C "$MIX_OUT/tar" mixengine

# **Open what was just made**, as every other artifact here is opened: an empty archive is a
# perfectly valid archive, and this is the only step that would notice.
#
# Listed once into a variable rather than piped into `grep -q`, which would kill `tar` with a SIGPIPE
# the moment the match was found and — under `pipefail` — report the payload as broken for holding
# exactly what was looked for. See the note in `packaging/linux/build-tarball.sh`.
entries="$(tar -tzf "$dist/$payload")"
for binary in $(mix_headless_binaries); do
  grep -qx "mixengine/$binary" <<<"$entries" || {
    echo "$binary is not in the update payload" >&2
    exit 1
  }
done

# T106. The window is what makes this payload able to replace a window, and a `ditto` that copied
# nothing is a silent four-binary archive under a five-binary name. Asked for the executable inside
# the bundle rather than for the bundle's own entry: a directory entry proves a directory was
# created, and this proves something is in it.
grep -qx "mixengine/$MIX_WINDOW_APP/Contents/MacOS/$window_exe" <<<"$entries" || {
  echo "$MIX_WINDOW_APP is not in the update payload" >&2
  exit 1
}

mix_checksum "$dist/$payload"

# **The archive the CLI-only user downloads** — T105, D7. The same four binaries as the payload
# above, under a name a person can recognise as the one without a window. Since T106 it is built from
# a root of its own: the payload carries `$MIX_WINDOW_APP` and this one must not, and one shared
# directory is how it would.
headless="$MIX_HEADLESS_ARTIFACT-$version-macos-$label-headless.tar.gz"
rm -f "$dist/$headless"
tar -czf "$dist/$headless" -C "$MIX_OUT/tar-headless" mixengine

# Checked for what is in it **and for what is not**: an archive that quietly grew a webview is the
# one failure this artifact exists to prevent, and counting four would not catch a fifth entry.
headless_entries="$(tar -tzf "$dist/$headless")"
for binary in $(mix_headless_binaries); do
  grep -qx "mixengine/$binary" <<<"$headless_entries" || {
    echo "$binary is not in the headless archive" >&2
    exit 1
  }
done
if grep -q "mixengine/$MIX_WINDOW_APP" <<<"$headless_entries"; then
  echo "the headless archive carries $MIX_WINDOW_APP, which is the one thing it must not" >&2
  exit 1
fi

mix_checksum "$dist/$headless"

# T88a: the privileged helper on its own, so the `release` job can sign it and `mix elevation
# upgrade` can fetch it. **The merged one the `.pkg` installs**, byte for byte, and not a slice —
# `feed.sh` lists a `macos-universal` helper under both architecture rows, exactly as it lists this
# leg's payload, and a tag is always universal.
helper_name="$(mix_publish_helper \
  "$root/Library/PrivilegedHelperTools/dev.mixengine.elevate" macos "$label")"

# The handbook's install page links this one, unversioned — see `mix_publish_alias` in `common.sh`.
alias_pkg="$(mix_publish_alias "$dist/$name" "$MIX_ARTIFACT-macos-$label.pkg")"
alias_headless="$(mix_publish_alias "$dist/$headless" \
  "$MIX_HEADLESS_ARTIFACT-macos-$label-headless.tar.gz")"

echo "$dist/$name"
echo "$dist/$payload"
echo "$dist/$headless"
echo "$helper_name"
echo "$alias_pkg"
echo "$alias_headless"
