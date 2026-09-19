#!/usr/bin/env bash
# The tar `binaries` hands to `build` (T171, E1): exactly the headless binaries `common.sh` names,
# from every `target/<triple>/release` this job built, and nothing else of cargo's. `build` fails on
# any trace of a compile in its tree, and `deps/` or `.fingerprint/` arriving in this tar would be
# one. A tar and not the files because `upload-artifact` drops file modes.
set -euo pipefail

source packaging/common.sh

files=()
for dir in target/*/release; do
  for binary in $(mix_headless_binaries); do
    if [ -f "$dir/$binary$(mix_exe_suffix)" ]; then
      files+=("$dir/$binary$(mix_exe_suffix)")
    fi
  done
done
if [ ${#files[@]} -eq 0 ]; then
  echo "nothing under target/*/release to hand on" >&2
  exit 1
fi
tar -cf binaries.tar "${files[@]}"
tar -tvf binaries.tar
