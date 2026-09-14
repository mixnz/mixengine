#!/usr/bin/env bash
# Reclaim the disk the two `target/` directories are sitting on.
#
#   scripts/clean-targets.sh                # remove `debug/` from both — the default
#   scripts/clean-targets.sh --incremental  # remove only `debug/incremental/`
#   scripts/clean-targets.sh --all          # remove both `target/` directories entirely
#   scripts/clean-targets.sh --yes          # do not ask
#   scripts/clean-targets.sh --dry-run      # print what would go, remove nothing
#
# **There are two of them and no single command clears both.** The root workspace `exclude`s the
# desktop application's crate (ADR 0027, rule 5), so `cargo clean` at the root does not reach
# `apps/desktop/src-tauri/target/`, and a developer who only ever ran the root one has been leaving
# the larger half of the problem behind.
#
# The three levels are what they cost to undo, which is the only thing worth choosing between:
#
#   * `--incremental` is pure cache. rustc rebuilds it as it goes; nothing here is an input to
#     anything, and no artifact is lost. Usually the majority of both directories.
#   * the default, `debug/`, additionally drops compiled dependencies and test binaries: the next
#     `cargo check --workspace` is a cold one. `release/` is untouched, so a staged installer and
#     `target/packaging/` survive.
#   * `--all` is both directories, `release/`, `doc/`, `packaging/` and the sqlx development
#     databases with them. `.sqlx/` is committed and is not here, so this costs build time and
#     nothing else — but `DATABASE_URL=sqlite:target/sqlx-dev.db` will need its database created
#     again (see .claude/operations/build-and-release.md).
#
# Exit status: 0 when the requested directories are gone, 1 when something refused, 64 for a misuse
# of this script.

set -euo pipefail

# The repository root from the location of this file, never from the working directory and never
# from an environment variable — an empty one would make every path below resolve to `/`.
MIX_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# **The one assertion that stands between this script and somebody's home directory.** Every path
# it removes is built from `$MIX_ROOT`; if that is not this workspace, none of them mean what the
# lines below say they mean.
if [ ! -f "$MIX_ROOT/Cargo.toml" ] || ! grep -q '^\[workspace\]' "$MIX_ROOT/Cargo.toml"; then
  echo "not the MixEngine workspace root: $MIX_ROOT" >&2
  exit 1
fi

level=debug
assume_yes=0
dry_run=0
for arg in "$@"; do
  case "$arg" in
    --incremental) level=incremental ;;
    --debug) level=debug ;;
    --all) level=all ;;
    --yes | -y) assume_yes=1 ;;
    --dry-run | -n) dry_run=1 ;;
    *) echo "unknown argument: $arg" >&2; exit 64 ;;
  esac
done

# The two workspaces, named once.
roots=(
  "$MIX_ROOT/target"
  "$MIX_ROOT/apps/desktop/src-tauri/target"
)

targets=()
for root in "${roots[@]}"; do
  case "$level" in
    incremental) targets+=("$root/debug/incremental") ;;
    debug) targets+=("$root/debug") ;;
    all) targets+=("$root") ;;
  esac
done

# Only what is actually there, so the report is of this machine rather than of the three levels.
present=()
for path in "${targets[@]}"; do
  if [ -d "$path" ]; then
    present+=("$path")
  fi
done

if [ ${#present[@]} -eq 0 ]; then
  echo "nothing to remove at level '$level' — already clean"
  exit 0
fi

echo "level: $level"
echo
# `du` over eighty gigabytes takes a moment and is the whole point of the report, so it is measured
# rather than estimated. Paths printed relative to the root: two absolute paths of a hundred
# characters each hide the one thing a reader is checking, which is *which* directory this is.
for path in "${present[@]}"; do
  printf '  %-10s %s\n' "$(du -sh "$path" 2>/dev/null | cut -f1)" "${path#"$MIX_ROOT/"}"
done
echo

if [ "$dry_run" -eq 1 ]; then
  echo "--dry-run: nothing removed"
  exit 0
fi

# **A running binary is the one refusal that reads as something else.** Windows will not unlink a
# running image and reports `os error 5`, which looks like a permissions problem; a half-removed
# `debug/` then leaves cargo rebuilding around a file it cannot replace. Ask before the first
# `rm`, and name the command that fixes it.
running=()
for binary in mix mixengined mixengine-shim mixengine-elevate mixlab caddy; do
  case "$(uname -s)" in
    MINGW* | MSYS* | CYGWIN*)
      # `//NH //FO`, doubled, because MSYS rewrites a single leading slash into a Windows path.
      case "$(tasklist //NH //FO CSV 2>/dev/null || true)" in
        *"\"$binary.exe\""*) running+=("$binary") ;;
      esac
      ;;
    *)
      # `if` and not `pgrep … && running+=(…)`: under `set -e` an AND-list whose left side fails is
      # a failing statement, so the no-match case — the ordinary one — would end the script here.
      if pgrep -x "$binary" >/dev/null 2>&1; then
        running+=("$binary")
      fi
      ;;
  esac
done

if [ ${#running[@]} -ne 0 ]; then
  echo "still running: ${running[*]}" >&2
  echo "their files cannot be removed while they are — stop them first:" >&2
  echo "  cargo run -p mixengine-cli -- daemon stop" >&2
  exit 1
fi

if [ "$assume_yes" -eq 0 ]; then
  printf 'remove the %d director%s above? [y/N] ' "${#present[@]}" "$([ ${#present[@]} -eq 1 ] && echo y || echo ies)"
  # From the terminal and not from stdin, so the prompt still works when this is run with its output
  # piped somewhere. A machine with no terminal has to say `--yes`, which is the right answer there:
  # an unattended run that silently took the default would be one nobody chose.
  #
  # **Opened rather than tested with `-r`.** Under an agent or a CI runner `/dev/tty` is a file that
  # exists and answers yes to every stat, and then refuses to open — `No such device or address`,
  # measured. Whether a terminal is there is a question only opening it answers.
  # The group's own redirection and not `exec 3</dev/tty 2>/dev/null`: redirections are applied left
  # to right, so on that line the open has already failed and printed before `2>` takes effect. A
  # group sets stderr first, and `{ … ; }` is not a subshell, so descriptor 3 survives it.
  if ! { exec 3</dev/tty; } 2>/dev/null; then
    echo "no terminal to ask on — pass --yes to remove without confirmation" >&2
    exit 1
  fi
  read -r reply <&3
  exec 3<&-
  case "$reply" in
    y | Y | yes | YES) ;;
    *) echo "nothing removed"; exit 0 ;;
  esac
fi

# **Checked again immediately before the `rm`, one path at a time.** The list was built forty lines
# ago and the value of a guard is where it sits: a path that is not under this workspace, or is the
# workspace itself, is a bug in this file rather than a thing to delete and find out about.
for path in "${present[@]}"; do
  case "$path" in
    "$MIX_ROOT"/*/target | "$MIX_ROOT"/target | "$MIX_ROOT"/*/target/* | "$MIX_ROOT"/target/*) ;;
    *)
      echo "refusing to remove a path outside the workspace's targets: $path" >&2
      exit 1
      ;;
  esac
  echo "removing ${path#"$MIX_ROOT/"}"
  rm -rf "$path"
done

echo
echo "remaining:"
for root in "${roots[@]}"; do
  if [ -d "$root" ]; then
    printf '  %-10s %s\n' "$(du -sh "$root" 2>/dev/null | cut -f1)" "${root#"$MIX_ROOT/"}"
  else
    printf '  %-10s %s\n' "gone" "${root#"$MIX_ROOT/"}"
  fi
done
