# 0037. MixEngine may run Microsoft's Visual C++ installer

**Status**: Accepted
**Date**: 2026-09-16
**Qualifies** [security-model.md](../architecture/security-model.md)'s "`mixengine-elevate` is the only elevated component"

## Context

Every Windows PHP from 7.0.33 to 8.5.9, and other Windows builds in the index beside them, needs a
Visual C++ runtime the index names in `requires.vcredist`. On a machine without it an install
downloads, unpacks, and ends at a loader error. The runtime is one Microsoft installer, and installing
it needs administrator rights. Roadmap task T150; design:
`docs/specs/2026-09-16-t148-what-a-machine-lacks-is-installed-not-reported-design.md`, D6.

## Decision

**MixEngine may start one program that asks Windows for administrator rights and is not
`mixengine-elevate`: Microsoft's Visual C++ Redistributable installer.** Only when all of these hold:

1. A person agreed to it — `install_prerequisites`, asked by `mix` as `[y/N]` or by MixLab's dialog,
   refused at end of file, answered in advance only by `--yes` or `--install-prerequisites`.
2. It was fetched from `https://aka.ms/vs/17/release/vc_redist.{x64,arm64}.exe`, written into the
   build — never from the index or configuration.
3. `WinVerifyTrust` accepts its signature with whole-chain revocation checking, its leaf signer's
   organisation is exactly `Microsoft Corporation`, and its version resource names the Visual C++
   Redistributable.
4. It is held with a `FILE_SHARE_READ`-only handle from before the first check until it has ended.
5. It is started with the `open` verb, so it raises Windows' approval dialog itself; MixEngine
   requests no token for it. Measured: a bundle with nothing to install ends `1638` without raising
   the dialog at all.

Nothing else may be started through this path, ever.

## Consequences

- A person on a standard account is asked for administrator credentials, as for any installer.
- The step cannot be cancelled once started; the job says so while it runs.
- Somebody already running code as this user could swap the file between check and run — step 4
  closes that, and such a person can in any case start any installer and raise the same dialog.
- If Microsoft moves the address or changes the signing organisation, installs that need the runtime
  are refused with the reason until a release follows. Nothing unverified runs meanwhile.

## Alternatives considered

- **Through `mixengine-elevate`.** The helper validates typed requests and never accepts a path
  (ADR 0005). Running an installer through it would need a path argument, and fetching the installer
  there would need an HTTP client in a binary whose dependency closure CI diffs. Both would weaken the
  one component the security model most depends on, to gain nothing: the dialog Windows raises names
  the verified publisher either way.
- **Report the lack and stop.** What phase 18 set out to replace: a person who opened MixLab to get a
  working PHP is left with a warning and a download page.
