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
  "$MIX_ROOT/packaging/linux/$MIX_ARTIFACT.spec.in" \
  >"$build/SPECS/$MIX_ARTIFACT.spec"

rpmbuild --define "_topdir $build" --target "$arch" -bb "$build/SPECS/$MIX_ARTIFACT.spec"

name="$MIX_ARTIFACT-$version-1.$arch.rpm"
rm -f "$dist/$name"
cp "$build/RPMS/$arch/$name" "$dist/$name"

# **Open what was just made and check the binaries are in it** — the T85 design, D11.
contents="$(rpm -qlp "$dist/$name")"
for expected in \
  $MIX_INSTALL_LINUX/mix \
  $MIX_INSTALL_LINUX/mixengined \
  $MIX_INSTALL_LINUX/mixengine-shim \
  $MIX_INSTALL_LINUX/mixengine-trampoline \
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

recommends="$(rpm -qp --recommends "$dist/$name" 2>/dev/null)"
case "$recommends" in
  *appindicator*) ;;
  *)
    echo "the package's Recommends does not name AppIndicator:" >&2
    printf '%s\n' "$recommends" >&2
    exit 1
    ;;
esac

# **And the rename really is declared**, for `build-deb.sh`'s reason one package format along.
provides="$(rpm -qp --provides "$dist/$name" 2>/dev/null)"
grep -q "^$MIX_HEADLESS_ARTIFACT = " <<<"$provides" || {
  echo "the package does not provide $MIX_HEADLESS_ARTIFACT:" >&2
  printf '%s\n' "$provides" >&2
  exit 1
}
obsoletes="$(rpm -qp --obsoletes "$dist/$name" 2>/dev/null)"
grep -q "^$MIX_HEADLESS_ARTIFACT < " <<<"$obsoletes" || {
  echo "the package does not obsolete $MIX_HEADLESS_ARTIFACT:" >&2
  printf '%s\n' "$obsoletes" >&2
  exit 1
}

mix_checksum "$dist/$name"

# The handbook's install page links this one, unversioned — see `mix_publish_alias` in `common.sh`.
alias_rpm="$(mix_publish_alias "$dist/$name" "$MIX_ARTIFACT-$arch.rpm")"

echo "$dist/$name"
echo "$alias_rpm"

# **The headless package** — T182b, D5, which replaces the headless tarball: the same four
# programs and helper under the same paths, no window, and none of the window's dependencies. It
# and `mixlab` conflict with each other, since both own `/usr/bin/mix`.
headless_package="$MIX_HEADLESS_ARTIFACT-headless"
sed -e "s/@VERSION@/$version/" -e "s/@ARCH@/$arch/" -e "s%@BINDIR@%$MIX_INSTALL_LINUX%g" \
  "$MIX_ROOT/packaging/linux/$headless_package.spec.in" \
  >"$build/SPECS/$headless_package.spec"

rpmbuild --define "_topdir $build" --target "$arch" -bb "$build/SPECS/$headless_package.spec"

headless_name="$headless_package-$version-1.$arch.rpm"
rm -f "$dist/$headless_name"
cp "$build/RPMS/$arch/$headless_name" "$dist/$headless_name"

contents="$(rpm -qlp "$dist/$headless_name")"
for expected in \
  $MIX_INSTALL_LINUX/mix \
  $MIX_INSTALL_LINUX/mixengined \
  $MIX_INSTALL_LINUX/mixengine-shim \
  $MIX_INSTALL_LINUX/mixengine-trampoline \
  $MIX_INSTALL_LINUX/mixengine-elevate \
  /usr/local/libexec/mixengine/mixengine-elevate; do
  printf '%s\n' "$contents" | grep -qx "$expected" || {
    echo "$expected is not in the headless package" >&2
    exit 1
  }
done
if printf '%s\n' "$contents" | grep -q 'mixlab'; then
  echo "the headless package carries the window:" >&2
  printf '%s\n' "$contents" >&2
  exit 1
fi
if rpm -qp --requires "$dist/$headless_name" 2>/dev/null | grep -q webkit; then
  echo "the headless package requires WebKitGTK" >&2
  exit 1
fi
rpm -qp --conflicts "$dist/$headless_name" 2>/dev/null | grep -qx "$MIX_ARTIFACT" || {
  echo "the headless package does not conflict with $MIX_ARTIFACT" >&2
  exit 1
}
rpm -qp --conflicts "$dist/$name" 2>/dev/null | grep -qx "$headless_package" || {
  echo "the package does not conflict with $headless_package" >&2
  exit 1
}

mix_checksum "$dist/$headless_name"
alias_headless="$(mix_publish_alias "$dist/$headless_name" "$headless_package-$arch.rpm")"

echo "$dist/$headless_name"
echo "$alias_headless"
