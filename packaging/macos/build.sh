#!/usr/bin/env bash
# macOS: one universal `.pkg`.
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

# Both slices, then one binary per name. Apple's toolchain cross-compiles the other architecture
# with no extra sysroot, which is why macOS is universal here while Windows and Linux ship the host
# architecture alone — that second one is roadmap task T85a.
rustup target add x86_64-apple-darwin aarch64-apple-darwin
intel="$(bash "$MIX_ROOT/packaging/stage.sh" --target x86_64-apple-darwin | tail -1)"
arm="$(bash "$MIX_ROOT/packaging/stage.sh" --target aarch64-apple-darwin | tail -1)"

root="$MIX_OUT/pkgroot"
rm -rf "$root"
mkdir -p "$root/usr/local/bin" "$root/Library/PrivilegedHelperTools" "$root/Applications"

lipo -create "$intel/mix" "$arm/mix" -output "$root/usr/local/bin/mix"
lipo -create "$intel/mixengined" "$arm/mixengined" -output "$root/usr/local/bin/mixengined"

# Beside `mixengined`, which is the only place `core::shims::source` looks — T85c. Universal like
# its neighbours, because a `.pkg` that is universal in three of four binaries is not universal.
lipo -create "$intel/mixengine-shim" "$arm/mixengine-shim" \
  -output "$root/usr/local/bin/mixengine-shim"

# The one file that goes somewhere only root can write, at exactly the path
# `mixengine_platform::install::helper_path()` returns — so a machine installed from this package
# finds `HelperInstall` already done and answers `AlreadyDone`.
lipo -create "$intel/mixengine-elevate" "$arm/mixengine-elevate" \
  -output "$root/Library/PrivilegedHelperTools/dev.mixengine.elevate"

# MixLab, the window — T105. **Copied and never `lipo`d**: `packaging/desktop.sh` built it with
# `--target universal-apple-darwin`, so the binary inside is already both slices, and `lipo -create`
# on a directory is not a thing. `ditto` rather than `cp -R` because this is an application bundle
# and `ditto` is what preserves one.
#
# From the Intel stage rather than from the ARM one only because a choice had to be made: both
# stages hold the same universal bundle, which is what `mix_window_key` arranges.
ditto "$(mix_window_in "$intel")" "$root/Applications/$MIX_WINDOW_APP"

# What macOS will actually launch, read out of the bundle rather than assumed — so a Tauri release
# that changes `CFBundleExecutable` is caught here and not by a user double-clicking nothing.
window_exe="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' \
  "$root/Applications/$MIX_WINDOW_APP/Contents/Info.plist")"
test -n "$window_exe" || {
  echo "$MIX_WINDOW_APP has no CFBundleExecutable" >&2
  exit 1
}

chmod 755 \
  "$root/usr/local/bin/mix" \
  "$root/usr/local/bin/mixengined" \
  "$root/usr/local/bin/mixengine-shim" \
  "$root/Library/PrivilegedHelperTools/dev.mixengine.elevate" \
  "$root/Applications/$MIX_WINDOW_APP/Contents/MacOS/$window_exe"

# **T95: a release must not admit to being a development build.** `mixengine_platform::RELEASE` is
# compiled in from `MIXENGINE_RELEASE`, which `packaging/stage.sh` exports; if that ever stops
# reaching the compiler, every artifact on this leg would default to `MixEngine-dev` and rename the
# home of everybody who upgraded. Nothing else would notice — the binaries run, the installer opens,
# and the damage appears on a user's machine.
#
# Asked of the universal binary rather than of either slice, because that is the file this package
# installs and the one a user ends up running.
printed="$("$root/usr/local/bin/mix" --version)"
case "$printed" in
  *"(development build)"*)
    echo "the staged mix says '$printed' — MIXENGINE_RELEASE did not reach the build" >&2
    exit 1
    ;;
esac

name="mixengine-$version-macos-universal.pkg"
rm -f "$dist/$name"

