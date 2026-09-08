# Releasing MixDB

MixDB is published as GitHub releases, and installed copies update themselves from them: the app
checks a manifest on the newest release, downloads the bundle for its platform, verifies the
signature and — once the user says so — installs it and restarts.

## The steps

The whole thing, for when the rest of this page is more than you need. `0.0.4` stands in for the
version being cut.

```bash
# 1. The notes. Ideally already written, in which case read them over and move on.
npm run notes                        # the commits since the last tag, as a draft to edit down
#    -> edit them into ## [Unreleased] in CHANGELOG.md

# 2. The checks. `ci.yml` runs these on every push; this is the same set by hand.
npm test                             # vitest
npm run build                        # tsc + vite build
(cd src-tauri && cargo clippy --locked --all-targets -- -D warnings && cargo test --locked)

# 3. The bump. Seven files, and it refuses if ## [Unreleased] is empty.
npm run set-version 0.0.4

# 4. The push, then the tag. The tag is what starts the build.
git commit -am "chore(release): 0.0.4"
git push
git tag v0.0.4 && git push origin v0.0.4
```

Then wait 15–25 minutes for the three build jobs, and **on GitHub**:

5. Open the draft release. Its `## Changes` is already filled in from `CHANGELOG.md` — read it over.
6. Click **Publish release**.

Nothing reaches a single installed copy of MixDB until that click. Publishing is also what starts
[`update-notes.yml`](../.github/workflows/update-notes.yml), which copies those notes into
`latest.json` so the update panel in the app shows them.

If the build fails or the bundle turns out bad, delete the draft, fix it, and tag again — a draft
is invisible to the updater.

## Writing the notes

Not a release step — a *working* step. What changed goes into `## [Unreleased]` in
[CHANGELOG.md](../CHANGELOG.md) as the work is finished, because by the time a version is cut
nobody remembers what went into it, and notes reconstructed from memory at that point are always
thinner than the work deserved.

```bash
npm run notes    # the commits since the last tag, grouped, as a draft to edit down
```

That prints a starting point, not the notes: it knows what was done, not which of it a user would
notice. Edit it into plain sentences under `## [Unreleased]` — `feat`, `fix`, `perf`, `refactor`
and `style` commits are listed, the rest are dropped as things nobody outside the repository cares
about.

## Cutting a release

```bash
npm run set-version 0.0.4          # package.json, tauri.conf.json, Cargo.toml, Cargo.lock, README.md, CHANGELOG.md
git commit -am "chore(release): 0.0.4"
git push
git tag v0.0.4 && git push origin v0.0.4
```

`set-version` also cuts `## [Unreleased]` into `## [0.0.4] - <today>` and opens a fresh empty one
above it. It **refuses to bump** when `## [Unreleased]` is empty, before it has touched any of the
other six files — a release whose notes nobody wrote is the thing this is all for. A version that
genuinely has nothing to tell users passes `--no-notes`.

The tag starts [`.github/workflows/release.yml`](../.github/workflows/release.yml), which builds on
three runners in parallel — roughly 15–25 minutes for a cold cache — and attaches every installer,
every `.sig`, and a merged `latest.json` to a **draft** release.

The draft's `## Changes` section is **already filled in**: the build reads the section for the
version it is tagging out of `CHANGELOG.md`
([`.github/scripts/changelog-section.mjs`](../.github/scripts/changelog-section.mjs)). A version
with no section there leaves it empty, which is still fixable by hand on the draft.

Then, on GitHub: open the draft, read the notes over, and click **Publish release**.

Nothing is announced until that click. `/releases/latest/download/latest.json` — the URL the
updater reads — skips drafts, so a build that turns out bad can simply be deleted and re-cut.

**The `## Changes` section becomes the update notes.** It is what the panel in the corner of the
app shows the first line of, so put the headline change at the top of it — in the changelog, where
it starts.

The manifest the updater reads carries those notes, and `tauri-action` writes it *during the build*
— when `## Changes` is still the empty placeholder. So
[`.github/workflows/update-notes.yml`](../.github/workflows/update-notes.yml) runs on **publish**
and on every later **edit** of the body, cuts the `## Changes` section out of it and rewrites the
`notes` field of `latest.json` on the release. It leaves the asset alone when the notes already
match, which is what keeps its own upload from setting it off again.

Nothing else in the manifest is touched — versions, URLs and signatures stay exactly as the build
left them. A release whose notes were fixed while that workflow was broken can be brought up to
date by running it by hand from the Actions tab with the tag as its input.

## What gets built

| Runner | Bundle | Runs on | Self-updates |
| --- | --- | --- | --- |
| `macos-latest` | `.dmg`, `.app` (universal) | Apple Silicon and Intel, macOS 10.13+ | yes |
| `windows-latest` | `.exe` (NSIS) | Windows 10 and 11, x64 | yes |
| `ubuntu-22.04` | `.AppImage`, `.deb` | glibc 2.35+ distributions | AppImage only |

No Mac is needed to build the macOS bundle: GitHub's macOS runners do it, and they are free for
public repositories.

