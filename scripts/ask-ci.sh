#!/usr/bin/env bash
# Ask CI for an answer about a branch, which is the only way to get one.
#
#   scripts/ask-ci.sh                 # the branch you are on
#   scripts/ask-ci.sh some-branch     # a branch by name
#   scripts/ask-ci.sh --watch         # request it, then wait for the verdict
#
# `ci.yml` fires by itself on a `v*` tag and on nothing else, so every branch — `master` too —
# has to ask. This is the two commands that asking is: push the ref, then dispatch a run on it.
#
# **The push is not a convenience.** `gh workflow run --ref` names a ref on the *remote*, so a
# dispatch without it builds whatever the remote last saw, silently and with a plausible-looking
# green tick. Pushing first is what makes the run about the commit you are looking at.
#
# **`ci.yml` is read from the default branch.** A workflow only becomes dispatchable once it is on
# `master`; a branch that edits `ci.yml` runs its own copy once selected, but it cannot introduce a
# workflow that master has never seen.
#
# Exit status: 0 when the run was requested, 1 when something refused, 64 for a misuse of this
# script — so it is never read as a report about CI.

set -uo pipefail

watch=0
branch=""
for arg in "$@"; do
  case "$arg" in
    --watch) watch=1 ;;
    -*) echo "unknown option: $arg" >&2; exit 64 ;;
    *) branch="$arg" ;;
  esac
done

[ -n "$branch" ] || branch="$(git branch --show-current)"
if [ -z "$branch" ]; then
  echo "not on a branch, and none was named" >&2
  exit 64
fi

git push origin "$branch" || exit 1
gh workflow run ci.yml --ref "$branch" || exit 1
echo "requested a run on $branch"

if [ "$watch" -eq 1 ]; then
  # Through `bash` rather than by executing it: `watch-ci.sh` is committed 100644, so a checkout on
  # Unix has no execute bit to rely on.
  exec bash "$(dirname "${BASH_SOURCE[0]}")/watch-ci.sh"
fi

echo "watch it with: bash scripts/watch-ci.sh"