# `--ownership recommended`: the payload is installed as `root:wheel` whatever the account that
# built it happened to be, which is the whole reason the helper can be shipped in here at all.
pkgbuild \
  --root "$root" \
  --identifier dev.mixengine.cli \
  --version "$version" \
  --ownership recommended \
  --install-location / \
  "$dist/$name"

# **Open what was just made and check the binaries are in it** — the T85 design, D11.
files="$(pkgutil --payload-files "$dist/$name")"
for expected in \
  ./usr/local/bin/mix \
  ./usr/local/bin/mixengined \
  ./usr/local/bin/mixengine-shim \
  ./Library/PrivilegedHelperTools/dev.mixengine.elevate \
  "./Applications/$MIX_WINDOW_APP/Contents/MacOS/$window_exe"; do
  printf '%s\n' "$files" | grep -qx "$expected" || {
    echo "$expected is not in the package" >&2
    exit 1
  }
done

# And that "universal" is true rather than asserted by the file name.
for binary in mix mixengined mixengine-shim; do
  architectures="$(lipo -archs "$root/usr/local/bin/$binary")"
  for slice in x86_64 arm64; do
    printf '%s\n' "$architectures" | grep -qw "$slice" || {
      echo "$binary is missing the $slice slice: $architectures" >&2
      exit 1
    }
  done
done

# The window too. A `.pkg` that is universal in four of five binaries is not universal, and this one
# is built by a different command from the other four — `cargo tauri build --target
# universal-apple-darwin` rather than two `stage.sh` runs and a `lipo`.
architectures="$(lipo -archs "$root/Applications/$MIX_WINDOW_APP/Contents/MacOS/$window_exe")"
for slice in x86_64 arm64; do
  printf '%s\n' "$architectures" | grep -qw "$slice" || {
    echo "$MIX_WINDOW_APP is missing the $slice slice: $architectures" >&2
    exit 1
  }
done

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
# **The four, and not the window** — T105, D8. `packaging/feed.sh` builds `provides` only from
# entries directly under `mixengine/` that are not directories, and a `.app` is a directory: putting
# one in here would add forty megabytes that no reader of this feed would ever look up. Describing a
# bundle in `latest.json` is T106's, and so is putting one in this file.
payload="mixengine-$version-macos-universal.tar.gz"
rm -rf "$MIX_OUT/tar"
mkdir -p "$MIX_OUT/tar/mixengine"
for binary in $(mix_headless_binaries); do
  lipo -create "$intel/$binary" "$arm/$binary" -output "$MIX_OUT/tar/mixengine/$binary"
  chmod 755 "$MIX_OUT/tar/mixengine/$binary"
done
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

mix_checksum "$dist/$payload"

# **The archive the CLI-only user downloads** — T105, D7. The same four binaries as the payload
# above, under a name a person can recognise as the one without a window. It is byte-for-byte the
# payload's contents today and stops being so at T106, when the payload gains the bundle.
headless="mixengine-$version-macos-universal-headless.tar.gz"
rm -f "$dist/$headless"
tar -czf "$dist/$headless" -C "$MIX_OUT/tar" mixengine

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
# upgrade` can fetch it. **The `lipo`d one the `.pkg` installs**, byte for byte, and not a slice —
# `feed.sh` lists a `macos-universal` helper under both architecture rows, exactly as it lists this
# leg's payload.
helper_name="$(mix_publish_helper \
  "$root/Library/PrivilegedHelperTools/dev.mixengine.elevate" macos universal)"

# The handbook's install page links this one, unversioned — see `mix_publish_alias` in `common.sh`.
alias_pkg="$(mix_publish_alias "$dist/$name" "mixengine-macos-universal.pkg")"
alias_headless="$(mix_publish_alias "$dist/$headless" "mixengine-macos-universal-headless.tar.gz")"

echo "$dist/$name"
echo "$dist/$payload"
echo "$dist/$headless"
echo "$helper_name"
echo "$alias_pkg"
echo "$alias_headless"
