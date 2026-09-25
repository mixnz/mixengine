# 0053. The helper has its own version and follows the product through the daemon

**Status**: Accepted. It amends the T85 design's D5 (which copy of the helper runs a batch), T88a (a
replacement no longer waits to be asked for, and `mix elevation upgrade` goes), the list of
downloads in [0049](0049-a-download-is-named-after-what-it-installs.md), and extends
[0050](0050-a-copy-the-pkg-installed-is-updated-by-the-pkg.md) to the Linux packages.
**Date**: 2026-09-25

## Context

The first real Windows uninstall of MixLab failed, and the daemon's log said why. The installed
`mixengine-elevate` was `0.1.0`, placed three weeks earlier, older than every operation an uninstall
needs. Nothing could ever replace it:

- the daemon installed a helper only when none was there;
- `mix self-update` never touched the helper (`updates::apply::KEPT`);
- `mix elevation upgrade`, the one way to replace it, needed the old helper to know `helper-replace`,
  which it did not;
- reinstalling MixLab placed a new copy beside the program and left the installed one alone.

So a machine could keep a helper too old for what the product asks of it, for ever. The product had
three ways of installing the helper and none for keeping it current. Each installer format had
grown its own story (the `.pkg` as root, the `.deb` and the `.rpm` as root, the zips, the tarball and
the AppImage as the user), and none of them agreed on what happens at the next release.

The helper also reported the product's version. Two releases' helpers therefore always differed, so
any rule that replaced an older helper would have cost a prompt at every update, even one that did
not change a line of it.

## Decision

1. **The helper has a version of its own.** `mixengine_proto::privileged::HELPER_VERSION` is the
   version the helper reports in its header, its audit log and the stamp of its signed release
   asset. It starts at `0.1.1`, above every product version any helper ever reported, so every helper
   installed before this is replaced once.

2. **A committed fingerprint decides when it moves, compared with the last release.**
   `crates/mixengine-elevate/helper.lock` holds the fingerprint of what the compiler builds into the
   helper on three targets (the files cargo's dep-info lists, and every external crate with its
   version), and the version and fingerprint of the helper the last release shipped.
   `packaging/helper-lock.sh --check` fails when the helper changed since that release and
   `HELPER_VERSION` did not move. It runs in the pre-commit hook, in the local gate and in the branch's
   CI, never at release. A release records the new baseline (`--release`, from
   `scripts/set-version.mjs`).

3. **One flow, in the daemon, on every system.** At every start the daemon compares the installed
   helper's version with `HELPER_VERSION`. Missing: it queues `HelperInstall`. Older and able to
   verify a replacement: it queues `HelperReplace` with this release's signed helper. Older and not
   able to: it queues `HelperInstall`, run by the copy beside the program. The operation joins the
   next grant and goes first in its batch. After an update that changed the helper, the daemon raises
   that grant itself at its first start. No installer and no updater has its own hook.

4. **A helper too old to read a batch is not the one that runs it.** When the copy beside the program
   reports `HELPER_VERSION` and the installed one either lacks an operation in the batch or cannot
   verify a replacement of itself, the batch runs through the copy beside the program. That copy
   gets the trust a first grant on a new machine already gives it
   ([security model](../architecture/security-model.md)). An older helper that can verify its
   replacement is always replaced through the signed path.

5. **The update swap replaces the helper beside the program too.** It sits in a directory the
   person's account already writes, and keeping it old protected nothing. The installed copy is still
   touched only by the helper, through a prompt.

6. **One installer with the window and one without, per system, and nothing else.** A setup and a
   headless setup on Windows, a `.pkg` and a headless `.pkg` on macOS, a `.deb` and an `.rpm` of each
   on Linux. The Windows and macOS zips and archives, the Linux tarball and the AppImage are no
   longer published, from v0.0.8, with no transition release. The Windows zip stays as the update
   payload the per-user swap installs, and is not offered as a download. Linux beyond Debian and
   Fedora is unsupported.

7. **A Linux package is updated by the next package of its kind**, the path 0050 set for the `.pkg`.
   The signed feed lists each installer with its kind and flavour, the daemon verifies the download,
   opens it in the software centre when there is a desktop, and `mix self-update` always prints the
   `sudo apt install` or `sudo dnf install` line. Nothing in MixEngine elevates for it.

8. **`mix elevation upgrade` is removed**, with `elevation.upgrade`, `HelperUpgrade` and
   `HelperUpgradeOutcome`. Its job is decision 3, which needs nobody to know it exists.

## Consequences

- A person never has to think about the helper. Most updates change nothing in it and ask nothing;
  one that does costs one prompt, the one the next privileged operation would have asked anyway.
- Every change to what goes into the helper asks for a bump in the commit that makes it, including a
  comment-only change to a file the helper compiles. The price of a false positive is one prompt in
  the next update.
- Between two releases the helper can change more than once under one version, so a developer's
  machine does not replace its helper from one commit to the next.
- Decision 4 widens what the copy beside the program may do, to the exact case where the installed
  copy cannot do the work. The security model records it as a residual.
- Two Windows accounts share one installed helper. When one uninstalls, the other's daemon finds none
  and installs it again at its next prompt.
- Anybody on Arch, NixOS or another distribution without `dpkg` or `rpm` has no install path but a
  source build.

## Alternatives considered

**Keep reporting the product's version.** Every update would replace the helper, and so every update
would prompt. Lost because most releases do not touch the helper, and a prompt a person cannot
explain teaches them to accept prompts.

**Bump by hand, or check at release.** A person forgets, and a release build that refuses is a
release delayed by a fix commit. Lost to a check at the commit that makes the change.

**Compare with the previous commit instead of the last release.** Every commit that touched the
helper would bump, and a person upgrading across a release would see a version that says nothing
about what they received. Lost because a person receives releases.

**Let each installer keep the helper current.** The `.pkg`, the `.deb` and the `.rpm` already place
it as root, and the Windows setup could raise UAC. That is three mechanisms, and still nothing for
`mix self-update` on Windows. Lost to one flow in the daemon that every install path reaches.

**Keep `mix elevation upgrade` and tell people to run it.** Nobody knows to, and it could not reach
the helpers that needed it most.

**Keep the zips, the archives, the tarball and the AppImage for one more release.** Nobody used them
yet, and a release that shipped them only to announce their end would be work for no reader.
