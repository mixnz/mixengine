#!/usr/bin/env bash
# Linux: the update payload — roadmap task T88, the design's D6 — and, since T105, the headless
# archive beside it: the same directory without the window, for the machine that has no display.
#
# **A plain archive of the release's binaries, and not an installer.** None of the five installers is
# a thing an updater can apply: the `.deb`, the `.rpm` and the `.pkg` need root, and the AppImage is
# a file the user placed rather than a directory of binaries. So every OS additionally publishes one
# of these, all of them holding **one top-level `mixengine/` directory** — which is what the Windows
# portable zip already does, and what lets one `provides` shape in `latest.json` describe every
# artifact this project ships.
#
# Its own script rather than a line inside `build-deb.sh`: the three Linux artifacts are three
# independent things, and an updater's payload does not belong inside whichever of them happened to
# be edited last.

source "$(dirname "${BASH_SOURCE[0]}")/../common.sh"

version="$(mix_version)"
target="$(mix_host_target)"
arch="$(mix_arch_label "$target")"
stage_args=(--target "$target")
[ -n "${MIX_CONTAINER:-}" ] && stage_args+=(--container "$MIX_CONTAINER")
stage="$(bash "$MIX_ROOT/packaging/stage.sh" "${stage_args[@]}" | tail -1)"
dist="$MIX_OUT/dist"
mkdir -p "$dist"

name="mixengine-$version-linux-$arch.tar.gz"

root="$MIX_OUT/tar"
rm -rf "$root"
mkdir -p "$root/mixengine"

for binary in "${MIX_BINARIES[@]}"; do
  install -m 0755 "$stage/$binary" "$root/mixengine/$binary"
done

rm -f "$dist/$name"
tar -czf "$dist/$name" -C "$root" mixengine

# **Open what was just made and check the binaries are in it** — the T85 design, D11, one artifact
# further along. An empty archive is a perfectly valid archive.
#
# **Listed once into a variable, and never piped into `grep -q`.** That pipeline reads correctly and
# fails on a real release: `grep -q` exits the moment it matches, `tar` is killed by the SIGPIPE that
# follows, and `pipefail` — which `common.sh` sets — reports the pipeline as failed. So a payload
# that is perfectly good is refused for containing what was looked for. Measured on both Linux legs
# of run 33906595994.
entries="$(tar -tzf "$dist/$name")"
for binary in "${MIX_BINARIES[@]}"; do
  grep -qx "mixengine/$binary" <<<"$entries" || {
    echo "$binary is not in the update payload" >&2
    exit 1
  }
done

mix_checksum "$dist/$name"

# **The archive the CLI-only user downloads** — T105, D7. The payload above carries the window
# because it is assembled from `MIX_BINARIES`; this one carries the four and nothing else, which is
# what a server, a container image or a machine with no display wants — and it declares nothing,
# which is its point.
headless="mixengine-$version-linux-$arch-headless.tar.gz"

headless_root="$MIX_OUT/tar-headless"
rm -rf "$headless_root"
mkdir -p "$headless_root/mixengine"
for binary in $(mix_headless_binaries); do
  install -m 0755 "$stage/$binary" "$headless_root/mixengine/$binary"
done

rm -f "$dist/$headless"
tar -czf "$dist/$headless" -C "$headless_root" mixengine

# Checked for what is in it **and for what is not**: an archive that quietly grew a webview is the
# one failure this artifact exists to prevent, and counting four would not catch a fifth entry.
headless_entries="$(tar -tzf "$dist/$headless")"
for binary in $(mix_headless_binaries); do
  grep -qx "mixengine/$binary" <<<"$headless_entries" || {
    echo "$binary is not in the headless archive" >&2
    exit 1
  }
done
if grep -qx "mixengine/$MIX_WINDOW" <<<"$headless_entries"; then
  echo "the headless archive carries $MIX_WINDOW, which is the one thing it must not" >&2
  exit 1
fi

mix_checksum "$dist/$headless"

# The handbook's install page links this one, unversioned — see `mix_publish_alias` in `common.sh`.
alias_headless="$(mix_publish_alias "$dist/$headless" "mixengine-linux-$arch-headless.tar.gz")"

# T88a: the privileged helper on its own, so the `release` job can sign it and `mix elevation
# upgrade` can fetch it. Published here rather than by `build-deb.sh` for this script's own reason —
# the updater's business belongs beside the updater's payload.
helper_name="$(mix_publish_helper "$stage/mixengine-elevate" linux "$arch")"

echo "$dist/$name"
echo "$dist/$headless"
echo "$alias_headless"
echo "$helper_name"
