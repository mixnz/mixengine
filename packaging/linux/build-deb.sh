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
# T185: what `bin/` holds per name on Windows. Shipped here too so every system ships one list
# (`packaging/common.sh`); nothing on this system runs it, and run by hand it exits 127 naming the
# file it looks for.
install -m 0755 "$stage/mixengine-trampoline" "$root$MIX_INSTALL_LINUX/mixengine-trampoline"

# **`/usr/local` from a package is against Debian policy and is on purpose** — the T85 design, D3.
# One lookup path per system, whatever put the file there: a daemon that had to look in two places
# depending on how MixEngine arrived would have two answers to the question of which file it runs as
# root. This is the path `mixengine_platform::install::helper_path()` returns, so a machine installed
# from this package finds `HelperInstall` already done.
install -m 0755 "$stage/mixengine-elevate" \
  "$root/usr/local/libexec/mixengine/mixengine-elevate"

# **And a second copy beside `mixengined`, which is the one MixEngine installs *from*** — roadmap
# task T88d. `mix uninstall` removes the file above; until this copy existed there was nothing left
# on the machine for `HelperInstall {}` to copy, so reinstalling this package was the only way back
# to a machine that could elevate anything at all.
#
# `MIX_INSTALL_LINUX` and not `libexec`: `mixengine_platform::install::helper_sources` looks beside
# the running `mixengined`, and this is that directory. It is root-owned on every Linux, so the file
# an elevation prompt would run cannot be rewritten by the account MixEngine runs as — which is why
# this system needs no candidate beyond the beside rule where macOS needs one inside its bundle.
install -m 0755 "$stage/mixengine-elevate" \
  "$root$MIX_INSTALL_LINUX/mixengine-elevate"

# MixLab, the window — T105. `/usr/bin` beside the CLI, under the one name every artifact of this
# release spells it with.
install -m 0755 "$stage/$MIX_WINDOW" "$root$MIX_INSTALL_LINUX/$MIX_WINDOW"

# The menu entry and its icon. **No maintainer script updates any cache**, which is this package's
# oldest rule (see the header): a menu reads `/usr/share/applications` directly and works at once,
# and `xdg-open mixlab://…` reaches MixLab the next time anything on the machine runs
# `update-desktop-database` — which every desktop environment's own packages do routinely. Buying
# the rest of that would cost the invariant that nothing runs at install time.
install -m 0644 "$MIX_ROOT/packaging/linux/mixlab.desktop" \
  "$root/usr/share/applications/mixlab.desktop"

# The window's own icons, already committed for the Tauri bundle.
install -m 0644 "$MIX_ROOT/apps/desktop/src-tauri/icons/32x32.png" \
  "$root/usr/share/icons/hicolor/32x32/apps/mixlab.png"
install -m 0644 "$MIX_ROOT/apps/desktop/src-tauri/icons/128x128.png" \
  "$root/usr/share/icons/hicolor/128x128/apps/mixlab.png"

# **`Depends:` exists because of the window** — T105. WebKitGTK is a runtime dependency the four
# command-line binaries never had, and Tauri 2 links the 4.1 API on libsoup 3. A distribution old
# enough to carry only 4.0 cannot run this window at all, so a package that refuses to install there
# says the true thing at the moment a person can still act on it. The headless package below is
# what that person installs instead, and it depends on nothing.
#
# **AppIndicator is `Recommends:`, not `Depends:`** — T168d. It is what draws MixEngine's tray icon,
# and MixLab loads it at run time and goes without a tray when it is missing; nothing else stops
# working. apt installs recommends by default, so the ordinary install gets the icon, and a machine
# without the package still gets the window.
# **`mixlab`, taking over from `mixengine`** — T176f, ADR 0049. Debian's rename idiom: a package may
# conflict with a virtual name it provides itself, so `apt install ./mixlab_….deb` on a machine with
# `mixengine` 0.0.x removes that one in the same transaction, and `Replaces:` lets this one own the
# paths it owned. No maintainer script is needed for any of it.
cat >"$root/DEBIAN/control" <<EOF
Package: $MIX_ARTIFACT
Version: $version
Section: devel
Priority: optional
Architecture: $deb_arch
Provides: $MIX_HEADLESS_ARTIFACT
Conflicts: $MIX_HEADLESS_ARTIFACT, $MIX_HEADLESS_ARTIFACT-headless
Replaces: $MIX_HEADLESS_ARTIFACT, $MIX_HEADLESS_ARTIFACT-headless
Depends: libwebkit2gtk-4.1-0, libgtk-3-0
Recommends: libayatana-appindicator3-1 | libappindicator3-1
Maintainer: MixEngine <noreply@mixengine.dev>
Homepage: https://github.com/mixnz/mixlab
Description: A local web development environment
 Run and switch multiple PHP, Node.js, Python and Ruby versions with a bundled
 web server, databases and caches, local domains and automatic HTTPS - without
 Docker and without hand-written configuration files.
EOF

name="${MIX_ARTIFACT}_$version-1_${deb_arch}.deb"
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
  .$MIX_INSTALL_LINUX/mixengine-trampoline \
  .$MIX_INSTALL_LINUX/mixengine-elevate \
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

