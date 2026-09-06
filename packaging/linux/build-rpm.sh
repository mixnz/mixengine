#!/usr/bin/env bash
# Linux: an `.rpm`, from the same three staged binaries the `.deb` uses.
#
# No maintainer scripts here either, for `build-deb.sh`'s reason.

source "$(dirname "${BASH_SOURCE[0]}")/../common.sh"

mix_require rpmbuild rpm

# `mix_native_version`, not `mix_version`: `Version:` may not contain a hyphen, and rpmbuild names
# the file it writes after that field — so the two have to be read from the same place.
version="$(mix_native_version)"
target="$(mix_host_target)"
arch="$(mix_arch_label "$target")"
stage_args=(--target "$target")
[ -n "${MIX_CONTAINER:-}" ] && stage_args+=(--container "$MIX_CONTAINER")
stage="$(bash "$MIX_ROOT/packaging/stage.sh" "${stage_args[@]}" | tail -1)"
dist="$MIX_OUT/dist"
mkdir -p "$dist"

build="$MIX_OUT/rpmbuild"
rm -rf "$build"
mkdir -p "$build/SOURCES" "$build/SPECS" "$build/RPMS" "$build/BUILD" "$build/BUILDROOT"
cp "$stage"/* "$build/SOURCES/"

sed -e "s/@VERSION@/$version/" -e "s/@ARCH@/$arch/" "$MIX_ROOT/packaging/linux/mixengine.spec.in" \
  >"$build/SPECS/mixengine.spec"

rpmbuild --define "_topdir $build" --target "$arch" -bb "$build/SPECS/mixengine.spec"

name="mixengine-$version-1.$arch.rpm"
rm -f "$dist/$name"
cp "$build/RPMS/$arch/$name" "$dist/$name"

# **Open what was just made and check the binaries are in it** — the T85 design, D11.
contents="$(rpm -qlp "$dist/$name")"
for expected in \
  /usr/bin/mix \
  /usr/bin/mixengined \
  /usr/bin/mixengine-shim \
  /usr/local/libexec/mixengine/mixengine-elevate; do
  printf '%s\n' "$contents" | grep -qx "$expected" || {
    echo "$expected is not in the package" >&2
    exit 1
  }
done

mix_checksum "$dist/$name"

# The handbook's install page links this one, unversioned — see `mix_publish_alias` in `common.sh`.
alias_rpm="$(mix_publish_alias "$dist/$name" "mixengine-$arch.rpm")"

echo "$dist/$name"
echo "$alias_rpm"
