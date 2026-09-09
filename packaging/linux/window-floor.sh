#!/usr/bin/env bash
# What the window needs from the system it will run on, read off the window that was just built.
#
# **T105a, and the reason it exists is ADR 0028**: the AppImage does not carry WebKitGTK, so the
# floor a person has to clear is their own distribution's — and a floor promised in three documents
# has to be read off the binary rather than remembered. Two assertions and one measurement:
#
#   * the highest `GLIBC_x.y` the window requires, held under `MIX_WINDOW_GLIBC`;
#   * that it still links `MIX_WINDOW_WEBKIT`, whose API version is the one both install pages name
#     three package names for;
#   * the size of its resolved library closure, and the WebKitGTK/JavaScriptCore share of it — what
#     carrying those libraries would have cost, kept regenerable so that ADR 0028's numbers never
#     have to be taken on trust.
#
# The two assertions read the file with `readelf` and need nothing installed and nothing resolvable.
# The measurement needs the libraries to be on this machine, so it is best-effort: a developer
# without WebKitGTK is still entitled to the assertions.
#
# Linux only, and run by `packaging/desktop.sh` immediately after the window is staged — the one
# moment where the binary is newest and the machine that produced it is still the one being asked.

source "$(dirname "${BASH_SOURCE[0]}")/../common.sh"

mix_require readelf

window="${1:-}"
if [ -z "$window" ]; then
  echo "usage: window-floor.sh <path to the staged window>" >&2
  exit 64
fi
test -f "$window" || {
  echo "there is no window at $window" >&2
  exit 1
}

# `.gnu.version_r` is what this binary needs from the libraries it links, versioned symbol by
# versioned symbol, and the highest `GLIBC_` entry in it is the oldest glibc that can load it.
#
# The leading digit in the pattern is not decoration: a binary built by a recent toolchain also
# carries `GLIBC_ABI_DT_RELR`, which is a name and not a version, and an empty capture would sort
# below every real answer and be picked as the highest by nothing but luck.
required="$(readelf --version-info --wide "$window" \
  | sed -n 's/.*Name: GLIBC_\([0-9][0-9.]*\).*/\1/p' \
  | sort -V \
  | tail -1)"

# A reading that came back empty is void, not clean. Every Tauri binary on Linux links glibc; a
# `readelf` that found no version requirement at all was pointed at the wrong file or run by a tool
# that does not understand it — and a check that passes on a void reading is worse than no check.
if [ -z "$required" ]; then
  echo "$window requires no versioned glibc symbol at all, which no dynamically linked binary" >&2
  echo "does — this reading is void rather than clean" >&2
  exit 1
fi

# `sort -V` and not a numeric comparison: these are dotted versions, and 2.9 is older than 2.35.
#
# **`<=` and not `==`.** A toolchain that stops needing a symbol must not be a red build. The event
# worth catching is the floor *rising* past what three documents promise, which is what happens the
# day somebody moves this leg off `ubuntu-22.04`.
highest="$(printf '%s\n%s\n' "$required" "$MIX_WINDOW_GLIBC" | sort -V | tail -1)"
if [ "$highest" != "$MIX_WINDOW_GLIBC" ]; then
  echo "the window requires glibc $required, and this product promises $MIX_WINDOW_GLIBC." >&2
  echo "Both install pages name the distributions that promise implies, and packaging/common.sh" >&2
  echo "declares it. Either build the window on an older host, or raise MIX_WINDOW_GLIBC and say" >&2
  echo "so in both install pages in the same change — the test in" >&2
  echo "crates/mixengine-core/tests/packaging.rs will not let you do one without the other." >&2
  exit 1
fi

# The other half of the floor, and the half that would go wrong silently. Both install pages name
# `libwebkit2gtk-4.1-0`, `webkit2gtk4.1` and `libwebkit2gtk-4_1-0` as the package to install; the day
# a Tauri release moves to the `webkitgtk-6.0` API, every one of those names is wrong and nothing
# else in this repository would notice.
if ! readelf --dynamic --wide "$window" \
  | sed -n 's/.*(NEEDED).*\[\(.*\)\]/\1/p' \
  | grep -qx "$MIX_WINDOW_WEBKIT"; then
  echo "the window does not link $MIX_WINDOW_WEBKIT." >&2
  echo "Both install pages name a package for that API version. If the webview moved, they have" >&2
  echo "to move with it — MIX_WINDOW_WEBKIT in packaging/common.sh is where that starts." >&2
  exit 1
fi

echo "the window requires glibc $required (promised: $MIX_WINDOW_GLIBC) and links $MIX_WINDOW_WEBKIT"

# **What carrying WebKitGTK would have cost** — ADR 0028's third measurement, printed rather than
# argued about. Best-effort by design: on a machine that cannot resolve the closure the two
# assertions above have already been made, and half a number is worse than none.
if ! command -v ldd >/dev/null 2>&1; then
  echo "no ldd on this machine, so the library closure is not measured"
  exit 0
fi

report="$(ldd "$window" 2>&1 || true)"
case "$report" in
  *"not found"*)
    echo "this machine cannot resolve the window's libraries, so the closure is not measured"
    exit 0
    ;;
esac

# `=> /path` and nothing else: `linux-vdso.so.1` has no file behind it, and the loader's own line
# carries no arrow. `-L` on `stat`, because most of these are symlinks onto a versioned name.
sizes="$(printf '%s\n' "$report" \
  | sed -n 's/.*=> \(\/[^ ]*\).*/\1/p' \
  | sort -u \
  | while read -r library; do
    printf '%s %s\n' "$(stat -Lc %s "$library" 2>/dev/null || echo 0)" "$(basename "$library")"
  done)"

if [ -z "$sizes" ]; then
  echo "ldd resolved no library files, so the closure is not measured"
  exit 0
fi

printf '%s\n' "$sizes" | awk '
  { total += $1; count += 1 }
  $2 ~ /^libwebkit2gtk-/ || $2 ~ /^libjavascriptcoregtk-/ { webkit += $1 }
  END {
    printf "carrying its library closure would be %d MB across %d files, of which WebKitGTK and JavaScriptCore are %d MB\n", \
      total / 1048576, count, webkit / 1048576
  }'
