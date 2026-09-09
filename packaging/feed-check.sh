#!/usr/bin/env bash
# `feed.sh` against a fixture distribution — T85c, D8.
#
# **What this looks at is the shape of the `provides` keys.** `index::format::Artifact` documents
# them as executable *name* to path (`{"php": "php.exe"}`), `updates::apply::binary_name` appends
# this platform's suffix itself, and `updates::apply::stage` looks the smoke-test executable up as
# `mixengined`. A Windows payload described with the `.exe` on the key satisfies none of those, and
# the only sign of it is a `mix self-update` that refuses the release it was just offered.
#
# No packaging tools, and nothing OS-specific: the fixture archives are written by `tar` and by
# `python3`'s own `zipfile`, and `feed.sh` already requires `python3`. So this runs on the machine of
# whoever is editing the script, whichever of the three that is.

set -euo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

version="$(mix_version)"
work="$MIX_OUT/feed-check"
rm -rf "$work"
mkdir -p "$work/dist" "$work/payload/mixengine"

for binary in "${MIX_BINARIES[@]}"; do
  printf 'not a binary\n' >"$work/payload/mixengine/$binary"
done
tar -czf "$work/dist/mixengine-$version-linux-x86_64.tar.gz" -C "$work/payload" mixengine

# The Windows payload, whose entries carry `.exe` — the whole point of the check.
export MIX_CHECK_ZIP="$work/dist/mixengine-$version-windows-x86_64.zip"
export MIX_CHECK_NAMES="${MIX_BINARIES[*]}"
# T106. The window's two names, so the check below can ask about the one payload entry that is a
# directory without spelling either of them a second time.
export MIX_CHECK_WINDOW="$MIX_WINDOW"
export MIX_CHECK_WINDOW_APP="$MIX_WINDOW_APP"

python3 - <<'PY'
import os
import zipfile

with zipfile.ZipFile(os.environ["MIX_CHECK_ZIP"], "w") as archive:
    for name in os.environ["MIX_CHECK_NAMES"].split():
        archive.writestr(f"mixengine/{name}.exe", "not a binary\n")
PY

# **The macOS payload, whose window is a bundle** — T106. `feed.sh` reads `provides` out of the
# archive, and every arm it had skipped a directory: without this leg, the one artifact in this
# product whose window is not a file is the one artifact this script never looks at.
mkdir -p "$work/macos/mixengine/$MIX_WINDOW_APP/Contents/MacOS"
for binary in $(mix_headless_binaries); do
  printf 'not a binary\n' >"$work/macos/mixengine/$binary"
done
printf 'not a binary\n' >"$work/macos/mixengine/$MIX_WINDOW_APP/Contents/MacOS/$MIX_WINDOW"
printf 'not a plist\n' >"$work/macos/mixengine/$MIX_WINDOW_APP/Contents/Info.plist"
tar -czf "$work/dist/mixengine-$version-macos-universal.tar.gz" -C "$work/macos" mixengine

# **The headless archives, which this feed must ignore** — T105, D7. They match the same name globs
# `feed.sh` collects payloads with, and without an exclusion the script reaches its `*)` arm and
# stops the whole `release` job with "is not a payload name this script recognises". An install with
# no window has nothing an update would replace, which `updates::apply`'s own rule 2 already
# guarantees; the feed never needs to describe one.
tar -czf "$work/dist/mixengine-$version-linux-x86_64-headless.tar.gz" -C "$work/payload" mixengine

export MIX_CHECK_HEADLESS_ZIP="$work/dist/mixengine-$version-windows-x86_64-headless.zip"

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
printf 'not a binary\n' >"$work/dist/mixengine-elevate-$version-linux-x86_64"
printf 'not a binary\n' >"$work/dist/mixengine-elevate-$version-windows-x86_64.exe"
printf 'not a binary\n' >"$work/dist/mixengine-elevate-$version-macos-universal"

bash "$MIX_ROOT/packaging/feed.sh" --dist "$work/dist" --version "$version" --tag "v$version"

python3 - "$work/dist/latest.json" <<'PY'
import json
import os
import sys

with open(sys.argv[1], encoding="utf-8") as handle:
    document = json.load(handle)

expected = set(os.environ["MIX_CHECK_NAMES"].split())
window = os.environ["MIX_CHECK_WINDOW"]
bundle = os.environ["MIX_CHECK_WINDOW_APP"]
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

    # T106. On macOS the window is an application bundle, and the value has to name the directory
    # itself: `updates::apply::swap` replaces what that path names as a tree, and a value pointing at
    # the executable inside it would leave the plist, the icon and the version behind.
    if artifact["os"] == "macos" and provides.get(window) != f"mixengine/{bundle}":
        problems.append(
            f"{where} provides {window} as {provides.get(window)}, not mixengine/{bundle}"
        )

# T105. Two payloads went into the fixture and two headless archives beside them; a feed that
# collected all four would list this pair of (os, arch) twice, and `mixengine_core::index` takes the
# first row it matches — so the artifact a machine downloaded would depend on the order a glob
# happened to return.
seen = [(artifact["os"], artifact["arch"]) for artifact in document["artifacts"]]
if len(seen) != len(set(seen)):
    problems.append(f"the feed lists an (os, arch) pair more than once: {sorted(seen)}")

for url in [artifact["url"] for artifact in document["artifacts"]]:
    if "headless" in url:
        problems.append(f"the feed lists a headless archive as an update payload: {url}")

# T88a. The helper is its own asset, so the row that names it is the only thing standing between a
# release and a `mix elevation upgrade` that answers "no privileged helper for this machine" for
# ever. `.exe` on Windows, and one universal macOS file under both architecture rows.
helpers = {(row["os"], row["arch"]): row["url"] for row in document["helpers"]}

for pair in [("linux", "x86_64"), ("windows", "x86_64"), ("macos", "x86_64"), ("macos", "aarch64")]:
    if pair not in helpers:
        problems.append(f"no privileged helper for {pair[0]}/{pair[1]}: {sorted(helpers)}")

if ("windows", "x86_64") in helpers and not helpers[("windows", "x86_64")].endswith(".exe"):
    problems.append(f"the Windows helper is {helpers[('windows', 'x86_64')]}, which Windows will not run")

if helpers.get(("macos", "x86_64")) != helpers.get(("macos", "aarch64")):
    problems.append("the two macOS helper rows point at different files, and macOS publishes one")

if problems:
    raise SystemExit("\n".join(problems))

print(f"provides: {len(document['artifacts'])} artifact(s), each naming {sorted(expected)}")
print(f"helpers: {len(document['helpers'])} row(s) for {sorted(helpers)}")
PY
