#!/usr/bin/env bash
# Windows: a per-user NSIS installer with the window and one without it, and the zip the per-user
# swap updates from (T182b, D5): the update payload, no longer offered as a way to install.

source "$(dirname "${BASH_SOURCE[0]}")/../common.sh"

# `unzip` comes with Git Bash, which is the shell this runs in; `7z` is on the runner image and is
# the only thing that can list the inside of an NSIS installer.
mix_require unzip 7z

# **Resolved before the build and not after it**, which is what the first CI run of this script paid
# to learn: it compiled the workspace for seven minutes and then stopped at "missing tools: makensis".
# Every other tool is checked on the line above for the same reason, and this one is not on `PATH`.
makensis="${MAKENSIS:-/c/Program Files (x86)/NSIS/makensis.exe}"
if [ ! -x "$makensis" ]; then
  makensis="makensis"
  mix_require makensis
fi

version="$(mix_version)"
target="$(mix_host_target)"
arch="$(mix_arch_label "$target")"
stage="$(bash "$MIX_ROOT/packaging/stage.sh" --target "$target" | tail -1)"
dist="$MIX_OUT/dist"
mkdir -p "$dist"

zip_name="$MIX_ARTIFACT-$version-windows-$arch.zip"
setup_name="$MIX_ARTIFACT-$version-windows-$arch-setup.exe"
headless_name="$MIX_HEADLESS_ARTIFACT-$version-windows-$arch-headless-setup.exe"

# The zip holds one directory, so unzipping it into Downloads does not scatter five binaries there.
# Through `zip.ps1` rather than `Compress-Archive`, which spells the separator inside the archive
# with a backslash — see that file for what it cost. Still PowerShell and still nothing installed.
rm -rf "$MIX_OUT/zip"
mkdir -p "$MIX_OUT/zip/mixengine"
cp "$stage"/*.exe "$MIX_OUT/zip/mixengine/"
rm -f "$dist/$zip_name"
powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass \
  -File "$(cygpath -w "$MIX_ROOT/packaging/windows/zip.ps1")" \
  -Source "$(cygpath -w "$MIX_OUT/zip/mixengine")" \
  -Destination "$(cygpath -w "$dist/$zip_name")"

# **The setup, twice: with the window and without it** — T182b, D5. The headless one is what the
# CLI-only user runs instead of the headless zip this used to publish: the same per-user install,
# the four binaries, and no webview.
for flavour in window headless; do
  case "$flavour" in
    window) out="$dist/$setup_name" define="" ;;
    headless) out="$dist/$headless_name" define="-DHEADLESS" ;;
  esac

  "$makensis" -NOCD \
    $define \
    "-DVERSION=$version" \
    "-DSTAGE=$(cygpath -w "$stage")" \
    "-DOUTFILE=$(cygpath -w "$out")" \
    "-DINSTALL_SUBDIR=$MIX_INSTALL_WINDOWS" \
    "-DICON=$(cygpath -w "$MIX_ROOT/apps/desktop/src-tauri/icons/icon.ico")" \
    "$(cygpath -w "$MIX_ROOT/packaging/windows/mixengine.nsi")"
done

# **Open what was just made and check the binaries are in it** — the T85 design, D11. An empty
# archive is a perfectly valid archive, and this is the only step that would notice.
#
# `MIX_BINARIES` rather than a list written out here: a check that asserts four of the five names
# is a check that would not have caught T85c either.
#
# **Listed once into a variable and never piped into `grep -q`.** That pipeline kills the lister
# with a SIGPIPE the moment the match is found and — under `pipefail`, which `common.sh` sets —
# reports a perfectly good artifact as broken for holding exactly what was looked for. Measured on
# both Linux legs of run 33906595994.
#
# **The zip is checked by whole entry name and not by substring** — `unzip -Z1`, matched with
# `grep -qx`. A listing searched for `mix.exe` anywhere says yes to `mixengine\mix.exe`, which is
# what `Compress-Archive` used to write and what no reader of this archive can find; the path a
# reader asks for is the thing worth asserting.
zip_entries="$(unzip -Z1 "$dist/$zip_name")"
setup_entries="$(7z l "$dist/$setup_name")"
headless_entries="$(7z l "$dist/$headless_name")"
for binary in "${MIX_BINARIES[@]}"; do
  grep -qx "mixengine/$binary.exe" <<<"$zip_entries" || {
    echo "the zip has no mixengine/$binary.exe" >&2
    exit 1
  }
  grep -qF "$binary.exe" <<<"$setup_entries" || {
    echo "$binary.exe is not in the installer" >&2
    exit 1
  }
done

# **The headless setup is checked for what is in it and for what is not.** A setup that quietly grew
# a webview is the one failure this artifact exists to prevent, and counting four would not catch a
# fifth entry — only asking about the window by name does. `7z l` lists an NSIS installer's files as
# a table, so the name is matched as a word at the end of a line.
for binary in $(mix_headless_binaries); do
  grep -qE "(^| )$binary\.exe$" <<<"$headless_entries" || {
    echo "the headless setup has no $binary.exe" >&2
    exit 1
  }
done
if grep -qE "(^| )$MIX_WINDOW\.exe$" <<<"$headless_entries"; then
  echo "the headless setup carries $MIX_WINDOW.exe, which is the one thing it must not" >&2
  exit 1
fi

# **T95: a release must not admit to being a development build.** `mixengine_platform::RELEASE` is
# compiled in from `MIXENGINE_RELEASE`, which `packaging/stage.sh` exports; if that ever stops
# reaching the compiler, every artifact on this leg would default to `MixEngine-dev` and rename the
# home of everybody who upgraded. Nothing else would notice — the binaries run, the installer opens,
# and the damage appears on a user's machine.
#
# The staged binary rather than one out of an artifact: both Windows legs build for the architecture
# they run on, so it executes here, and it is the same file both artifacts were made from.
printed="$("$stage/mix.exe" --version)"
case "$printed" in
  *"(development build)"*)
    echo "the staged mix says '$printed' — MIXENGINE_RELEASE did not reach the build" >&2
    exit 1
    ;;
esac

mix_checksum "$dist/$zip_name"
mix_checksum "$dist/$setup_name"
mix_checksum "$dist/$headless_name"

# T88a: the privileged helper on its own, so the `release` job can sign it and a daemon replacing
# an older helper can fetch it (T182b, D2). It is inside the setups as well; what this asset adds is
# a file that can carry a detached signature, named by the helper's own version.
helper_name="$(mix_publish_helper "$stage/mixengine-elevate.exe" windows "$arch")"

# The handbook's install page links these, unversioned — see `mix_publish_alias` in `common.sh`.
# The zip has none: it is the update payload now, and nothing points a person at it (T182b, D5).
alias_setup="$(mix_publish_alias "$dist/$setup_name" "$MIX_ARTIFACT-windows-$arch-setup.exe")"
alias_headless="$(mix_publish_alias "$dist/$headless_name" \
  "$MIX_HEADLESS_ARTIFACT-windows-$arch-headless-setup.exe")"

echo "$dist/$zip_name"
echo "$dist/$setup_name"
echo "$dist/$headless_name"
echo "$helper_name"
echo "$alias_setup"
echo "$alias_headless"
