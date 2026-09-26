---
status: approved
date: 2026-09-24
task: T182
---

# Removing MixLab is one act

## The problem

Three defects a person hit on one Windows uninstall, and one design fault underneath them.

1. **Installed apps shows MixLab without an icon.** `packaging/windows/mixengine.nsi` writes
   `DisplayIcon = $INSTDIR\mix.exe`, and `mix.exe` carries no icon resource — no crate in the root
   workspace embeds one. `mixlab.exe` does. The setup and the uninstaller have no `Icon` either, so
   both show NSIS's default.
2. **The uninstaller offers no way to remove what MixLab created.** Its `Uninstall` section deletes
   the files the installer wrote and nothing else. Its own comment still says `mix uninstall` is
   *"not yet built"*; T87 shipped it.
3. **`MixLab.exe` survived the uninstall.** The window was open. NSIS's `Delete` on a mapped image
   fails without a word, `RMDir` then leaves the non-empty directory, and the log reads as success.
   `mixengined.exe` is left behind the same way whenever the daemon is running, and an update
   installed over a running copy fails the same way.

Underneath: **undoing what MixEngine did to the machine is offered from inside the program that goes
on running afterwards.** MixLab's Settings has an "Uninstall MixEngine" section, `keep_home` ticked by
default. With `keep_home` the daemon does not exit, so the helper, the CA, the hosts block and the
resolver wiring are removed while the window stays up — a live application that can no longer
elevate. On macOS the only recovery is reinstalling the `.pkg` (ADR 0029 records that chain). Nobody
wants that state; what a person wants from "uninstall" is *everything gone, MixEngine and MixLab
alike*, with an honest choice about their data.

And the machine-level undo is not optional. The NSIS uninstaller runs unelevated and a package
manager does not know what the daemon wrote at run time, so today removing MixLab on Windows leaves
the MixEngine CA trusted in every store, a hosts block, and an NRPT rule routing `.test` to a resolver
that no longer exists.

## The two promises

Everything below serves two sentences, and each decision says which one it keeps.

- **P1. An uninstall can always be finished.** Whatever stops one part-way, the program, its
  uninstaller and its entry in Installed apps are still there, and running the uninstaller again
  completes the job. Every step is idempotent: a step already done reads *nothing there* and is
  skipped.
- **P2. What blocks an uninstall is found before anything is removed.** A running window, a running
  daemon, a process holding a file in the home, a locked program file, a declined UAC prompt — each
  stops the uninstall while nothing has been changed, and the person is told what to close.

**What P2 cannot promise, and does not pretend to.** Windows has no transaction spanning the hosts
file, a certificate store, the registry, NRPT and the file system (TxF is deprecated). A failure
*after* the checks and *during* the privileged batch — the hosts block gone, then the trust store
refusing — cannot be rolled back. Such a failure is rare, because every cause the checks can see
has been ruled out, and P1 covers it: the uninstall stops, keeps the program, and the next run
finishes what is left.

## Decisions

### D1. `daemon.uninstall` ends the daemon when it finishes (P1)

A **finished** uninstall — every row outside the kept directories settled as removed or absent —
ends the daemon, whatever is kept. "Machine undone, program still serving" stops being a reachable
state. `keep_home` keeps its meaning, *leave the data where it is*, and loses its second one, *keep
running*.

An **unfinished** uninstall leaves the daemon up, exactly as a declined grant does today, so the same
command run again finds it and finishes.

`mix uninstall` waits for the endpoint to go in both finished cases, not only when the home was armed.

A new ADR records this and D3, since both amend what T87's design and ADR 0029 were written against.

### D2. The home and the relocated directories are two choices

`UninstallQuery` gains `keep_relocated: bool` (`serde(default)`, `false`), beside `keep_home`:

| `keep_home` | `keep_relocated` | Home (`%LOCALAPPDATA%\MixEngine`) | Directories `[paths]` moved out |
| --- | --- | --- | --- |
| false | false | removed | removed |
| true | false | kept | removed |
| false | true | removed | kept |
| true | true | kept | kept |

`relocated()` in `uninstall/inventory.rs` reads `keep_relocated` instead of `keep_home`, and
`arm_the_home` arms the two sets independently. One flag covers all four relocatable directories
(`runtimes`, `packages`, `data`, `logs`): they are moved for the same reason, a bigger disk, and kept
for the same reason, not losing what is on it. A directory that was never relocated lies inside the
home and goes with it.

