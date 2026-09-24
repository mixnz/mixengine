#!/usr/bin/env bash
# When the privileged helper's version has to move — roadmap task T182b, D1.
#
#   bash packaging/helper-lock.sh --check     fail if the helper changed and HELPER_VERSION did not
#   bash packaging/helper-lock.sh --bump      raise HELPER_VERSION one patch past the last release
#   bash packaging/helper-lock.sh --release   record the helper the release ships (set-version.mjs)
#
# The work is in helper-lock.mjs; this is the name the documentation and the hook use.

set -euo pipefail

cd "$(git -C "$(dirname "${BASH_SOURCE[0]}")" rev-parse --show-toplevel)"
exec node packaging/helper-lock.mjs "$@"
