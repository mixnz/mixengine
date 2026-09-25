#!/usr/bin/env bash
# `feed.sh` against a fixture distribution — T85c, D8.
#
# **What this looks at is the shape of the `provides` keys.** `index::format::Artifact` documents
# them as executable *name* to path (`{"php": "php.exe"}`), `updates::apply::binary_name` appends
# this platform's suffix itself, and `updates::apply::stage` looks the smoke-test executable up as
# `mixengined`. A Windows payload described with the `.exe` on the key satisfies none of those, and
# the only sign of it is a `mix self-update` that refuses the release it was just offered.
#
# No packaging tools, and nothing OS-specific: the fixture archive is written by `python3`'s own
# `zipfile`, and `feed.sh` already requires `python3`. So this runs on the machine of
# whoever is editing the script, whichever of the three that is.

set -euo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

version="$(mix_version)"
work="$MIX_OUT/feed-check"
rm -rf "$work"
mkdir -p "$work/dist"

# The Windows payload, whose entries carry `.exe` — the whole point of the check.
export MIX_CHECK_ZIP="$work/dist/$MIX_ARTIFACT-$version-windows-x86_64.zip"
export MIX_CHECK_NAMES="${MIX_BINARIES[*]}"

python3 - <<'PY'
import os
import zipfile

with zipfile.ZipFile(os.environ["MIX_CHECK_ZIP"], "w") as archive:
    for name in os.environ["MIX_CHECK_NAMES"].split():
        archive.writestr(f"mixengine/{name}.exe", "not a binary\n")
PY

# **The headless zip, which this feed must ignore** — T105, D7. It is only ever built as a fixture now
# (T182b, D5 made the headless Windows download a setup), and stays here because a headless archive
# that reached the payload loop would be a second row for a pair that already has one.
export MIX_CHECK_HEADLESS_ZIP="$work/dist/$MIX_HEADLESS_ARTIFACT-$version-windows-x86_64-headless.zip"

python3 - <<'PY'
import os
import zipfile

with zipfile.ZipFile(os.environ["MIX_CHECK_HEADLESS_ZIP"], "w") as archive:
    for name in os.environ["MIX_CHECK_NAMES"].split():
        archive.writestr(f"mixengine/{name}.exe", "not a binary\n")
PY

# The two privileged-helper assets a release publishes beside its payloads — roadmap task T88a.
# `feed.sh` refuses a distribution with none, so this is also what proves the fixture is a release
# shape rather than half of one.
#
# Named by the helper's own version, not the release's — T182b, D1.
helper_version="$(mix_helper_version)"
export MIX_CHECK_HELPER_VERSION="$helper_version"
printf 'not a binary\n' >"$work/dist/mixengine-elevate-$helper_version-linux-x86_64"
printf 'not a binary\n' >"$work/dist/mixengine-elevate-$helper_version-windows-x86_64.exe"
printf 'not a binary\n' >"$work/dist/mixengine-elevate-$helper_version-macos-universal"

# The installers — roadmap task T88f and T182b, D5: both flavours of the `.pkg`, the `.deb` and the
# `.rpm`, and the Linux aliases `feed.sh` must not list a second time. `feed.sh` refuses a helper
# for macOS or Linux with no installer beside it.
native="$(mix_native_version)"
for name in \
  "$MIX_ARTIFACT-$version-macos-universal.pkg" \
  "$MIX_HEADLESS_ARTIFACT-$version-macos-universal-headless.pkg" \
  "${MIX_ARTIFACT}_$native-1_amd64.deb" \
  "${MIX_HEADLESS_ARTIFACT}-headless_$native-1_amd64.deb" \
  "$MIX_ARTIFACT-$native-1.x86_64.rpm" \
  "$MIX_HEADLESS_ARTIFACT-headless-$native-1.x86_64.rpm" \
  "${MIX_ARTIFACT}_amd64.deb" \
  "$MIX_ARTIFACT-x86_64.rpm"; do
  printf 'not a package: %s\n' "$name" >"$work/dist/$name"
done

bash "$MIX_ROOT/packaging/feed.sh" --dist "$work/dist" --version "$version" --tag "v$version"