recommends="$(dpkg-deb -f "$dist/$name" Recommends)"
case "$recommends" in
  *appindicator3*) ;;
  *)
    echo "the package declares Recommends: $recommends, which does not name AppIndicator" >&2
    exit 1
    ;;
esac

# **And the rename really is declared** — T176f. A field lost here produces a package apt installs
# beside `mixengine` 0.0.x rather than over it, and two packages owning `/usr/bin/mix` is an error
# the user meets, not this script.
test "$(dpkg-deb -f "$dist/$name" Package)" = "$MIX_ARTIFACT" || {
  echo "the package is not named $MIX_ARTIFACT" >&2
  exit 1
}
test "$(dpkg-deb -f "$dist/$name" Provides)" = "$MIX_HEADLESS_ARTIFACT" || {
  echo "the package does not provide $MIX_HEADLESS_ARTIFACT" >&2
  exit 1
}
# And the headless package of T182b, D5: both own `/usr/bin/mix`, so one replaces the other.
for field in Conflicts Replaces; do
  declared="$(dpkg-deb -f "$dist/$name" "$field")"
  test "$declared" = "$MIX_HEADLESS_ARTIFACT, $MIX_HEADLESS_ARTIFACT-headless" || {
    echo "the package declares $field: $declared" >&2
    exit 1
  }
done

mix_checksum "$dist/$name"

# The handbook's install page links this one, unversioned — see `mix_publish_alias` in `common.sh`.
alias_deb="$(mix_publish_alias "$dist/$name" "${MIX_ARTIFACT}_${deb_arch}.deb")"

# **The headless package** — T182b, D5, which replaces the headless tarball. The four programs and
# the helper, placed as root the way the window's package places them, and no window, no menu entry
# and no WebKitGTK to depend on: a server should not be made to carry them. `mixengine-headless`
# rather than `mixengine`, which is the name the window's package took over from (T176f) and still
# provides; the two conflict, because both own `/usr/bin/mix`.
headless_root="$MIX_OUT/debroot-headless"
rm -rf "$headless_root"
mkdir -p "$headless_root/DEBIAN" "$headless_root$MIX_INSTALL_LINUX" \
  "$headless_root/usr/local/libexec/mixengine"
for binary in mix mixengined mixengine-shim mixengine-trampoline mixengine-elevate; do
  install -m 0755 "$stage/$binary" "$headless_root$MIX_INSTALL_LINUX/$binary"
done
install -m 0755 "$stage/mixengine-elevate" \
  "$headless_root/usr/local/libexec/mixengine/mixengine-elevate"

headless_package="$MIX_HEADLESS_ARTIFACT-headless"
cat >"$headless_root/DEBIAN/control" <<EOF
Package: $headless_package
Version: $version
Section: devel
Priority: optional
Architecture: $deb_arch
Conflicts: $MIX_ARTIFACT, $MIX_HEADLESS_ARTIFACT
Replaces: $MIX_ARTIFACT, $MIX_HEADLESS_ARTIFACT
Maintainer: MixEngine <noreply@mixengine.dev>
Homepage: https://github.com/mixnz/mixlab
Description: A local web development environment, without the window
 The command-line programs of MixLab: run and switch multiple PHP, Node.js,
 Python and Ruby versions with a bundled web server, databases and caches,
 local domains and automatic HTTPS.
EOF

headless_name="${headless_package}_$version-1_${deb_arch}.deb"
rm -f "$dist/$headless_name"
dpkg-deb --build --root-owner-group "$headless_root" "$dist/$headless_name"

# Checked for what is in it **and for what is not**: a package that quietly grew a webview is the one
# failure it exists to prevent.
headless_contents="$(dpkg-deb -c "$dist/$headless_name")"
for expected in \
  .$MIX_INSTALL_LINUX/mix \
  .$MIX_INSTALL_LINUX/mixengined \
  .$MIX_INSTALL_LINUX/mixengine-shim \
  .$MIX_INSTALL_LINUX/mixengine-trampoline \
  .$MIX_INSTALL_LINUX/mixengine-elevate \
  ./usr/local/libexec/mixengine/mixengine-elevate; do
  printf '%s\n' "$headless_contents" | grep -q " $expected\$" || {
    echo "$expected is not in the headless package" >&2
    exit 1
  }
done
if printf '%s\n' "$headless_contents" | grep -q " \.$MIX_INSTALL_LINUX/$MIX_WINDOW\$"; then
  echo "the headless package carries $MIX_WINDOW, which is the one thing it must not" >&2
  exit 1
fi
test -z "$(dpkg-deb -f "$dist/$headless_name" Depends)" || {
  echo "the headless package declares a dependency; it has none to declare" >&2
  exit 1
}

mix_checksum "$dist/$headless_name"
alias_headless="$(mix_publish_alias "$dist/$headless_name" "${headless_package}_${deb_arch}.deb")"

# T88a: the privileged helper on its own, so the `release` job can sign it and the feed can list it
# under `HELPER_VERSION` (T182b, D1). Here since T182b removed the tarball that published it.
helper_name="$(mix_publish_helper "$stage/mixengine-elevate" linux "$arch")"

echo "$dist/$name"
echo "$alias_deb"
echo "$dist/$headless_name"
echo "$alias_headless"
echo "$helper_name"
