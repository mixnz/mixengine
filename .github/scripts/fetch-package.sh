#!/usr/bin/env bash
# Fetch one package `mixengine-packages` publishes, unpack it, and name it in the environment.
#
#     .github/scripts/fetch-package.sh [--absent-on OS-ARCH]... [--probe "<path> <args>"]... \
#       <kind> <version> <VARIABLE> [directory]
#
# **Every fetch in CI goes through here since T172a.** `bench` was its first caller; the eleven
# "Fetch a real X" steps of `services` and `system` were each about forty lines of bash inside YAML,
# the same forty lines with a version, a variable and a smoke check changed, and they are now one
# line each. What only one package needs stays beside its step: nginx is packed as a whole tree
# because the generated configuration reads its `conf/` by absolute path, and that is the
# fixture's business rather than this script's.
#
# `--absent-on <RUNNER_OS-RUNNER_ARCH>` names a runner nothing is published for — Windows on ARM,
# for most servers. There this says so and succeeds without setting the variable, and every suite
# that reads it already skips when it is unset: exactly what the inline steps did.
#
# `--probe "<path> <args>"` runs the unpacked program once, relative to the directory and with
# `.exe` appended on Windows, so a broken archive fails in the fetch step rather than inside a
# suite. The first probe whose program exists is the one run: PHP names two, because its publisher
# puts `bin/php` on Unix and `php.exe` at the root on Windows.
#
# It writes `<VARIABLE>=<directory>` into `$GITHUB_ENV`, which is what the suites read, and prints
# the directory. A missing archive is a failure rather than a skipped measurement: a bench that
# quietly measured two services would report a number nobody could compare.
set -euo pipefail

absent_on=()
probes=()
while [ $# -gt 0 ]; do
  case "$1" in
    --absent-on)
      absent_on+=("$2")
      shift 2
      ;;
    --probe)
      probes+=("$2")
      shift 2
      ;;
    --)
      shift
      break
      ;;
    -*)
      echo "::error::fetch-package.sh: unknown option $1"
      exit 64
      ;;
    *)
      break
      ;;
  esac
done

kind=${1:?a package kind, as the index publishes it}
version=${2:?the version the index publishes}
variable=${3:?the environment variable the suite reads}
# Where to unpack, for a caller that wants more than one of a kind — the cold path takes three PHPs
# and the default would have them overwrite one another.
into=${4:-$RUNNER_TEMP/$kind}

# Before anything is downloaded. `"${a[@]+"${a[@]}"}"` because bash 3.2 under `set -u` calls an
# empty array unbound, and macOS runs this with its own bash.
for runner in "${absent_on[@]+"${absent_on[@]}"}"; do
  if [ "${RUNNER_OS:-}-${RUNNER_ARCH:-}" = "$runner" ]; then
    echo "::notice::mixengine-packages publishes no $kind for $runner; the suites that need it skip on this leg"
    exit 0
  fi
done

case "${RUNNER_OS:-}-${RUNNER_ARCH:-}" in
  Linux-X64)     target=linux-x86_64;    exts="tar.zst tar.gz" ;;
  Linux-ARM64)   target=linux-aarch64;   exts="tar.zst tar.gz" ;;
  macOS-ARM64)   target=macos-aarch64;   exts="tar.zst tar.gz" ;;
  macOS-X64)     target=macos-x86_64;    exts="tar.zst tar.gz" ;;
  Windows-X64)   target=windows-x86_64;  exts="zip" ;;
  Windows-ARM64) target=windows-aarch64; exts="zip" ;;
  *) echo "::error::this runner is ${RUNNER_OS:-unknown}-${RUNNER_ARCH:-unknown}, which no target is published for"; exit 1 ;;
esac

mkdir -p "$into"

# **More than one extension, because the publisher has used more than one.** PHP 7.0.33 and 7.4.33
# ship `tar.gz` on Linux where 8.3.33 ships `tar.zst` — checked against the release assets — and a
# script that assumed either would fail on half the versions the cold path measures. Each candidate
# is tried in turn and a miss falls through to the next; running out of candidates is still a hard
# failure, because a bench that quietly measured two of three would report a number nobody can
# compare.
archive=""

for ext in $exts; do
  candidate="$into.$ext"

  if curl --fail --silent --show-error --location --retry 3 --output "$candidate" \
    "https://github.com/mixnz/mixengine-packages/releases/download/$kind-$version/$kind-$version-$target.$ext"; then
    archive=$candidate
    break
  fi
done

if [ -z "$archive" ]; then
  echo "::error::mixengine-packages publishes no $kind $version for $target in any of: $exts"
  exit 1
fi

# Two different `tar`s, and on Windows the one on the PATH is the wrong one. Git Bash ships GNU tar,
# which reads `D:\a\_temp\caddy.zip` as a *remote host* called `D` — and cannot read a zip even once
# told otherwise. Windows itself ships bsdtar, which reads both, so it is named outright rather than
# reached through the PATH. Elsewhere the archive is `.tar.zst`: bsdtar decompresses it by magic and
# GNU tar shells out to `zstd`, so the pipe is the fallback for a tar built without it.
if [ "${RUNNER_OS:-}" = "Windows" ]; then
  "$SYSTEMROOT/System32/tar.exe" -xf "$archive" -C "$into"
else
  tar -xf "$archive" -C "$into" || zstd -dc "$archive" | tar -xf - -C "$into"
fi

# The smoke check, before the variable is set, so a suite never sees a directory that failed it.
if [ ${#probes[@]} -gt 0 ]; then
  suffix=""
  if [ "${RUNNER_OS:-}" = "Windows" ]; then
    suffix=".exe"
  fi
  ran=0
  for probe in "${probes[@]}"; do
    program="${probe%% *}"
    args=""
    if [ "$probe" != "$program" ]; then
      args="${probe#* }"
    fi
    if [ -f "$into/$program$suffix" ]; then
      # Word-split on purpose: the arguments are written as one string by the caller.
      # shellcheck disable=SC2086
      "$into/$program$suffix" $args
      ran=1
      break
    fi
  done
  if [ "$ran" -eq 0 ]; then
    echo "::error::none of the probes for $kind exists under $into: ${probes[*]}"
    exit 1
  fi
fi

echo "$variable=$into" >> "$GITHUB_ENV"
echo "$into"
