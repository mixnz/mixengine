#!/usr/bin/env bash
# Write `latest.json` — what an installed MixEngine reads to find out that a newer one exists.
#
# Roadmap task T88, the design's D13.
# Design: docs/specs/2026-09-04-t88-self-update-design.md
#
# **Run in the `release` job, before `sign.sh`, and nowhere else.** The feed lists the payload
# archives of *every* leg, and no build leg can see the other four; and it is signed by being in the
# distribution directory when the signing step runs, which is what puts `latest.json.minisig` beside
# it under the name `mixengine_core::index::Client` appends.
#
# **The notes come from `git` and not from GitHub.** The release job's order is: gather the legs,
# sign, create the draft with `--generate-notes`, upload. So the notes GitHub generates do not exist
# until after the signing is over, and a document signed before them cannot contain them. Re-signing
# afterwards would put the private key on the machine of whoever edits the draft, which is the one
# thing T86 arranged not to need. What this writes instead is the tag's own commit subjects, and a
# `notes_url` pointing at the page somebody may have edited afterwards.

source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

mix_require python3

dist="$MIX_OUT/dist"
tag=""
repo="mixnz/mixlab"
version=""

while [ $# -gt 0 ]; do
  case "$1" in
    --dist)
      dist="$2"
      shift 2
      ;;
    --tag)
      tag="$2"
      shift 2
      ;;
    --repo)
      repo="$2"
      shift 2
      ;;
    --version)
      version="$2"
      shift 2
      ;;
    *)
      echo "unknown argument: $1" >&2
      exit 64
      ;;
  esac
done

[ -n "$version" ] || version="$(mix_version)"
[ -n "$tag" ] || tag="v$version"

# The strict spelling `mixengine_core::index::format::Timestamp` parses, and the only one it does.
now="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

# **The tag's own commit subjects.** An empty answer is the first release rather than an error, and
# a repository with no history at all — a fixture — is the same case.
previous="$(git -C "$MIX_ROOT" describe --tags --abbrev=0 "$tag^" 2>/dev/null || true)"
if [ -n "$previous" ]; then
  notes="$(git -C "$MIX_ROOT" log --format='%s' "$previous..$tag" 2>/dev/null || true)"
else
  notes="$(git -C "$MIX_ROOT" log --format='%s' -20 "$tag" 2>/dev/null || true)"
fi
[ -n "$notes" ] || notes="See the release page for what changed."

# Every payload archive, and no installer among them: an installer is not something `update.apply`
# can unpack. **Since T182b, D5 the only payload is the Windows zip**: the per-user Windows install is
# the one copy an updater may swap in place, and every other system updates through its installer,
# listed in the `installers` array below.
#
# **And never a headless archive** — T105, D7. Those are named
# `mixengine-<version>-<os>-<arch>-headless.<ext>`, and an updater has no use for one: an install
# with no window has nothing an update would replace, which `updates::apply`'s rule 2 already
# guarantees. Since T176f they no longer match the globs below, which take `MIX_ARTIFACT`; the skip
# stays anyway, because a headless archive that one day took the product's prefix would otherwise be
# a second row for an (os, arch) pair that already has one, and a client takes the first it matches.
shopt -s nullglob
payloads=()
for file in "$dist/$MIX_ARTIFACT-$version-windows-"*.zip; do
  case "$file" in
    *-headless.zip) continue ;;
  esac
  [ -f "$file" ] && payloads+=("$file")
done