The `.msi` was dropped when self-updating went in. It installs per-machine, the NSIS installer the
updater uses installs per-user, and shipping both would have left some users with two MixDBs in two
places, only one of which ever updated.

## The site's download links

[site/index.html](../site/index.html) links each OS straight to an installer instead of to the
releases page, using four version-less names that `merge-manifest` uploads alongside the real,
versioned ones once every platform has finished building:

| Alias | Points at |
| --- | --- |
| `MixDB-windows-x64-setup.exe` | the NSIS installer |
| `MixDB-macos-universal.dmg` | the universal `.dmg` |
| `MixDB-linux-x64.AppImage` | the AppImage |
| `MixDB-linux-x64.deb` | the `.deb` |

Each is just a copy of that release's real asset, re-uploaded with `--clobber` under the fixed
name. `https://github.com/mixnz/mixdb/releases/latest/download/<alias>` then always resolves
against whichever release is newest — the site never needs an edit when a version ships. A
platform whose build failed leaves its alias untouched on the previous release rather than
missing entirely, the same tolerance `build-manifest.mjs` has for a missing `.sig`.

This is a different thing from the Store URL below, which must stay versioned — these aliases are
extra assets for a human clicking a button, not the one URL a certification remembers.

## Signing

Two different things are called signing here, and only one of them is done.

### The update key — done

