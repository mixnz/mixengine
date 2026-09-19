#!/usr/bin/env bash
# `release`'s last step: download what the draft release actually holds and verify every signature
# in it against the committed public key — what was published, not only what was signed. Reads
# `GITHUB_REF_NAME`, and `GH_TOKEN` for `gh`.
set -euo pipefail

mkdir -p published
gh release download "$GITHUB_REF_NAME" --dir published --pattern '*'
pubkey="$(sed -n '2p' packaging/updates.pub | tr -d '\r')"
checked=0
for signature in published/*.minisig; do
  artifact="${signature%.minisig}"
  test -f "$artifact" || {
    echo "$signature was published with no artifact beside it" >&2
    exit 1
  }
  minisign -V -H -P "$pubkey" -m "$artifact" -q
  checked=$((checked + 1))
done
test "$checked" -gt 0 || {
  echo "the release carries no signatures" >&2
  exit 1
}
echo "$checked published artifacts verify against $pubkey"
