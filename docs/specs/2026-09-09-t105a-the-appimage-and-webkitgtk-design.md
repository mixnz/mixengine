# T105a — The AppImage and WebKitGTK

Roadmap task [T105a](../../../.claude/roadmap/phase-12-one-product.md), on
[the desktop client design](2026-09-08-the-desktop-client-in-this-repository-design.md)'s D8 and on
[T105](2026-09-09-t105-the-window-in-every-installer-design.md). 2026-09-09.

T105a is written as a fork in the road: *`linuxdeploy` and its GTK plugin, or the measurement that
says a distribution floor is cheaper than carrying WebKitGTK.* This document is that measurement,
and the floor is what the product keeps. What follows is why, what is built so the answer stays
checkable, and what the AppImage says to the person it cannot open a window for.

## The question, stated exactly

D8 said, in one line, that "the AppImage carries what it needs". T105 found that appimagetool
bundles no libraries at all — carrying would mean `linuxdeploy` and its GTK plugin, a dependency and
a failure mode of a different size — so it shipped the honest interim: the window uses the system's
WebKitGTK 4.1, and `AppRun` refuses in words naming the package to install. That interim is the only
part of D8 still open.

Three things have to be true for carrying to be the right answer:

1. there are systems on which the AppImage's window would work if it carried WebKitGTK, and does not
   work now;
2. carrying WebKitGTK is enough to make it work on them;
3. the cost of carrying is paid by the people it helps.

None of the three survives measurement. They are M1, M2 and M3 below.

## M1 — What carrying would buy

The AppImage's window needs the WebKitGTK **4.1** API (libsoup 3), which is what Tauri 2 links.
What each distribution ships, as of 2026-09-09:

| Distribution | glibc | WebKitGTK 4.1 packaged |
| --- | --- | --- |
| Ubuntu 22.04 LTS | 2.35 | yes, `libwebkit2gtk-4.1-0` |
| Ubuntu 24.04 LTS | 2.39 | yes |
| Debian 12 | 2.36 | yes |
| Debian 13 | 2.41 | yes, and 4.0 is gone |
| Fedora 38 and newer | 2.37+ | yes, `webkit2gtk4.1` |
| openSUSE Leap 15.6 | 2.38 | yes, `libwebkit2gtk-4_1-0` |
| openSUSE Tumbleweed, Arch | current | yes |
| **RHEL / AlmaLinux / Rocky 9** | 2.34 | **no — 4.0 only, for the life of the release** |
| Ubuntu 20.04, Debian 11, RHEL 8 | 2.31, 2.31, 2.28 | no |

Two readings come out of that table.

**Above enterprise Linux 9, carrying buys nothing.** Every distribution whose glibc is new enough to
run the window at all already packages WebKitGTK 4.1, and packages it as a dependency the `.deb` and
the `.rpm` declare. A carried copy on those systems is a second copy of a library the machine
already has, downloaded by everybody, used by nobody.

