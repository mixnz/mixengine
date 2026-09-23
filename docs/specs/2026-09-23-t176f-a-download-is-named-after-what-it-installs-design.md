---
status: implemented
date: 2026-09-23
task: T176f
---

# T176f: A download is named after what it installs

Roadmap task **T176f**, [phase 29](../roadmap/phase-29-one-name-to-find-it-by.md), on
[ADR 0049](../decisions/0049-a-download-is-named-after-what-it-installs.md), which supersedes
decision 5 of [ADR 0044](../decisions/0044-mixlab-is-the-product-and-mixengine-is-the-engine.md).

## Goal

Every file a release publishes that installs or carries MixLab is named `mixlab-…`, and the Linux
packages are the package `mixlab`. The headless archives, the privileged helper and the API contract
keep MixEngine's name. No identifier inside an artifact changes, and an installed v0.0.x updates
across the rename with no change on its side.

## Decisions

### D1. The names

`<v>` is `mix_version`. In the `.deb` and the `.rpm` it is `mix_native_version`, as it is today.
`<label>` is `universal`, or `arm64` on a CI branch (T171c).

| OS | Today | After |
| --- | --- | --- |
| Windows | `mixengine-<v>-windows-<arch>-setup.exe` | `mixlab-<v>-windows-<arch>-setup.exe` |
| | `mixengine-<v>-windows-<arch>.zip` (portable, payload) | `mixlab-<v>-windows-<arch>.zip` |
| | `mixengine-<v>-windows-<arch>-headless.zip` | unchanged |
| macOS | `mixengine-<v>-macos-<label>.pkg` | `mixlab-<v>-macos-<label>.pkg` |
| | `mixengine-<v>-macos-<label>.tar.gz` (payload) | `mixlab-<v>-macos-<label>.tar.gz` |
| | `mixengine-<v>-macos-<label>-headless.tar.gz` | unchanged |
| Linux | `mixengine-<v>-linux-<arch>.AppImage` | `mixlab-<v>-linux-<arch>.AppImage` |
| | `mixengine_<v>-1_<debarch>.deb` | `mixlab_<v>-1_<debarch>.deb` |
| | `mixengine-<v>-1.<arch>.rpm` | `mixlab-<v>-1.<arch>.rpm` |
| | `mixengine-<v>-linux-<arch>.tar.gz` (payload) | `mixlab-<v>-linux-<arch>.tar.gz` |
| | `mixengine-<v>-linux-<arch>-headless.tar.gz` | unchanged |
| every leg | `mixengine-elevate-<v>-<os>-<arch>` | unchanged |
| release | `mixengine-api-<v>-typescript.tar.gz`, `latest.json` | unchanged |

**The unversioned aliases follow their files.** `mix_publish_alias` in `packaging/common.sh` is
called with the new name at every call site that gets a `mixlab-` file. The aliases that change are
`mixlab-windows-<arch>-setup.exe`, `mixlab-windows-<arch>.zip`, `mixlab-macos-<label>.pkg`,
`mixlab-linux-<arch>.AppImage`, `mixlab_<debarch>.deb` and `mixlab-<arch>.rpm`. The headless aliases
do not change.

**The prefix is written once per script, not once per line.** Each build script today spells
`mixengine-` inline, both in its versioned name and in its alias. The work adds
`MIX_ARTIFACT=mixlab` and `MIX_HEADLESS_ARTIFACT=mixengine` to `common.sh`, next to `MIX_WINDOW`,
and every name is built from one of those two. A future script then has to pick one of them, and
cannot quietly copy the prefix it saw in a neighbouring script.

### D2. What does not move, and why each one

| Kept | Read by |
| --- | --- |
| the payload's top-level `mixengine/` directory and each `provides` path | an installed copy's updater, through the signed feed |
| `Programs\MixEngine`, `Software\MixEngine`, the NSIS `UNINSTALL_KEY` | `install::program_dirs`, and an existing install finding itself |
| the `.pkg` identifier `dev.mixengine.cli` | macOS's receipt database, which tells an upgrade apart from a second install |
| `/usr/local/libexec/mixengine/mixengine-elevate` | `install::helper_path()` and the elevated process |
| the five binaries | `MIX_BINARIES`, `packaging.rs`, everything |
| `mixengine-elevate-<v>-<os>-<arch>` | `HelperStamp`, through the signature's trusted comment |
| the CI artifact names `mixengine-<os>` in `_build.yml` / `_release.yml` | the `release` job's `pattern: mixengine-*`; not a file name anybody downloads |

The last row is listed because a `grep mixengine-` over `.github/` finds it and it looks like part of
this work. It is not: it names an Actions artifact, a zip the `release` job unpacks into `dist/`, and
no person ever sees that name.

### D3. The Linux packages become `mixlab`

**`.deb`** (`packaging/linux/build-deb.sh`, the control heredoc):

```text
Package: mixlab
Provides: mixengine
Conflicts: mixengine
Replaces: mixengine
```

This is Debian's standard rename idiom. A package may conflict with a virtual package it provides
itself, and dpkg does not count that as a self-conflict. With a real `mixengine` 0.0.x installed,
`apt install ./mixlab_….deb` removes it in the same transaction, and `Replaces:` lets the new package
take over the paths the old one owned (`/usr/bin/mix` and the rest). The existing check that reads
the package back with `dpkg-deb -f` is extended to `Package`, `Conflicts` and `Replaces`, for the
reason given where it already checks `Depends:`: nothing else reads the heredoc.