`bash packaging/bindings.sh` regenerates `bindings/`; `mix uninstall` gains `--keep-relocated`.

### D3. MixLab loses its Uninstall section, on every system

`UninstallSection.tsx`, `UninstallConfirmDialog.tsx` (and its CSS), their i18n strings in `en`/`vi`,
their tests, and the `onUninstalled` plumbing through `Settings.tsx` and `MixEngineTab.tsx` go.
`docs/features/client-surface.md` item 7a is rewritten: taking MixEngine off a machine is the
uninstaller's and `mix uninstall`'s, not a screen of a graphical client. The rule *no client-only
capability* is untouched — the capability stays reachable from `mix`.

`mix uninstall` stays: it is the step the Windows uninstaller calls (D7), and on macOS and Linux it
is the documented step before removing the package.

### D4. The plan names what is in the way (P2)

`daemon.uninstall_plan` gains one row kind, `ResidueId::InUse`, and one outcome,
`Removal::Blocked { by }`: **a process whose executable lies inside a directory this uninstall would
remove**, other than this daemon and the services it supervises (which its own shutdown stops). The
typical ones: a `php artisan serve` or `node` started through a shim, a database a person started by
hand from `runtimes\`, a terminal running a shell from `packages\`. One row per process, with its pid,
name and path.

The enumeration is `mixengine-platform`'s — a new `processes_under(&[&Path])` beside the process
metrics that already walk the process table. Directories being kept are not searched.

`daemon.uninstall` takes the same inventory first and **refuses before doing anything** when any row
is `Blocked`: the job fails with `PreconditionFailed` and the report, having enqueued nothing and
changed nothing.

What a process table cannot show — a shell whose *working directory* is in the home, an editor
holding `logs\daemon.log` open — is caught by D6 instead, still before anything in a directory is
deleted.

### D5. Privileged first, then everything else (P2)

The order inside `daemon.uninstall` becomes:

1. Take the inventory; refuse on `Blocked` (D4).
2. Enqueue the privileged rows and raise the one prompt, as today.
3. **If the grant is declined or fails, or any privileged row is not settled as removed** — drop what
   this uninstall enqueued from the queue, and stop. A declined prompt has then changed nothing; a
   failed row is the rare case P1 covers.
4. Undo the three that need no token: `PATH`, the login entry, the browsers. Release the JDKs.
5. Arm the directories (D6), and end (D1).

This reverses T87's D7, which put the unprivileged half first *"so a declined grant still leaves the
browsers, the `PATH` and the login entry clean"*. That was the right trade when the uninstall was a
button in a window a person would go on using; for a removal that must stop cleanly or not start, a
half-clean machine after a declined prompt is exactly the state P2 forbids.

`grant: false` keeps its meaning — enqueue, raise nothing — and with the new order it now also
changes nothing else: steps 4 and 5 wait for a grant that did not happen.

### D6. A directory is renamed before it is deleted (P2, P1)

`remove_what_the_uninstall_armed` in `mixengined`'s `main` changes from `remove_dir_all` on each path
to:

1. **Rename every armed directory** to a sibling tombstone, `<name>.removing-<pid>`, in one pass.
   Windows refuses to rename a directory while anything inside it is open without share-delete, or
   while it is a process's working directory — so a rename that succeeds means nothing can stop the
   deletion half-way.
2. **If any rename fails, rename back the ones already renamed and delete nothing.** The error names
   the directory; `mix uninstall` reads the directories back and reports them as kept.
   *Amended after the first real Windows uninstalls:* a refused rename is first tried again every
   100 ms for up to 10 s, since what refuses one is usually gone a moment later — the daemon's
   last database connection closing, a scanner reading a file just written. What is still held
   is looked for **before** anything is put back, a directory as well as a file, and a held file
   names its program through the Restart Manager. And the home's `bin/` is moved out on its own
   first, to a tombstone beside the home: it is on `PATH`, editors watch every `PATH` directory,
   and Windows refuses to rename the parent of a watched directory — measured with VS Code, which
   kept the home on every uninstall until it was closed. It is put back with the rest on a refusal.
3. Delete the tombstones. A tombstone that still cannot be deleted — a file opened with share-delete,
   an antivirus scan holding one for a moment — stays, and is named on stderr.

**Not the restart queue.** `MoveFileEx(MOVEFILE_DELAY_UNTIL_REBOOT)` writes under `HKLM` and needs an
administrator; the daemon has none, and a second prompt for a leftover directory is not worth one.
Instead a tombstone is *ours by its name*: the next `daemon.uninstall` (and `daemon.uninstall_plan`,
as a `Planned` row of kind `Home` or `RelocatedDirectory`) finds `<name>.removing-*` beside the home
and beside each relocated directory and removes it first. `mix uninstall` reads a tombstone that is
still there as left behind, exits non-zero, and D7 keeps the program so the next run can finish (P1).

No database is ever left half-deleted: it is either where it was, or in a tombstone that is going.

The rename happens after the machine has been undone (it has to — the daemon runs out of the home),
so step 2 is the one place where P2 can end with the machine undone and the data kept. That is the
safe side to fail on, and P1 finishes it: the next run finds nothing outside the home to undo and
removes the home.

### D7. The Windows uninstaller does the whole removal

`Section "Uninstall"` and its pages run, in this order:

1. **Choices page** — a custom `nsDialogs` page after `uninstConfirm`, two checkboxes, **both
   unticked by default**:
   - *Also delete MixLab's data* — the home's path written out, and a line saying it holds the
     databases, certificates and projects' records.
   - *Also delete the folders you moved out of it* — listing each path, **shown only when there is at
     least one**. The list comes from `mix uninstall --dry-run --relocated` (D9).
2. **Close the window** (D8).
3. **Check, changing nothing** (P2):
   - every binary in `$INSTDIR` can be opened for writing (`FileOpen … a`) — a mapped image cannot,
     so this finds a running `mixengined.exe`, `mix.exe` or `mixlab.exe` whatever started it;
     `mixengined.exe` is exempt while the daemon answers, since `mix uninstall` ends it;
   - `mix.exe uninstall --dry-run` with the chosen flags exits `0`. It exits `3` when a row is
     `Blocked`, and its output — which names each process — is shown.
   Any failure: a message saying what to close, and the uninstaller ends with nothing removed.
4. **Undo the machine**: `mix.exe uninstall --yes`, plus `--keep-home` when the first box is
   unticked and `--keep-relocated` when the second is. Always run; there is no box for it. It raises
   the one UAC prompt.
5. **If step 4 exits non-zero**: its output is shown and the uninstaller ends. The program stays
   installed (P1) — reinstalling is not needed, running Uninstall again is the retry. A declined
   prompt says *nothing was removed* (D5).
6. **Remove the program**: the existing scheme, `PATH`, shortcut and file removal. Every `Delete` is
   checked with `IfErrors`. **`uninstall.exe`, the `Uninstall` registry key and `Software\MixEngine`
   go last, and only when every other file went** — otherwise the files that could not be deleted
   are named and the entry stays, so Installed apps can run the uninstaller again (P1).

Silent uninstall (`/S`) takes the defaults — machine undone, home and relocated directories kept —
and any stop is a non-zero exit.

**A second run after step 4 succeeded** finds no home (or a kept one) and no daemon. `mix uninstall`
then autostarts a daemon against an empty home and removes it again, which is idempotent and slow,
not wrong. Step 6 is what such a run is for.

### D8. The window is asked about, then closed

Before step 3 of D7, and before the installer writes files over an existing install:

- Any `mixlab.exe` whose image path is `$INSTDIR\mixlab.exe` — found through PowerShell's
  `Get-Process`, filtered by `Path`, so a development build or another copy is left alone. If one
  exists: *"MixLab is running. OK closes it and continues; Cancel stops."* OK stops it
  (`Stop-Process`); Cancel ends the (un)installer with nothing changed. The window keeps no state of
  its own that a forced close loses — the daemon holds it.
- The installer, updating over a running copy, then runs `mix.exe daemon stop`, which stops the
  services and then the daemon. The uninstaller leaves the daemon to `mix uninstall` (D1).

With `/S` the question is answered OK: an unattended update has nobody to ask, and one that fails on
a locked file is worse than one that closes the window.

### D9. `mix uninstall --dry-run --relocated`

A rendering of `daemon.uninstall_plan`, not a new method: one absolute path per line, the
`RelocatedDirectory` rows' `location`, nothing else, empty output when there are none. NSIS reads it
with `nsExec::ExecToStack` — NSIS has no JSON parser without a third-party plugin, and a
line-per-path output splits with the string macros it already has.

If `mix` cannot reach or start a daemon, the page shows only the home checkbox, and step 3's dry run
fails, which stops the uninstall with nothing removed.

`mix uninstall --dry-run` gains exit code `3` for *blocked* (D4), distinct from `1` for an error.

### D10. The icon

`DisplayIcon = "$INSTDIR\mixlab.exe,0"`. The installer and the uninstaller get `Icon` and
`UninstallIcon` from `apps/desktop/src-tauri/icons/icon.ico`, passed in by `build.sh` as a define,
the way `STAGE` is. The Start menu and desktop shortcuts already point at `mixlab.exe`.

## What changes

| Where | Change |
| --- | --- |
| `crates/mixengine-proto/src/uninstall_api.rs` | `keep_relocated`; `ResidueId::InUse`; `Removal::Blocked` |
| `crates/mixengine-platform` | `processes_under` |
| `crates/mixengine-daemon/src/uninstall.rs`, `uninstall/inventory.rs` | D1, D2, D4, D5 |
| `crates/mixengine-daemon/src/main.rs` | D6 |
| `crates/mixengine-cli/src/main.rs` | `--keep-relocated`, `--dry-run --relocated`, exit code 3, wait on every finished run |
| `bindings/` | regenerated |
| `apps/desktop/src/modules/mixengine/…` | D3 |
| `packaging/windows/mixengine.nsi`, `build.sh` | D7, D8, D10 |
| `packaging/windows/uninstall-check.md` | the by-hand checklist under Testing, kept beside the script it checks |
| `docs/guide/{en,vi}/uninstalling.md` | Windows: Apps & Features does it all; `--keep-home` ends the daemon; what *blocked* means |
| `docs/features/client-surface.md` | item 7a (D3) |
| `docs/decisions/` | new ADR for D1, D3 and D5 |
| `docs/roadmap/` | T182, and the follow-up below |

## Out of scope — follow-up

**macOS and Linux have no uninstaller to hang this on.** A `.pkg` has no removal step, an `.app` is
dragged to the Trash, and a `.deb`/`.rpm` `prerm` runs as root for the whole machine and cannot reach
a per-user daemon. D1, D2, D4, D5 and D6 apply to `mix uninstall` on every system; the handbook's
order stays `mix uninstall`, then remove the package. An uninstall path of their own — for example a
*"Uninstall MixLab…"* item in the macOS app that runs the whole removal, deletes the `.app` and quits,
so the app never outlives it — is a follow-up task beside T182.

## Testing

- Proto: `keep_relocated` defaults to `false`; a payload without it still deserializes.
- Platform: `processes_under` finds a child started from a temporary directory and not one started
  elsewhere, and not a descendant of the pid it is told to exclude.
- Daemon:
  - the four rows of D2's table, over a home with one relocated directory;
  - a finished uninstall with `keep_home: true` ends the daemon; an unfinished one does not;
  - a declined grant leaves `PATH`, the login entry, the browsers and the queue as they were;
  - a process started from inside the home makes the plan `Blocked` and the act refuse with nothing
    enqueued;
  - D6: a file held open inside one armed directory leaves every armed directory in place, and the
    tombstones are renamed back.
- CLI: `--dry-run --relocated` prints exactly the relocated paths; `--dry-run` exits `3` when blocked.
- Desktop: `npm run build`, `npm test`, `npm run lint` clean with the section removed.
- Windows, by hand on this machine, then in CI where it can be driven silently:
  - Installed apps shows the icon;
  - an uninstall with the window open asks, closes it, and leaves nothing under
    `%LOCALAPPDATA%\Programs\MixEngine`;
  - a declined UAC prompt leaves the program, the home and the machine as they were;
  - a `php` started through a shim stops the uninstall at step 3 with nothing removed;
  - each combination of the two boxes, then `mix uninstall --dry-run` from a reinstall reads
    *nothing there* for everything that was not kept.