**Below it, carrying buys nothing either, because those systems cannot run the window regardless.**
Ubuntu 20.04, Debian 11 and RHEL 8 are at glibc 2.31 and older; the window is built on
`ubuntu-22.04` and cannot be built anywhere older — [T103's D12](2026-09-08-the-desktop-client-in-this-repository-design.md)
settled that, because the `manylinux_2_28` container the other four binaries are built in is
AlmaLinux 8, whose WebKitGTK is the 4.0 API on libsoup 2. A library bundle does not lower a binary's
own glibc floor.

That leaves exactly one family: **enterprise Linux 9**, at glibc 2.34, with WebKitGTK 4.0 and no
prospect of 4.1 before 2032. It is the only place where the question "would carrying help?" is even
open. M2 is about that one row.

## M2 — Whether carrying would be enough where it could help

It would not, and the reason is one level below WebKitGTK. Enterprise Linux 9 carries a glib older
than the 2.70 that WebKitGTK 4.1 requires — which is why nobody has backported the package there
rather than because nobody wanted to. So an AppImage that carried WebKitGTK for that row would have
to carry glib, GIO and its modules, libsoup 3, and the parts of the GNOME stack between them.

Those are precisely the libraries that must **not** be carried. GIO loads its TLS backend as a
module at run time — carry glib without `glib-networking` and every HTTPS request inside the webview
fails with an error about no TLS support; carry it and it is loaded next to a host GnuTLS. GTK loads
host modules by name into the bundled toolkit. WebKitGTK starts helper processes of its own from a
libexec path compiled into the library, so `WEBKIT_EXEC_PATH` and an injected-bundle path have to be
set correctly or the window opens white with no error. And the renderer talks to the host's GL
stack, which is the reason a carried WebKitGTK is usually shipped with
`WEBKIT_DISABLE_COMPOSITING_MODE=1` — a bundle that works by turning hardware acceleration off.

So for the one row where carrying could help, carrying WebKitGTK is not the change; carrying the
platform is. That is not a packaging refinement, it is a second product. The answer for enterprise
Linux 9 desktops, if it is ever asked for, is a Flatpak — the mechanism that distribution's own users
already use for applications newer than the release — and not a heavier AppImage.

## M3 — Who would pay for it

**The AppImage extracts itself before running anything, and that is not an optimisation.** `AppRun`'s
own header says why: the AppImage runtime unmounts the image when the process exits, so `mix`, which
starts `mixengined --detach` and returns, would tear the filesystem out from under the daemon it had
just started. Everything the image runs is copied into `${XDG_CACHE_HOME:-$HOME/.cache}/mixengine/<version>`
first.

A carried library tree is therefore not only in the download. It is copied into that cache, per
version, on the first run — on the machine of the person who runs
`./mixengine-…-linux-x86_64.AppImage status` on a headless server and will never open a window. The
AppImage is the one artifact in this product that is deliberately both halves at once; the headless
archive exists so that a server pays for neither the window nor its dependency. Carrying WebKitGTK
would put the dependency back into the artifact whose whole appeal is that it installs nothing.

The size of what would be carried is measured rather than estimated: `packaging/linux/window-floor.sh`
(D2) prints the window's resolved library closure and the WebKitGTK/JavaScriptCore subtotal on both
Linux build legs, so the number behind this paragraph is regenerable and never has to be believed.

## D1. The decision

**The AppImage does not carry WebKitGTK, and the window's floor is the distribution's.** The
interim T105 shipped is the design. It is recorded as
[ADR 0028](../../../.claude/decisions/0028-the-appimage-does-not-carry-webkitgtk.md), and it replaces
one line of D8; the rest of D8 stands.

What the floor is, stated once and promised in the install page:

- **The window** — the AppImage's, the `.deb`'s, the `.rpm`'s, they are one binary — needs glibc
  `MIX_WINDOW_GLIBC` or newer and WebKitGTK 4.1. In distribution terms: Ubuntu 22.04, Debian 12,
  Fedora 38, openSUSE Leap 15.6 or newer.
- **The command line** — the four binaries — keeps the glibc 2.28 floor the `manylinux_2_28`
  container gives it, on every artifact including the AppImage. A machine below the window's floor
  still gets a complete, working MixEngine out of the same file.

Two floors in one artifact is the thing a person has to be told, and D3 is how they are told it.

## D2. The floor is measured on the leg that builds the window

`packaging/linux/window-floor.sh`, run by `packaging/desktop.sh` on Linux immediately after the
window is staged — the moment where the binary exists and the machine that built it is still the one
asking. It is skipped on macOS and Windows, whose floors are set elsewhere and are not this task's.

It reads two things with `readelf`, which needs nothing installed and nothing resolved:

- **the highest `GLIBC_x.y` the window requires**, from `.gnu.version_r`. Printed always; a **failure**
  when it exceeds `MIX_WINDOW_GLIBC` in `packaging/common.sh`, whose message says that the install
  page promises that number and that raising it is a documentation change, not a rubber stamp. `≤`
  and not `=`: a toolchain that stops needing a symbol must not be a red build, and the event worth
  catching — the floor rising past what we promise, the day somebody moves the leg off
  `ubuntu-22.04` — is caught exactly.
- **that the window still links `libwebkit2gtk-4.1.so.0`**, from `DT_NEEDED`. A **failure** otherwise.
  This is the guard for a Tauri release that moves to the `webkitgtk-6.0` API: three documents name
  `libwebkit2gtk-4.1-0`, `webkit2gtk4.1` and `libwebkit2gtk-4_1-0` as the packages to install, and
  every one of them becomes wrong silently on the day that soname changes.

And one thing with `ldd`, best-effort: **the size of the resolved library closure**, with the
WebKitGTK and JavaScriptCore subtotal called out — M3's number. On a machine where the closure does
not resolve, it says so and measures nothing rather than failing: a developer without WebKitGTK
installed is still entitled to the two assertions above.

`MIX_WINDOW_GLIBC` is written in `packaging/common.sh` beside the other things every script agrees
about, and its **value is set from the first measured run rather than guessed** — the number the
install page promises has to be the number the binary produces, and a floor written down before it
was read is how a document starts lying.

## D3. `AppRun` says which floor was not met, where a double click can see it

Two faults with what T105 shipped, both worth this task:

**It names the wrong cause.** The check is `ldd … | grep -q "not found"`, and the message always says
WebKitGTK. A machine whose glibc is too old produces `` version `GLIBC_2.35' not found `` from that
same `ldd`, and is told to install a WebKit package it already has.

**It says it where nobody is listening.** A double click in a file manager has no terminal attached.
The message T105 wrote goes to stderr and, for the one person it was written for, to nothing at all —
the window simply does not appear.

So the no-argument branch classifies `ldd`'s answer into three:

| What `ldd` says | What the person is told |
| --- | --- |
| `libwebkit2gtk-4.1.so.0 => not found` | WebKitGTK 4.1 is missing, and the package name on Debian/Ubuntu, Fedora/RHEL and openSUSE |
| `` version `GLIBC_x.y' not found `` | this distribution is older than the window's floor, and which releases meet it |
| any other `=> not found` | the sonames themselves, verbatim |

Every one of them ends with the same two sentences: the `.deb` and the `.rpm` declare what is
missing, and **the command line in this same file is unaffected** — `./mixengine-….AppImage status`
works on a machine where the window cannot start, which is the whole reason both halves are in one
artifact.

It goes to stderr always, and additionally to a dialog when a display is present: `zenity`, then
`kdialog`, then `xmessage`, each guarded by `command -v`, the message passed as one argument and
never through a shell. None of the three installed is stderr only — nothing is downloaded and
nothing becomes a dependency. `ldd` absent is not an error either: the check is skipped and the
dynamic loader gets to speak for itself.

## D4. What the documents say afterwards

- **`docs/guide/{en,vi}/install.md`** — the Linux section states both floors: the window's
  distribution list and the command line's glibc 2.28, on the AppImage as much as on the packages.
  The existing "Both packages are built against glibc 2.28" is true of four binaries out of five and
  is corrected in place.
- **`.claude/operations/build-and-release.md`** — the Linux row of the targets table says the same
  thing: four binaries at glibc 2.28 in a container, the window at `MIX_WINDOW_GLIBC` on the runner.
- **ADR 0028** — the decision, with M1–M3 as its context and the alternatives below.
- **The roadmap** — T105a ticked, with what it settled and the measured numbers.

## D5. What checks all of this, and where it runs

| Check | Where it lives | What runs it |
| --- | --- | --- |
| the window's glibc floor, and that it still links WebKitGTK 4.1 | `packaging/linux/window-floor.sh` | `packaging/desktop.sh`, on both Linux `build` legs |
| `AppRun` fills its cache, repairs a stale one, and refuses the three ways | `packaging/linux/apprun-check.sh` | **`lint`**, on every run |
| the install pages promise the floor `packaging/common.sh` declares | `crates/mixengine-core/tests/packaging.rs` | `cargo test`, on all three systems |

The middle row is a change of its own. `apprun-check.sh` has been in the repository since T85c and
nothing has ever run it — it was written to be run by hand by the person editing `AppRun`. This task
makes `AppRun`'s message the product's answer to a whole class of machine, and a fixture nothing runs
is not a test. It goes into `lint` beside `test-sign.sh` and `test-feed.sh`, which are there for the
same reason: the only other thing that would ever exercise them is a release.

The fixture gains the three refusals of D3, each driven by a stubbed `ldd` earlier on `PATH` — so it
keeps the property T85c gave it of running on any machine, including the Windows one this was
written on, and it unsets `DISPLAY` and `WAYLAND_DISPLAY` so that checking the message never puts a
dialog on the screen of the person checking.

## Alternatives considered

**`linuxdeploy` and its GTK plugin.** The fork's other road. It loses on M1 before cost is even
argued: on every system that can run the window, the library is already installed by the same
package manager that would install our `.deb`. Where it could help — enterprise Linux 9 — WebKitGTK
alone is not enough (M2), and what would be enough is the GNOME platform. And the cost lands on the
headless user (M3), who is a large share of this artifact's users and gains nothing.

**A second, "fat" AppImage beside the thin one.** Two more artifacts per architecture, two more feed
entries, twice the Linux packaging time, and a download page that asks a person to know what
WebKitGTK is. It answers M1's one row at the price of making every other row's choice harder, and it
still has M2's problem inside it.

**A Flatpak.** The right answer for the row this decision leaves out, and not a change to the
AppImage: it carries a runtime rather than a library set, is the mechanism enterprise Linux desktop
users already have for applications newer than their release, and would carry MixLab without
carrying anything for the CLI. It is out of scope here and is not proposed as work by this task —
recorded so that the next person to ask "why not bundle?" finds the shape of the real answer.

**Building the window against an older glibc.** It would widen M1's table from below and is blocked
by D12: the container that gives the other four binaries glibc 2.28 has no WebKitGTK 4.1 to link
against. Changing that means a different container, which is a task, not a line.

**Leaving T105's interim exactly as it is.** The decision would be the same and the two faults in D3
would survive — a message that names the wrong package on a too-old distribution, and a message
nobody sees. The decision is free; the honesty of it is what this task builds.

## What this accepts

- **Enterprise Linux 9 desktops get no window from any MixEngine artifact.** They get the four
  command-line binaries from every one of them, including the AppImage, and they are told which
  floor they fell below in the words of D3 rather than by nothing happening.
- **A system with a new enough glibc but no packaged WebKitGTK 4.1** — a distribution that unpacks
  differently, NixOS without an FHS wrapper — is in the same position, and for those the carried
  build is not reliably better: a bundled WebKitGTK on a host whose GL stack it did not expect is
  the failure mode this decision avoids rather than the one it causes.
- **`MIX_WINDOW_GLIBC` is a tripwire, and tripwires go red.** The day GitHub retires
  `ubuntu-22.04`, this check is what fails, and the fix is to read the new number and change the
  promise in the same commit. That is the intended cost.

## Out of scope

T106's updater, the `.deb`/`.rpm` dependency declarations (T105, unchanged and still asserted by
their own scripts), the headless archive, macOS and Windows floors, and any change to what
`appimagetool` is asked to build.