A [minisign](https://jedisct1.github.io/minisign/) key pair, generated once with
`npm run tauri signer generate`. Every bundle the workflow builds is signed with the private half;
every installed copy of MixDB checks that signature against the public half before it runs a single
byte of an update.

| Half | Lives in |
| --- | --- |
| Public | `plugins.updater.pubkey` in [`tauri.conf.json`](../src-tauri/tauri.conf.json) — public by design, committed |
| Private | The `TAURI_SIGNING_PRIVATE_KEY` repository secret, and a backup off this machine |
| Its password | The `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` repository secret |

**Losing the private key strands every copy already installed.** They will keep checking, keep
finding releases, and reject every one of them, because a new key means a new `pubkey` and the copy
in their hands has the old one. The only way back is asking every user to download and install by
hand. Back it up.

A build without those secrets still succeeds — it just produces artifacts nobody can install. If
the updater goes quiet after a release, look at the secrets first.

### Code signing — not done

MixDB ships without an Authenticode certificate or an Apple Developer ID, and the price of that
falls entirely on the **first** install:

- **Windows.** SmartScreen shows "Windows protected your PC" over a blue panel. The **Run anyway**
  button is behind **More info**, which is easy to miss. Nothing is blocked outright.
  Removing it needs an Authenticode certificate — an OV one is roughly $200–400 a year and still
  has to build up reputation before the warning stops; an EV one at $300–600 a year clears it
  immediately.
- **macOS.** Stricter. An unsigned, un-notarized app is refused on first open, and recent macOS
  versions word it as the app being *damaged*, which reads as a broken download rather than as a
  policy. The way through is right-click → **Open**, or `xattr -cr /Applications/MixDB.app`.
  Removing it needs the Apple Developer Program at $99 a year, a Developer ID certificate, and
  notarization as part of the build.
- **Linux.** Nothing to do beyond `chmod +x` on the AppImage.

Updates raise none of that again, which is the point of having them:

- Windows' SmartScreen prompt is triggered by the mark-of-the-web a **browser** attaches to a
  download. The updater fetches the installer itself, so the file carries no such mark. The NSIS
  installer runs per-user, so there is no UAC prompt either.
- macOS' Gatekeeper prompt is triggered by the quarantine attribute, which the updater does not
  set. It replaces the `.app` in place and the next launch is silent.

So the release notes still have to carry the first-launch instructions — the template in the
workflow does — but a user only reads them once.

### When a certificate arrives

The plan is SignPath Foundation, which signs open-source projects for free with the key held in an
HSM. That is why MixDB is GPL-3.0 — the reasoning is in
[`.agent/decisions/2026-08-31-gpl-and-signpath-for-free-code-signing.md`](../.agent/decisions/2026-08-31-gpl-and-signpath-for-free-code-signing.md).
What follows applies to any Windows certificate, however it is obtained.

**The trap, first, because getting it wrong breaks every installed copy.** `createUpdaterArtifacts`
makes Tauri write the `.sig` beside the installer *during* `tauri build`. The obvious way to add
signing — build, upload the artifact, send it away to be signed, put the signed one back — changes
the installer's bytes **after** that `.sig` was computed over the unsigned ones. The signature no
longer matches the file. Nothing fails at release time; the failure lands later, on every user, as
an update their copy refuses to install. There is no way to reach them afterwards except by asking
them to download the installer by hand.

So the Authenticode signature has to exist before the updater signature is made. Two orders do that:

- **Sign during bundling.** `bundle.windows.signCommand` in `tauri.conf.json` is invoked for each
  file with `%1` as its path, before the NSIS bundle is assembled and therefore before the `.sig`
  is written. This also signs `MixDB.exe` inside the installer rather than only the installer
  itself. It needs signing to complete unattended, without a human approving each request.
- **Sign after, then re-sign for the updater.** Authenticode-sign the finished installer, then run
  `tauri signer sign` over the *signed* file and rebuild `latest.json` from that. Fewer moving
  parts, and it suits a signing service that queues requests — but only the installer ends up
  signed.

Prefer the first if the service will sign unattended. An installed `MixDB.exe` with no signature is
a loose end even once SmartScreen is satisfied.

**Four files change, not one:**

- `.github/workflows/release.yml` — the signing step, and the release-notes template, which
  currently tells every reader that MixDB is not code-signed.
- `src-tauri/tauri.conf.json` — `signCommand`, if signing happens during bundling.
- This file — the section above says signing is not done.
- `site/code-signing/` — the published policy opens by saying it is not yet in effect.

**Verify on a pre-release, never on a real one.** Publish the first signed build marked as a
pre-release, install an older MixDB on a clean machine, and let it update itself to it. That
exercises the one thing that cannot be undone. A `.sig` mismatch found there costs a tag; found on
a real release it strands everyone who had the app installed.

## How updating works

Implemented in [`src/shell/update.ts`](../src/shell/update.ts), on top of Tauri's updater plugin. It:

- waits 6 seconds after launch so it does not land on top of the connection form;
- GETs `https://github.com/mixnz/mixdb/releases/latest/download/latest.json` and compares
  its version against the running one;
- shows a panel in the corner offering **Update now**, **Later** (comes back next launch) and
  **Skip this one** (silences that version only, and can be undone in Settings);
- on **Update now**, downloads the bundle with a progress bar while the app carries on running;
- when it is on disk, asks again before **Install and restart** — installing closes MixDB, and a
  user with a half-written query should be the one choosing when that happens;
- lights the **MixDB** button in the tab bar for as long as an unhandled update exists, so the
  corner panel can be dismissed without the news being lost. A download waved away mid-flight
  carries on behind it.

On Windows the installer is what closes and reopens the app; on macOS and Linux the files are
swapped underneath the running process, which then calls `relaunch()` itself.

Four things must hold for it to work:

- the version in `tauri.conf.json` is the real one — the app reports that, not `package.json`.
  This is why `npm run set-version` exists rather than editing files by hand;
- `bundle.createUpdaterArtifacts` stays `true`, and `includeUpdaterJson` stays on in the workflow;
- the two signing secrets are set on the repository;
- the bundle identifier stays `io.github.haiquang9994.mixdb`. It names the app on the machine, not
  the repository it is built from. The repository moved to `mixnz/mixdb`; the identifier did not,
  because changing it installs a second MixDB beside every existing one, strands that copy's
  settings and leaves it with no upgrade path.

Nothing about it needs the webview's CSP: the request, the signature check and the install all
happen in Rust.

## Testing an update before publishing

The updater only ever looks at the published latest release, so the honest way to test is to have
one. Publish a release one version ahead of an old build kept for the purpose, or point
`plugins.updater.endpoints` at a local file server during development.

Do not test by publishing to the real repository and deleting it afterwards — anyone who launched
MixDB in that window has already downloaded it.

## Microsoft Store

The Store lists MixDB as an EXE app, which means it hosts nothing: it downloads the installer from
a URL on this repository's releases and runs it silently. The file a Store customer installs is the
same file everyone else downloads. There is no separate Store build, and Microsoft signs nothing —
see *Signing* above for who does.

**The package URL is versioned, and its bytes must never change afterwards.** That is a Store rule,
not a convention: Microsoft keeps a copy of what passed certification, notices when the file at the
URL is swapped, and re-certifies it behind your back. It happens to cost nothing here, because the
release assets already carry the version in the filename —

```
https://github.com/mixnz/mixdb/releases/download/v0.0.26/MixDB_0.0.26_x64-setup.exe
```

— and a published GitHub release asset is immutable. Two things follow. Never delete and re-upload
an asset on a tag that has been submitted. And never point the Store at
`releases/latest/download/…`, tempting as a stable URL looks.

**Each release the Store should offer needs an Update submission** with a new versioned URL, and it
goes through certification again. This is less urgent than it sounds: MixDB updates itself, so
people who installed from the Store get new versions whether or not a submission followed.
Re-submitting serves *new* Store installs and stops the listed version drifting. Batching several
patch releases into one submission is reasonable.

**Supply the GPL as custom licence terms on the listing.** Left at the default, a Store app falls
under Microsoft's Standard Application License Terms, which conflict with the GPL. Their terms
permit that conflict only "to the extent required by the FOSS that you use", and only when the
developer's own terms are given. Accepting the default would put the listing in breach of the
project's own licence.

Two fields are easy to get wrong for an EXE app. **Installer parameters** must make the installer
run silently — Tauri's NSIS installer takes `/S`, which is worth testing on a clean machine before
submitting, because a wrong switch fails every install the Store attempts. **Installer handling**
maps the installer's exit codes onto the situations the Store has wording for (already installed,
reboot required, disk full); it is optional, and it is what decides whether a failed install tells
the user anything useful.
