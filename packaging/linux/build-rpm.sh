#!/usr/bin/env bash
# Linux: an `.rpm`, from the same staged binaries the `.deb` uses.
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

# The three files the spec installs that are not binaries — T105. `%{_sourcedir}` is the only
# directory an `-bb` build reads from, and the line above brings the five executables and nothing
# else. Renamed on the way in because rpm's `%{_sourcedir}` is flat and `32x32.png` says nothing
# about which application it belongs to.
cp "$MIX_ROOT/packaging/linux/mixlab.desktop" "$build/SOURCES/mixlab.desktop"
cp "$MIX_ROOT/apps/desktop/src-tauri/icons/32x32.png" "$build/SOURCES/mixlab-32.png"
cp "$MIX_ROOT/apps/desktop/src-tauri/icons/128x128.png" "$build/SOURCES/mixlab-128.png"

# `@BINDIR@` is `packaging/common.sh`'s `MIX_INSTALL_LINUX`, which
# `mixengine_platform::install::program_dirs` reads too — T107. A `%` delimiter for that one, since
# the value is a path.
sed -e "s/@VERSION@/$version/" -e "s/@ARCH@/$arch/" -e "s%@BINDIR@%$MIX_INSTALL_LINUX%g" \
  "$MIX_ROOT/packaging/linux/mixengine.spec.in" \
  >"$build/SPECS/mixengine.spec"

rpmbuild --define "_topdir $build" --target "$arch" -bb "$build/SPECS/mixengine.spec"

name="mixengine-$version-1.$arch.rpm"
rm -f "$dist/$name"
cp "$build/RPMS/$arch/$name" "$dist/$name"

# **Open what was just made and check the binaries are in it** — the T85 design, D11.
contents="$(rpm -qlp "$dist/$name")"
for expected in \
  $MIX_INSTALL_LINUX/mix \
  $MIX_INSTALL_LINUX/mixengined \
  $MIX_INSTALL_LINUX/mixengine-shim \
  $MIX_INSTALL_LINUX/mixlab \
  /usr/local/libexec/mixengine/mixengine-elevate \
  /usr/share/applications/mixlab.desktop \
  /usr/share/icons/hicolor/32x32/apps/mixlab.png \
  /usr/share/icons/hicolor/128x128/apps/mixlab.png; do
  printf '%s\n' "$contents" | grep -qx "$expected" || {
    echo "$expected is not in the package" >&2
    exit 1
  }
done

# **And the dependency really is declared**, for `build-deb.sh`'s reason one package format along.
requires="$(rpm -qp --requires "$dist/$name" 2>/dev/null)"
case "$requires" in
  *webkit2gtk4.1*) ;;
  *)
    echo "the package's Requires does not name WebKitGTK 4.1:" >&2
    printf '%s\n' "$requires" >&2
    exit 1
    ;;
esac

mix_checksum "$dist/$name"

# The handbook's install page links this one, unversioned — see `mix_publish_alias` in `common.sh`.
alias_rpm="$(mix_publish_alias "$dist/$name" "mixengine-$arch.rpm")"

echo "$dist/$name"
echo "$alias_rpm"
