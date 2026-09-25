# 0054. An install completes itself from its own payload; an update still adds nothing

**Status**: Accepted. It adds a rule beside the one in
[features/updates.md](../features/updates.md) that *"a name this install does not have is skipped
and reported as kept"*, and leaves that rule as it is.
**Date**: 2026-09-25

## Context

[T185](../specs/2026-09-25-t185-a-bin-that-weighs-almost-nothing-design.md) added a binary to every
release, `mixengine-trampoline`. On Windows it is what `<root>\bin` is filled with: about 360 KB per
command name instead of a 5.6 MB copy of `mixengine-shim`.

`updates::apply::swap` replaces the binaries an install has and adds none. The rule exists for a
reason that still holds: the window is not added to a headless install, and an update does not
change what kind of install a machine has. It also means a Windows install that updates itself onto
the release carrying T185 never receives `mixengine-trampoline`. T185 therefore falls back to copying
the shim into `bin\`, which works and keeps the ~223 MB T185 set out to remove, until the person
reinstalls with the full installer.

Four facts shape the answer:

- **Only the Windows zip is swapped.** Since v0.0.8 a `.pkg`, a `.deb` and an `.rpm` are updated by
  the next package of their kind ([0050](0050-a-copy-the-pkg-installed-is-updated-by-the-pkg.md),
  [0053](0053-the-helper-has-its-own-version-and-follows-the-product.md)), and the package carries
  every binary.
- **The swap runs in the old daemon.** A rule changed inside `swap` only takes effect for updates
  made *from* a release that carries it, so the update onto T185 itself would still arrive without
  the trampoline.
- **The unpacked payload stays on disk.** After a swap, `cache/<staging>/<version>/` still holds the
  archive as it was unpacked, verified against the signed feed and smoke-tested. Nothing removes it.
- **An old uninstaller cannot remove a file it has never heard of.** On Windows the program is
  removed by the `uninstall.exe` NSIS wrote at install time. It deletes the names it knows, then a
  non-recursive `RMDir`. A file added later stays, and so does the install directory.

## Decision

**A daemon may complete its own install from the payload of its own version, for a closed list of
names that never includes the window. An update still adds nothing.**

1. **What.** The names in `updates::COMPLETABLE`, a constant in the code. Today that is only
   `shims::TRAMPOLINE`. The window (`mixlab`) is never on it, so a headless install stays headless.
2. **Which installs.** Only a `Placement::SelfUpdatable` copy: one this account can write and that
   no installer receipt names. A copy a package manager placed is its package's business
   ([0048](0048-a-file-a-package-manager-placed-leaves-with-the-package.md)).
3. **From what.** Only the staging directory named after the running version, and only when the
   `mixengined` in it has the same SHA-256 as the running executable. That is what ties the payload
   to this build rather than to a feed's claim. The source is in the home and the destination is a
   per-user directory, so the account that could plant a file there could already write the
   destination, and nothing new is trusted.
4. **When.** At every daemon start, before `bin/` is refreshed, and in order of cost: the placement,
   then whether a completable name is missing, then whether the staging directory exists, and only
   then the hash. The ordinary start pays a few `stat` calls.
5. **How.** Copied to `<name>.new`, renamed into place, made executable. A failure removes the
   `.new`, is logged, and changes nothing else; T185's fallback keeps `bin/` working.
6. **What it leaves behind.** The staging directory of the running version belongs to the first
   start of that version. It is removed once the completion step has nothing left to do, and kept
   only when a copy failed on the install's side, so the next start can try again; a payload that
   is another build or the wrong shape is removed, because it would fail the same way every time.
   The names that were added are recorded in the store.
7. **Uninstall.** `mix uninstall` removes the names that record lists, and only from a
   `SelfUpdatable` copy. Whoever placed a file removes it, which is 0048's rule. An old
   `uninstall.exe` then finds nothing it does not know, and its `RMDir` succeeds.

## Consequences

- The update onto T185 fills `bin\` with trampolines at the first start of the new daemon. The fix
  works from the release that ships it, because the code that completes is the new code.
- Each update's staging directory is removed by that version's first start. Until now they were
  never removed, about 30 MB per update.
- A payload removed from the cache before the first start (`mix cleanup`, a manual delete) means no
  completion. The fallback holds until the next update or install.
- The uninstall list gains a row for files this mechanism added. `ResidueId` is a closed enum, so the
  bindings and the MixLab window change with it.
- The list is a constant. Adding a name to it is a code change reviewed like any other, and the
  window can only be added by overturning this decision.

## Alternatives considered

- **Let `swap` add the names on the list.** Rejected on its own: the old daemon runs the swap, so it
  would reach Windows one release after the one that needs it. It is not needed alongside this.
- **Let an update add any binary the payload carries.** Rejected: it adds the window to a headless
  install, and it makes what an install holds depend on which releases it passed through.
- **Download the payload again when the cache is gone.** Rejected as more machinery than the case
  deserves. The fallback is correct, only heavier.
- **Keep the fallback alone.** Rejected: every Windows user who updates in place would keep a ~223 MB
  `bin\` until they happen to reinstall.