if [ ${#payloads[@]} -eq 0 ]; then
  echo "no update payloads in $dist for $version" >&2
  exit 1
fi

# One row per (os, arch). macOS is universal — one archive, two architectures — so its file produces
# two rows pointing at the same URL, which is what keeps `Arch` a closed enum of two variants and a
# client's lookup a match on the pair it already has (the design, D6).
rows=""
for file in "${payloads[@]}"; do
  name="$(basename "$file")"
  size="$(wc -c <"$file" | tr -d ' ')"

  if [ -f "$file.sha256" ]; then
    sha="$(cut -d' ' -f1 <"$file.sha256")"
  else
    sha="$(sha256sum "$file" | cut -d' ' -f1)"
  fi

  # **Read out of the archive rather than assumed**, on `build.sh`'s own rule: an empty archive is a
  # perfectly valid archive, and this is the step that would notice. `provides` maps each executable
  # name to its path inside the payload, which is exactly what `core::install` reads.
  case "$name" in
    *.zip) entries="$(unzip -Z1 "$file")" ;;
    *.tar.gz) entries="$(tar -tzf "$file")" ;;
    *)
      echo "$name is not an archive shape this script can open" >&2
      exit 1
      ;;
  esac

  provides=""
  bundled=""
  for entry in $entries; do
    # **The window on macOS is a directory** — roadmap task T106. Every arm below skips one: a
    # trailing-slash entry is a directory and `mixengine/*/*` is something inside one, so a payload
    # carrying `MixLab.app` would be described as four binaries and no window — and `updates::apply`
    # would go on keeping a window it was never offered, silently, for every release after it.
    # Emitted once however many entries the bundle holds, and keyed on `MIX_WINDOW_APP` rather than
    # on the operating system: only the macOS payload ever contains that directory.
    case "$entry" in
      "mixengine/$MIX_WINDOW_APP" | "mixengine/$MIX_WINDOW_APP/" | "mixengine/$MIX_WINDOW_APP/"*)
        bundled=yes
        continue
        ;;
    esac

    case "$entry" in
      mixengine/*/* | */) continue ;;
      mixengine/*) ;;
      *) continue ;;
    esac

    # **The key is the executable's name without its extension; the value keeps it.** That is what
    # `index::format::Artifact::provides` documents (`{"php": "php.exe"}`), what
    # `updates::apply::binary_name` assumes when it appends `EXE_SUFFIX` itself, and what
    # `updates::apply::stage` looks the smoke-test executable up by. Written with the `.exe` on the
    # key, a Windows payload offered `mixengined.exe` while every reader asked for `mixengined`, so
    # `mix self-update` refused its own release with `MissingFromArtifact` — T85c, D8.
    # `packaging/feed-check.sh` is what notices, and it reproduced exactly that.
    binary="${entry#mixengine/}"
    binary="${binary%.exe}"
    provides="$provides$binary=$entry"$'\n'
  done

  if [ -n "$bundled" ]; then
    provides="$provides$MIX_WINDOW=mixengine/$MIX_WINDOW_APP"$'\n'
  fi

  if [ -z "$provides" ]; then
    echo "$name holds no binaries under mixengine/" >&2
    exit 1
  fi

  case "$name" in
    *-windows-x86_64.zip) pairs="windows x86_64" ;;
    *-windows-aarch64.zip) pairs="windows aarch64" ;;
    *)
      echo "$name is not a payload name this script recognises" >&2
      exit 1
      ;;
  esac

  while read -r os arch; do
    [ -n "$os" ] || continue
    rows="$rows$os $arch https://github.com/$repo/releases/download/$tag/$name $sha $size"$'\n'
    rows="$rows--provides"$'\n'"$provides--end"$'\n'
  done <<<"$pairs"
done

# The privileged helper of each leg, published as its own asset — roadmap task T88a. The installed
# copy is replaced by the helper itself, which checks this file against the `.minisig` `sign.sh`
# puts beside it; this is where the feed says where they are.
#
# macOS publishes one universal helper listed under both architecture rows, exactly as its payload
# archive is — the T88 design's D6, one artifact along.
helpers=""
# Named and stamped by the helper's own version, not the release's — T182b, D1.
helper_version="$(mix_helper_version)"
for file in "$dist/mixengine-elevate-$helper_version-"*; do
  case "$file" in
    *.sha256 | *.minisig) continue ;;
  esac
  [ -f "$file" ] || continue

  name="$(basename "$file")"
  size="$(wc -c <"$file" | tr -d ' ')"
  rest="${name#mixengine-elevate-"$helper_version"-}"
  rest="${rest%.exe}"
  helper_os="${rest%%-*}"
  helper_arch="${rest#*-}"
  url="https://github.com/$repo/releases/download/$tag/$name"

  case "$helper_os-$helper_arch" in
    macos-universal)
      helpers="$helpers"$'\n'"macos x86_64 $url $size $helper_version"
      helpers="$helpers"$'\n'"macos aarch64 $url $size $helper_version"
      ;;
    windows-* | linux-* | macos-*)
      helpers="$helpers"$'\n'"$helper_os $helper_arch $url $size $helper_version"
      ;;
    *)
      echo "$name is not a helper name this script recognises" >&2
      exit 1
      ;;
  esac
done

if [ -z "$helpers" ]; then
  echo "no privileged helpers in $dist for $version" >&2
  exit 1
fi

# The installers — roadmap task T88f, ADR 0050, and T182b, D5. A copy an installer placed owns
# root-owned files the in-place swap cannot reach, so it is updated by the next installer of its own
# kind: the `.pkg` handed to Installer.app, the `.deb` and the `.rpm` through the command `mix
# self-update` prints. Each is bound by its SHA-256 inside this signed document, as a payload is. The
# universal `.pkg` is listed under both Mac rows.
#
# **Two flavours of each**: the package with the window and the headless one. The updater hands a
# machine the flavour it has, told apart by whether the window is installed.
#
# By the versioned name only: every Linux package also has an unversioned alias beside it for the
# handbook's links, and that is the same file under a name no release can be told apart by.
native="$(printf '%s' "$version" | tr '+-' '~~')"
installers=""
for file in "$dist/$MIX_ARTIFACT-$version-macos-"*.pkg \
  "$dist/$MIX_HEADLESS_ARTIFACT-$version-macos-"*-headless.pkg \
  "$dist/${MIX_ARTIFACT}_$native-1_"*.deb \
  "$dist/${MIX_HEADLESS_ARTIFACT}-headless_$native-1_"*.deb \
  "$dist/$MIX_ARTIFACT-$native-1."*.rpm \
  "$dist/$MIX_HEADLESS_ARTIFACT-headless-$native-1."*.rpm; do
  [ -f "$file" ] || continue

  name="$(basename "$file")"
  size="$(wc -c <"$file" | tr -d ' ')"

  case "$name" in
    *-headless.pkg | *-headless_* | *-headless-*) flavour=headless ;;
    *) flavour=window ;;
  esac

  case "$name" in
    *.pkg) targets="macos x86_64 pkg
macos aarch64 pkg" ;;
    *_amd64.deb) targets="linux x86_64 deb" ;;
    *_arm64.deb) targets="linux aarch64 deb" ;;
    *.x86_64.rpm) targets="linux x86_64 rpm" ;;
    *.aarch64.rpm) targets="linux aarch64 rpm" ;;
    *)
      echo "$name is not an installer name this script recognises" >&2
      exit 1
      ;;
  esac

  if [ -f "$file.sha256" ]; then
    sha="$(cut -d' ' -f1 <"$file.sha256")"
  else
    sha="$(sha256sum "$file" | cut -d' ' -f1)"
  fi

  url="https://github.com/$repo/releases/download/$tag/$name"
  while read -r os arch kind; do
    installers="$installers"$'\n'"$os $arch $kind $url $sha $size $flavour"
  done <<<"$targets"
done

# A release with a helper for macOS or Linux and no installer for it would leave every such machine
# offered nothing — the installer is the only way those systems update now — and nothing else would
# notice.
for system in macos linux; do
  if printf '%s' "$helpers" | grep -q "^$system " &&
    ! printf '%s' "$installers" | grep -q "^$system "; then
    echo "no $system installer in $dist for $version, and the feed lists a $system helper" >&2
    exit 1
  fi
done

# **Written by `python3` and not by `printf`**, because `notes` carries commit subjects and those
# contain quotes, backslashes and newlines. `jq` is deliberately not reached for: `common.sh` already
# records that it is not on a Git Bash install, and a release has to be buildable by hand on the
# machine that cut it.
export MIX_FEED_ROWS="$rows"
export MIX_FEED_HELPERS="$helpers"
export MIX_FEED_INSTALLERS="$installers"
export MIX_FEED_NOW="$now"
export MIX_FEED_VERSION="$version"
export MIX_FEED_NOTES="$notes"
export MIX_FEED_NOTES_URL="https://github.com/$repo/releases/tag/$tag"

python3 - >"$dist/latest.json" <<'PY'
import json
import os

rows = []
lines = os.environ["MIX_FEED_ROWS"].splitlines()
index = 0
while index < len(lines):
    line = lines[index]
    if not line.strip():
        index += 1
        continue

    os_name, arch, url, sha256, size = line.split(" ")
    index += 1
    assert lines[index] == "--provides", lines[index]
    index += 1

    provides = {}
    while lines[index] != "--end":
        name, path = lines[index].split("=", 1)
        provides[name] = path
        index += 1
    index += 1

    rows.append(
        {
            "os": os_name,
            "arch": arch,
            "url": url,
            "sha256": sha256,
            "size": int(size),
            "provides": provides,
        }
    )

helpers = []
for line in os.environ["MIX_FEED_HELPERS"].splitlines():
    if not line.strip():
        continue

    os_name, arch, url, size, version = line.split(" ")
    helpers.append(
        {"os": os_name, "arch": arch, "url": url, "size": int(size), "version": version}
    )

installers = []
for line in os.environ["MIX_FEED_INSTALLERS"].splitlines():
    if not line.strip():
        continue

    os_name, arch, kind, url, sha256, size, flavour = line.split(" ")
    installers.append(
        {
            "os": os_name,
            "arch": arch,
            "kind": kind,
            "url": url,
            "sha256": sha256,
            "size": int(size),
            "flavour": flavour,
        }
    )

document = {
    "schema": 1,
    "generated_at": os.environ["MIX_FEED_NOW"],
    "version": os.environ["MIX_FEED_VERSION"],
    "published_at": os.environ["MIX_FEED_NOW"],
    "notes": os.environ["MIX_FEED_NOTES"].strip(),
    "notes_url": os.environ["MIX_FEED_NOTES_URL"],
    "artifacts": rows,
    "helpers": helpers,
    "installers": installers,
}

print(json.dumps(document, indent=2, sort_keys=True))
PY

# **Read back what was written.** A feed that is not JSON, or that lists nothing, is a release whose
# updater is broken in a way nobody would notice until the release after it.
python3 - "$dist/latest.json" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as handle:
    document = json.load(handle)

if not document["artifacts"]:
    raise SystemExit("the feed lists no artifacts")

# T88a. A release whose helper rows are missing is one where no installed helper can be replaced
# from the download, and nothing else would notice.
if not document["helpers"]:
    raise SystemExit("the feed lists no privileged helpers")

print(
    f"latest.json: {document['version']}, {len(document['artifacts'])} artifact(s), "
    f"{len(document['helpers'])} helper(s), {len(document['installers'])} installer row(s)"
)
PY
