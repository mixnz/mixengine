# 0028. The AppImage does not carry WebKitGTK, and the window's floor is the distribution's

**Status**: Accepted
**Date**: 2026-09-09

## Context

[T105](../roadmap/phase-12-one-product.md) put MixLab, the window, into every installer. On Linux
that made WebKitGTK 4.1 a runtime dependency the four command-line binaries never had. The `.deb`
and the `.rpm` declare it; the AppImage, which installs nothing and has no package manager to ask,
could not. One line of the desktop client design's D8 said the AppImage "carries what it needs" —
appimagetool bundles no libraries at all, so carrying would mean `linuxdeploy` and its GTK plugin,
and T105 shipped the honest interim instead: the window uses the system's WebKitGTK and `AppRun`
refuses in words naming the package to install. T105a was left as the fork — carry it, or produce
the measurement that says a distribution floor is cheaper.

Three measurements decide it. The working is in
[the design](../../docs/superpowers/specs/2026-09-09-t105a-the-appimage-and-webkitgtk-design.md).

**What carrying would buy.** Every distribution whose glibc is new enough to run the window at all
already packages WebKitGTK 4.1 — Ubuntu 22.04, Debian 12, Fedora 38, openSUSE Leap 15.6 and
everything after them — so a carried copy there is a second copy of a library the machine has.
Below them, carrying buys nothing either: Ubuntu 20.04, Debian 11 and RHEL 8 are at glibc 2.31 and
older, and the window is built on `ubuntu-22.04` because it cannot be built in the
`manylinux_2_28` container the other four binaries come from (T103, D12) — a library bundle does not
lower a binary's own glibc floor. That leaves one family: enterprise Linux 9, at glibc 2.34, with
WebKitGTK 4.0 and no 4.1 planned before its end of life. Measured on run 34298077029, the window
requires `GLIBC_2.34` exactly — so that family clears the binary's own floor and fails on the webview
alone, which is what makes the next measurement the one that decides.

**Whether carrying would be enough there.** It would not. Enterprise Linux 9's glib is older than
the 2.70 WebKitGTK 4.1 requires, which is why the package was never backported to it — so an image
carrying WebKitGTK for that row would have to carry glib, GIO and its modules, and libsoup 3 as
well. Those are the libraries that must not be carried: GIO loads its TLS backend as a module at run
time, GTK loads host modules by name into the bundled toolkit, WebKitGTK starts helper processes
from a libexec path compiled into the library, and the renderer talks to the host's GL stack — which
is why a carried WebKitGTK is usually shipped with compositing disabled. Carrying WebKitGTK for that
row is not the change; carrying the platform is.

**Who would pay for it.** `AppRun` extracts the image into `${XDG_CACHE_HOME:-$HOME/.cache}/mixengine/<version>`
before running anything, and that is not an optimisation: the AppImage runtime unmounts the image
when the process exits, so `mix`, which starts `mixengined --detach` and returns, would tear the
filesystem out from under the daemon it had just started. A carried library tree is therefore copied
onto every machine that runs the image — including the one running
`./mixengine-…-linux-x86_64.AppImage status` on a headless server, which is a large share of this
artifact's users and would gain nothing. Measured on the same run: the closure is 205 MB across 133
files on `x86_64` and 200 MB on `aarch64`, of which WebKitGTK and JavaScriptCore alone are 117 MB and
113 MB. The AppImage that carries all five binaries today is 33 MB.

## Decision

**The AppImage does not carry WebKitGTK.** The window's floor is the distribution's, and the interim
T105 shipped is the design.

- The window — one binary, in the AppImage and the `.deb` and the `.rpm` alike — needs glibc
  `MIX_WINDOW_GLIBC` and WebKitGTK 4.1: Ubuntu 22.04, Debian 12, Fedora 38, openSUSE Leap 15.6 or
  newer. Both install pages say so.
- The four command-line binaries keep the container's glibc 2.28 floor in every artifact, the
  AppImage included. One file is therefore two floors, and a machine below the window's still gets a
  complete, working MixEngine out of it.
- `packaging/linux/window-floor.sh` reads both halves of the floor off the binary on every Linux
  build leg: the highest `GLIBC_x.y` it requires, held under `MIX_WINDOW_GLIBC`, and that it still
  links `MIX_WINDOW_WEBKIT`. It also prints what carrying the closure would have cost, so the
  measurement above stays regenerable.
- `AppRun` names the floor that was actually missed — the webview, the distribution's age, or a
  library named as itself — and shows it in a dialog when there is a display, because the person it
  is written for double-clicked a file and has no terminal to read stderr in.

## Consequences

- **Enterprise Linux 9 desktops get no window from any MixEngine artifact**, and neither the `.rpm`
  nor a carried AppImage would change that. They get the four command-line binaries from every
  artifact, and they are told which floor they fell below in words rather than by nothing happening.
- **The AppImage stays the size it is**, and the headless user goes on paying for nothing.
- **A Tauri release that moves to the `webkitgtk-6.0` API is a red build** rather than three wrong
  package names in two documents, because `window-floor.sh` asserts the soname and
  `crates/mixengine-core/tests/packaging.rs` derives those package names from it.
- **`MIX_WINDOW_GLIBC` is a tripwire, and tripwires go red.** The day GitHub retires `ubuntu-22.04`
  and the leg moves, this check fails, and the fix is to read the new number and change the promise
  in both install pages in the same commit. That is the intended cost, not an accident.
- **A system with a new enough glibc but no packaged WebKitGTK 4.1** — a distribution that unpacks
  differently, NixOS without an FHS wrapper — is in the same position as enterprise Linux 9, and for
  those the carried build is not reliably better: a bundled WebKitGTK on a host whose GL stack it did
  not expect is the failure this decision avoids rather than one it causes.

## Alternatives considered

**`linuxdeploy` and its GTK plugin** — the fork's other road. It loses before cost is argued: on
every system that can run the window, the library is already installed by the same package manager
that would install our `.deb`. Where it could help, WebKitGTK alone is not enough and what would be
enough is the GNOME platform. And the cost lands on the headless user, who gains nothing from it.

**A second, "fat" AppImage beside the thin one** — two more artifacts per architecture, two more
feed entries, twice the Linux packaging time, and a download page that asks a person to know what
WebKitGTK is. It answers one row at the price of making every other row's choice harder, and it
still carries the problem above inside it.

**A Flatpak** — the right answer for the row this decision leaves out, and not a change to the
AppImage: it carries a runtime rather than a library set, is what enterprise Linux desktop users
already use for applications newer than their release, and would carry MixLab without carrying
anything for the command line. Out of scope here, and recorded so that the next person to ask "why
not bundle?" finds the shape of the real answer.

**Building the window against an older glibc** — it would widen the table from below, and it is
blocked by T103's D12: the container that gives the other four binaries glibc 2.28 has no WebKitGTK
4.1 to link against. Changing that is a different container and a task of its own, not a line here.

**Leaving T105's interim exactly as it is** — the decision would be the same and two faults would
survive: a message that names the wrong package on a too-old distribution, and a message nobody who
double-clicked ever sees. The decision is free; the honesty of it is what this task built.
