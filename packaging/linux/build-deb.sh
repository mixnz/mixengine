#!/usr/bin/env bash
# Linux: a `.deb` with no maintainer scripts in it.
#
# **Nothing runs at install time, deliberately** — the T85 design, D10. Everything MixEngine does to
# a machine it does through `mixengine-elevate`, on first run, with the user watching; a package that
# only ships files has nothing to go wrong at install and nothing to undo at removal.

source "$(dirname "${BASH_SOURCE[0]}")/../common.sh"

mix_require dpkg-deb

# `mix_native_version`, not `mix_version`: dpkg accepts a hyphen and then misreads it, which is the
# quieter half of what that function is for.
version="$(mix_native_version)"
target="$(mix_host_target)"
arch="$(mix_arch_label "$target")"
deb_arch="amd64"
[ "$arch" = "aarch64" ] && deb_arch="arm64"
stage_args=(--target "$target")
[ -n "${MIX_CONTAINER:-}" ] && stage_args+=(--container "$MIX_CONTAINER")
stage="$(bash "$MIX_ROOT/packaging/stage.sh" "${stage_args[@]}" | tail -1)"
dist="$MIX_OUT/dist"
mkdir -p "$dist"

root="$MIX_OUT/debroot"
rm -rf "$root"
mkdir -p "$root/DEBIAN" "$root$MIX_INSTALL_LINUX" "$root/usr/local/libexec/mixengine" \
  "$root/usr/share/applications" \
  "$root/usr/share/icons/hicolor/32x32/apps" \
  "$root/usr/share/icons/hicolor/128x128/apps"

install -m 0755 "$stage/mix" "$root$MIX_INSTALL_LINUX/mix"
install -m 0755 "$stage/mixengined" "$root$MIX_INSTALL_LINUX/mixengined"

# Beside `mixengined`, which is the only place `core::shims::source` looks — T85c. `/usr/bin` and
# not the helper's `/usr/local/libexec/mixengine/`: the daemon does not look there, and this file is
# read by the daemon rather than run as root.
#
# It is therefore a name on the user's PATH they can type. `shims::dispatch` answers `None` for it,
# so it exits 127 saying what it is and listing what it does answer to.
install -m 0755 "$stage/mixengine-shim" "$root$MIX_INSTALL_LINUX/mixengine-shim"

# **`/usr/local` from a package is against Debian policy and is on purpose** — the T85 design, D3.
# One lookup path per system, whatever put the file there: a daemon that had to look in two places
# depending on how MixEngine arrived would have two answers to the question of which file it runs as
# root. This is the path `mixengine_platform::install::helper_path()` returns, so a machine installed
# from this package finds `HelperInstall` already done.
install -m 0755 "$stage/mixengine-elevate" \
  "$root/usr/local/libexec/mixengine/mixengine-elevate"

# MixLab, the window — T105. `/usr/bin` beside the CLI, under the one name every artifact of this
# release spells it with.
install -m 0755 "$stage/$MIX_WINDOW" "$root$MIX_INSTALL_LINUX/$MIX_WINDOW"

# The menu entry and its icon. **No maintainer script updates any cache**, which is this package's
# oldest rule (see the header): a menu reads `/usr/share/applications` directly and works at once,
# and `xdg-open mixdb://…` reaches MixLab the next time anything on the machine runs
# `update-desktop-database` — which every desktop environment's own packages do routinely. Buying
# the rest of that would cost the invariant that nothing runs at install time.
install -m 0644 "$MIX_ROOT/packaging/linux/mixlab.desktop" \
  "$root/usr/share/applications/mixlab.desktop"

# The window's own icons, already committed for the Tauri bundle. `packaging/linux/mixengine.png` is
# a 16x16 placeholder that exists because appimagetool refuses an AppDir without one, and is
# deliberately not reused here.
install -m 0644 "$MIX_ROOT/apps/desktop/src-tauri/icons/32x32.png" \
  "$root/usr/share/icons/hicolor/32x32/apps/mixlab.png"
install -m 0644 "$MIX_ROOT/apps/desktop/src-tauri/icons/128x128.png" \
  "$root/usr/share/icons/hicolor/128x128/apps/mixlab.png"

# **`Depends:` exists because of the window** — T105. WebKitGTK is a runtime dependency the four
# command-line binaries never had, and Tauri 2 links the 4.1 API on libsoup 3. A distribution old
# enough to carry only 4.0 cannot run this window at all, so a package that refuses to install there
# says the true thing at the moment a person can still act on it. The headless archive
# `build-tarball.sh` publishes is what that person downloads instead, and it declares nothing.
cat >"$root/DEBIAN/control" <<EOF
Package: mixengine
Version: $version
Section: devel
Priority: optional
Architecture: $deb_arch
Depends: libwebkit2gtk-4.1-0, libgtk-3-0
Maintainer: MixEngine <noreply@mixengine.dev>
Homepage: https://github.com/mixnz/mixengine
Description: A local web development environment
 Run and switch multiple PHP, Node.js, Python and Ruby versions with a bundled
 web server, databases and caches, local domains and automatic HTTPS - without
 Docker and without hand-written configuration files.
EOF

name="mixengine_$version-1_${deb_arch}.deb"
rm -f "$dist/$name"

# `--root-owner-group`: the payload is root's whatever account built it, which is what makes the
# helper's directory root-owned on the installing machine.
dpkg-deb --build --root-owner-group "$root" "$dist/$name"

# **Open what was just made and check the binaries are in it** — the T85 design, D11.
contents="$(dpkg-deb -c "$dist/$name")"
for expected in \
  .$MIX_INSTALL_LINUX/mix \
  .$MIX_INSTALL_LINUX/mixengined \
  .$MIX_INSTALL_LINUX/mixengine-shim \
  .$MIX_INSTALL_LINUX/mixlab \
  ./usr/local/libexec/mixengine/mixengine-elevate \
  ./usr/share/applications/mixlab.desktop \
  ./usr/share/icons/hicolor/32x32/apps/mixlab.png \
  ./usr/share/icons/hicolor/128x128/apps/mixlab.png; do
  printf '%s\n' "$contents" | grep -q " $expected\$" || {
    echo "$expected is not in the package" >&2
    exit 1
  }
done

# **And the dependency really is declared.** The control file is written by a heredoc a few lines
# above and read by nothing else here; a field lost to an editing mistake would produce a package
# that installs happily onto a machine whose window cannot start.
depends="$(dpkg-deb -f "$dist/$name" Depends)"
case "$depends" in
  *libwebkit2gtk-4.1-0*) ;;
  *)
    echo "the package declares Depends: $depends, which does not name WebKitGTK 4.1" >&2
    exit 1
    ;;
esac

mix_checksum "$dist/$name"

# The handbook's install page links this one, unversioned — see `mix_publish_alias` in `common.sh`.
alias_deb="$(mix_publish_alias "$dist/$name" "mixengine_${deb_arch}.deb")"

echo "$dist/$name"
echo "$alias_deb"
