# 0049. A download is named after what it installs

**Status**: Accepted — supersedes decision 5 of
[0044](0044-mixlab-is-the-product-and-mixengine-is-the-engine.md), and the part of roadmap task
T176d that froze `Package: mixengine`. Its list of downloads is amended by
[0053](0053-the-helper-has-its-own-version-and-follows-the-product.md).
**Date**: 2026-09-23

## Context

[ADR 0044](0044-mixlab-is-the-product-and-mixengine-is-the-engine.md) made MixLab the product and
kept MixEngine for the engine inside it and for the headless distribution. Its decision 5 kept every
release artifact's name as it was, `mixengine-<version>-<os>-<arch>…`, because a rename would ripple
through `packaging/feed.sh`, `feed-check.sh` and `sign.sh` and would *"buy a file name"*. Its argument
was that the download page is what labels a file for a person.

**That argument assumed the file stays on the download page, and it does not.** Once downloaded,
`mixengine-0.0.6-windows-x86_64-setup.exe` sits in a Downloads folder, a browser's download list, an
email to a colleague or a company's software catalogue, and none of those show the page it came
from. What a person meets there is a MixEngine installer, and MixEngine is the name ADR 0044 decision
3 gave to the thing *without* a window. A person looking for MixLab can pass over the right file. A
person who wanted the headless build can be handed the one with the window. That is the exact
confusion ADR 0044 was written to end. On Linux it goes one step further: `apt list --installed` and
`dnf info` print the package name, so after the install the product still answers to the other name.

**The ripple is smaller than decision 5 estimated.** Measured against the tree on 2026-09-23:

- **No installed copy reads a payload's file name.** An update follows the `url` in the signed
  `latest.json` and reads each binary's path from `provides`. The file name never enters its logic,
  and `provides` holds paths inside the archive, which this decision does not touch. The one test
  fixture that spells a URL (`updates/feed.rs`) spells it as an example.
- **`sign.sh` signs whatever is in `dist/`.** Only `mixengine-elevate-*` has a trusted comment that
  gets parsed (`HelperStamp`), and the helper keeps its name.
- **Only `packaging/feed.sh` globs payload names.** Its fixtures are `feed-check.sh` and
  `.github/scripts/test-feed.sh`. That is three files.
- **Nothing reads the Linux package name as a constant.** `install::packaged_by` asks
  `dpkg-query -S` and `rpm -qf` who owns a file and uses whatever name comes back
  ([ADR 0048](0048-a-file-a-package-manager-placed-leaves-with-the-package.md)).
- **The installed base is still what ADR 0044 found:** v0.0.1 to v0.0.6, none of them in anybody's
  daily use. Any inbound link to `releases/latest/download/mixengine-…` is younger than this week.

## Decision

**An artifact that installs or carries MixLab is named `mixlab`. An artifact without the window
keeps MixEngine's name.**

1. **With the window, `mixlab-` replaces `mixengine-`, and nothing else in the name moves.** On
   Windows that covers the NSIS installer and the portable zip. On macOS it covers the `.pkg` and the
   update payload `.tar.gz`. On Linux it covers the AppImage, the `.deb`, the `.rpm` and the update
   payload `.tar.gz`. It also covers every unversioned alias `mix_publish_alias` publishes for these
   files. The version, operating system, architecture and suffix keep their places, so
   `mixlab-<version>-<os>-<arch>` becomes the shape `feed.sh` globs.

2. **Without the window, the name stays.** `mixengine-<version>-<os>-<arch>-headless.<ext>` is the
   MixEngine distribution under ADR 0044 decision 3, and its name now says so. The `-headless`
   suffix stays too: until this decision the alias `mixengine-windows-x86_64.zip` served the build
   *with* a window, so an alias that meant something else on the same name would send an old link to
   the wrong product without saying so.

3. **The `.deb` and the `.rpm` are the package `mixlab`, and each takes over from `mixengine`.**
   - The `.deb` declares `Conflicts: mixengine`, `Replaces: mixengine` and `Provides: mixengine`.
     This is Debian's usual way to rename a package: apt removes the old package in the same
     transaction, and nothing leaves both installed.
   - The `.rpm` declares `Provides: mixengine = <version>-<release>` and
     `Obsoletes: mixengine < <version>-<release>`, the usual way to rename a package on Fedora.
   - Neither package gets a maintainer script. The rule that nothing runs at install time
     (the T85 design, D10) is unchanged.

4. **Everything inside an artifact keeps its name.** That covers the payload's top-level
   `mixengine/` directory and every `provides` path, `Programs\MixEngine`, `Software\MixEngine` and
   the NSIS `UNINSTALL_KEY`, the `.pkg` identifier `dev.mixengine.cli`, `/usr/local/libexec/mixengine`
   and the five binaries. It also covers `mixengine-elevate-<version>-<os>-<arch>` and
   `mixengine-api-<version>-typescript.tar.gz`, which are published for a program rather than for a
   person. ADR 0044 decision 2 still holds for every one of these: they are identifiers that an
   installed copy or an elevated process reads, and a rename would reach an installed copy's
   behaviour, which this decision does not.

## Consequences

**Easy.** A file in a Downloads folder is named after the product it installs, and the headless
build is the only thing named MixEngine. `apt remove mixlab` removes what `apt install` put there. An
installed v0.0.x updates across the rename with no change on its side, because it never read the
file name.

**Hard, and accepted.** Every `releases/latest/download/mixengine-…` link to a file with the window
returns `404` from the first release cut after this. The handbook moves in the same commit. Anything
outside it is less than a week old, and the same argument let ADR 0044 give up the handbook's old
address. A Linux machine that installed `mixengine` 0.0.x has it replaced rather than upgraded,
which apt and dnf both show as a removal plus an install. And a release now holds two prefixes side
by side, which is the point: one is the product, the other is the engine alone.

## Alternatives considered

- **Keep decision 5 and rely on the download page.** Refused for the reason in *Context*: the name is
  what survives the download, and the page is not.
- **Also publish the old alias names for a transition period.** Refused. A second name for each file
  doubles the release's asset list to protect links that are a few days old, and it would keep
  pointing someone at "MixEngine" when they wanted the window.
- **Rename the payload's `mixengine/` directory as well.** Refused here. That directory is the one
  identifier an installed copy's updater does meet, through `provides`, and changing it is a question
  about v0.0.x's updater rather than about a file name. If it is ever worth asking, it gets its own
  decision.
- **Rename the headless archives to `mixengine-<version>-<os>-<arch>.<ext>`, without the suffix.**
  Refused for the reason in decision 2: that name was the build with the window until now.