python3 - "$work/dist/latest.json" <<'PY'
import json
import os
import sys

with open(sys.argv[1], encoding="utf-8") as handle:
    document = json.load(handle)

expected = set(os.environ["MIX_CHECK_NAMES"].split())
problems = []

for artifact in document["artifacts"]:
    provides = artifact["provides"]
    names = set(provides)
    where = artifact["os"] + "/" + artifact["arch"]

    if names != expected:
        problems.append(f"{where} provides {sorted(names)}, not {sorted(expected)}")

    for name, path in provides.items():
        if not path.startswith("mixengine/"):
            problems.append(f"{name} points at {path}, which is not under mixengine/")


# T105. A payload went into the fixture and a headless archive beside it; a feed that collected both
# would list this pair of (os, arch) twice, and `mixengine_core::index` takes the
# first row it matches — so the artifact a machine downloaded would depend on the order a glob
# happened to return.
seen = [(artifact["os"], artifact["arch"]) for artifact in document["artifacts"]]
if len(seen) != len(set(seen)):
    problems.append(f"the feed lists an (os, arch) pair more than once: {sorted(seen)}")

for url in [artifact["url"] for artifact in document["artifacts"]]:
    if "headless" in url:
        problems.append(f"the feed lists a headless archive as an update payload: {url}")

# T88a. The helper is its own asset, so the row that names it is the only thing standing between a
# release and an installed helper nothing can replace. `.exe` on Windows, and one universal macOS
# file under both architecture rows.
helpers = {(row["os"], row["arch"]): row["url"] for row in document["helpers"]}

for pair in [("linux", "x86_64"), ("windows", "x86_64"), ("macos", "x86_64"), ("macos", "aarch64")]:
    if pair not in helpers:
        problems.append(f"no privileged helper for {pair[0]}/{pair[1]}: {sorted(helpers)}")

if ("windows", "x86_64") in helpers and not helpers[("windows", "x86_64")].endswith(".exe"):
    problems.append(f"the Windows helper is {helpers[('windows', 'x86_64')]}, which Windows will not run")

for row in document["helpers"]:
    if row.get("version") != os.environ["MIX_CHECK_HELPER_VERSION"]:
        problems.append(
            f"the helper row {row['url']} says version {row.get('version')!r}, and the helper is "
            f"{os.environ['MIX_CHECK_HELPER_VERSION']} (T182b, D1)"
        )

if helpers.get(("macos", "x86_64")) != helpers.get(("macos", "aarch64")):
    problems.append("the two macOS helper rows point at different files, and macOS publishes one")

# T88f and T182b, D5. A copy an installer placed is offered its update only through these rows, so a
# release missing one leaves every such machine on the old version, silently. One row per (os, arch,
# kind, flavour), bound by a SHA-256, and never an unversioned alias.
installers = {
    (row["os"], row["arch"], row["kind"], row.get("flavour")): row
    for row in document.get("installers", [])
}
wanted = {
    (system, arch, kind, flavour)
    for system, arch, kind in [
        ("macos", "x86_64", "pkg"),
        ("macos", "aarch64", "pkg"),
        ("linux", "x86_64", "deb"),
        ("linux", "x86_64", "rpm"),
    ]
    for flavour in ["window", "headless"]
}
if set(installers) != wanted or len(document["installers"]) != len(wanted):
    problems.append(f"installer rows {sorted(installers)}, not {sorted(wanted)}")

for key, row in installers.items():
    if not row["url"].endswith("." + key[2]):
        problems.append(f"a {key[2]} installer row that names {row['url']}")
    if (key[3] == "headless") != ("headless" in row["url"]):
        problems.append(f"the {key[3]} row names {row['url']}")
    if len(row.get("sha256", "")) != 64:
        problems.append(f"an installer row without a SHA-256: {row}")

if problems:
    raise SystemExit("\n".join(problems))

print(f"provides: {len(document['artifacts'])} artifact(s), each naming {sorted(expected)}")
print(f"helpers: {len(document['helpers'])} row(s) for {sorted(helpers)}")
print(f"installers: {len(installers)} row(s) for {sorted(installers)}")
PY
