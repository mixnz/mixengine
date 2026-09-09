#!/usr/bin/env bash
# Exercise `AppRun`'s cache fill against a fixture — T85c.
#
# **The case worth having a fixture for is the second run**, where the cache already holds what an
# earlier build of the same version put there: the guard used to be `mix` alone, so a machine that
# had run one would never gain a binary a later build added — and the cache is what the AppImage
# actually executes, so a binary missing from it is missing from the product however well the image
# was packed.
#
# Runs anywhere: nothing here is an AppImage, nothing needs `appimagetool`, and nothing is
# Linux-specific. So the person editing `AppRun` can check it on the machine they are editing it on
# rather than on a runner an hour later.

set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

image="$work/image"
mkdir -p "$image/usr/bin"
printf '0.0.0-fixture\n' >"$image/VERSION"
install -m 0755 "$here/AppRun" "$image/AppRun"

# **`ldd` is part of the fixture now** — T105a. What `AppRun` does with no arguments depends on what
# `ldd` says about the window, and the three answers it has to tell apart are none of the answers a
# machine gives about the shell script standing in for one here. So the stub goes earlier on `PATH`,
# and the report it prints is a file the cases below rewrite.
stub="$work/bin"
mkdir -p "$stub"
printf '#!/usr/bin/env bash\ncat "%s"\n' "$work/ldd-report" >"$stub/ldd"
chmod 755 "$stub/ldd"
PATH="$stub:$PATH"
export PATH

# A refusal is also shown in a dialog when there is a display to show it on. There is one on the
# machine of the person running these checks, and a check that puts a window on their screen is a
# check they will stop running.
unset DISPLAY WAYLAND_DISPLAY

# A system with everything the window needs, until a case below says otherwise.
printf '\tlibc.so.6 => /lib/x86_64-linux-gnu/libc.so.6 (0x00007f0000000000)\n' >"$work/ldd-report"

# Stand-ins for the four binaries: each says its own name, and `mix` repeats its arguments so the
# hand-over at the end of `AppRun` can be checked rather than assumed.
for binary in mixengined mixengine-shim mixengine-elevate mixlab; do
  printf '#!/usr/bin/env bash\necho %s\n' "$binary" >"$image/usr/bin/$binary"
  chmod 755 "$image/usr/bin/$binary"
done
printf '#!/usr/bin/env bash\necho "mix $*"\n' >"$image/usr/bin/mix"
chmod 755 "$image/usr/bin/mix"

export XDG_CACHE_HOME="$work/cache"
cache="$XDG_CACHE_HOME/mixengine/0.0.0-fixture"

printed="$("$image/AppRun" --version)"
test "$printed" = "mix --version" || {
  echo "AppRun did not hand its arguments to mix: $printed" >&2
  exit 1
}

# **The hand-over, both ways** — T105. With no arguments the AppImage is a double click and opens
# MixLab; with any argument it is `./mixengine-<version>-linux-x86_64.AppImage status` and has to
# stay the CLI it has always been. The AppImage runtime eats its own `--appimage-*` arguments before
# `AppRun` is reached, so nothing else lands in either branch.
window="$("$image/AppRun")"
test "$window" = "mixlab" || {
  echo "AppRun with no arguments ran '$window' rather than the window" >&2
  exit 1
}

forwarded="$("$image/AppRun" status --json)"
test "$forwarded" = "mix status --json" || {
  echo "AppRun did not hand its arguments to mix: $forwarded" >&2
  exit 1
}

for binary in mix mixengined mixengine-shim mixengine-elevate mixlab; do
  test -x "$cache/$binary" || {
    echo "$binary is not in the cache AppRun filled" >&2
    exit 1
  }
done

# The stale cache: one binary gone, the version unchanged. The old guard looked at `mix`, found it,
# and copied nothing.
rm -f "$cache/mixengine-shim"
"$image/AppRun" --version >/dev/null
test -x "$cache/mixengine-shim" || {
  echo "AppRun did not repair a cache that was missing a binary" >&2
  exit 1
}

# **The three refusals** — T105a, D3. ADR 0028 makes this message the product's whole answer to a
# machine below the window's floor, and the answer T105 shipped named WebKitGTK whatever the cause
# was: a distribution whose glibc is too old was told to install a package it already had.

printf '\tlibwebkit2gtk-4.1.so.0 => not found\n' >"$work/ldd-report"
if refusal="$("$image/AppRun" 2>&1)"; then
  echo "AppRun opened a window on a system with no WebKitGTK: $refusal" >&2
  exit 1
fi
case "$refusal" in
  *libwebkit2gtk-4.1-0*webkit2gtk4.1*libwebkit2gtk-4_1-0*) ;;
  *)
    echo "AppRun's refusal does not name the three packages to install:" >&2
    echo "$refusal" >&2
    exit 1
    ;;
esac
case "$refusal" in
  *status*) ;;
  *)
    echo "AppRun's refusal does not say the command line still works:" >&2
    echo "$refusal" >&2
    exit 1
    ;;
esac

# A distribution older than the window. The same `ldd` answers this with a version rather than with
# a soname, and the package names above are the wrong thing to print at somebody who has them.
printf 'mixlab: /lib/x86_64-linux-gnu/libc.so.6: version %sGLIBC_2.35%s not found (required by mixlab)\n' \
  '`' "'" >"$work/ldd-report"
if refusal="$("$image/AppRun" 2>&1)"; then
  echo "AppRun opened a window on a system whose glibc is too old: $refusal" >&2
  exit 1
fi
case "$refusal" in
  *"glibc 2.35"*) ;;
  *)
    echo "AppRun's refusal does not name the glibc the window needs:" >&2
    echo "$refusal" >&2
    exit 1
    ;;
esac
case "$refusal" in
  *libwebkit2gtk-4.1-0*)
    echo "AppRun blamed WebKitGTK for a glibc that is too old:" >&2
    echo "$refusal" >&2
    exit 1
    ;;
esac

# Anything else missing is named as itself. There is no package list to print for a library nobody
# anticipated, and the soname is still the only useful thing a person can search for.
printf '\tlibfoo.so.7 => not found\n' >"$work/ldd-report"
if refusal="$("$image/AppRun" 2>&1)"; then
  echo "AppRun opened a window with a library missing: $refusal" >&2
  exit 1
fi
case "$refusal" in
  *libfoo.so.7*) ;;
  *)
    echo "AppRun's refusal does not name the library that is missing:" >&2
    echo "$refusal" >&2
    exit 1
    ;;
esac

# **And the command line is unaffected by all of it**, which is the sentence every refusal ends on.
# The branch that runs `mix` asks `ldd` nothing, and this is what says so.
forwarded="$("$image/AppRun" status)"
test "$forwarded" = "mix status" || {
  echo "AppRun stopped forwarding to mix on a system it cannot open a window on: $forwarded" >&2
  exit 1
}

echo "AppRun fills the cache, repairs a stale one, and refuses in the words of the floor that was missed"