**`.rpm`** (`packaging/linux/mixengine.spec.in`, renamed `mixlab.spec.in`):

```text
Name:       mixlab
Provides:   mixengine = %{version}-%{release}
Obsoletes:  mixengine < %{version}-%{release}
```

This is Fedora's package-renaming guideline. `build-rpm.sh` writes `SPECS/mixlab.spec`, picks up
`RPMS/<arch>/mixlab-<v>-1.<arch>.rpm`, and adds `rpm -qp --provides` and `--obsoletes` checks beside
its existing `--requires` and `--recommends` checks.

**Neither package gets a scriptlet.** A rename that needed one would break the rule that nothing runs
at install time (the T85 design, D10), and the fields above are enough without one.

**`Maintainer:` and the `.deb`'s `Description:` stay as they are.** They are metadata, not names, and
changing them is copy-editing that does not belong in this task.

### D4. The feed globs the new prefix

`packaging/feed.sh` collects `"$dist/$MIX_ARTIFACT-$version-{windows,linux,macos}-"*` in place of
`mixengine-$version-…`. **The `*-headless.*` skip stays** although a headless archive no longer
matches the glob. It costs one line, and without it, a headless archive that one day took the
product's prefix would become a second feed row for its (os, arch) pair without anyone noticing.

The script's comment about what a headless name looks like is updated to the new pair of prefixes.

`feed-check.sh` and `.github/scripts/test-feed.sh` build their fixture archives under the new
payload names. `.github/scripts/test-sign.sh` renames its two fixture files. What each one asserts
stays the same; only the fixture names change.

### D5. The probes

`packaging/windows/probe.sh` and `packaging/macos/probe.sh` open the setup/zip and the `.pkg` by
name. Both build that name from `MIX_ARTIFACT`. `macos/probe.sh`'s working copy `mixengine.pkg`
becomes `mixlab.pkg`, so that its report names the file the release published.

### D6. The documents

| File | Change |
| --- | --- |
| `docs/guide/en/install.md`, `docs/guide/vi/install.md` | every link and every file name with the window, including the `dpkg -i`, `rpm -i`, `installer -pkg` and AppImage command lines |
| `docs/guide/en/uninstalling.md`, `docs/guide/vi/uninstalling.md` | `dpkg -r mixlab`, `rpm -e mixlab` |
| `packaging/README.md` | the artifact table, the alias example, and the payload shape |
| `docs/operations/build-and-release.md` | the payload shape at line 254 |
| `packaging/linux/AppRun`, `apprun-check.sh` | the example command line in a comment |
| `scripts/set-version.mjs` | the example name in a comment |
| `docs/roadmap/phase-29-one-name-to-find-it-by.md` | T176f, and a note under T176d that ADR 0049 changed its answer |
| `docs/decisions/0044-…`, `docs/decisions/README.md` | 0044's status line names 0049 as superseding decision 5; 0049 enters the index |

The Vietnamese pages are edited by hand alongside the English ones (ADR 0044 decision 4), and then
`bash packaging/docs.sh --restamp`. **Accepted specs, ADRs and ticked roadmap entries are not
edited.** They record what was true when they were written, and the old names in them are history,
not stale text.

### D7. A test that holds the handbook to the scripts

`crates/mixengine-core/tests/packaging.rs` already holds both `install.md` pages to the floors in
`common.sh`. This task adds one more assertion over the same two constants. Every
`releases/latest/download/<name>` link in them either starts with `MIX_ARTIFACT` or contains
`-headless` and starts with `MIX_HEADLESS_ARTIFACT`. A link that fits neither fails the test and names
the link. The test cannot tell whether the file exists; it catches the drift this task is most likely
to leave behind, which is one link in one language still pointing at the old prefix.

## Error handling

This work adds no new failure paths. Every build script's check for "the artifact holds what it
should" already runs against the name the script just wrote, so a script that wrote one name and
checked another fails immediately at build time, not after the release is published.

## Testing

- `bash packaging/feed-check.sh` and `bash .github/scripts/test-feed.sh`: the feed collects the new
  payload names and still skips headless ones.
- `bash .github/scripts/test-sign.sh`.
- `cargo test -p mixengine-core --test packaging`: D7, and the existing checks on `MIX_BINARIES`.
- `bash packaging/windows/build.sh` on this machine: the three Windows artifacts and their aliases
  under the new names, with the NSIS contents check green.
- **The `.deb` and the `.rpm` in WSL**: build both, install the `mixengine` 0.0.6 package from the
  v0.0.6 release first, then install the new one over it and read `dpkg -l` / `rpm -qa`. The expected
  result is `mixlab` installed, `mixengine` gone, and `/usr/bin/mix` present. That is the only real
  check that the D3 fields work, because `dpkg-deb -f` only shows that the fields were written.
- The macOS `.pkg` and the AppImage are left to CI's `build` job, which already runs their scripts'
  own checks and `macos/probe.sh`.
- `node scripts/check-docs.mjs` and `bash packaging/docs.sh --check`.

## Out of scope, deliberately

- The payload's `mixengine/` directory, `Programs\MixEngine`, the `.pkg` identifier and every other
  identifier in D2 (ADR 0049 decision 4).
- `Maintainer:`, `Description:` and the `mix` command line's vocabulary.
- Keeping the old alias names published for a transition period (ADR 0049, *Alternatives considered*).
