# T148 — What a machine lacks is installed, not reported

Roadmap task [T148](../../../.claude/roadmap/phase-18-what-a-machine-lacks.md), phase 18. 2026-09-16.

**The case this comes from**: a Windows machine with no Visual C++ runtime, and somebody who opens
the window to get a PHP. Today MixEngine downloads 32.8 MB for 8.3.33, unpacks it, runs `php -v`
from the staging directory, and reports that the loader could not find `VCRUNTIME140.dll` — true,
and the end of the road. The index said so before the first byte moved: every Windows PHP from
7.0.33 to 8.5.9 carries a `requires.vcredist`, and the daemon parses it and drops it.

What the person wanted was a PHP that runs. For the Visual C++ runtime that is reachable: it is a
Microsoft installer, published at a permanent address, and installing it is one administrator
approval. For the other two things the index measures it is not — a glibc *is* the Linux
distribution and a macOS version *is* the operating system — but a dead end is still avoidable,
because an older build of the same runtime usually runs.

So this task makes the daemon read `requires`, install what can be installed after somebody agrees
to it, and name the version that does run when nothing can be.

## What is already true

Written down so nothing below is built twice, and because several of these decide the design:

- **`Requires` is parsed and read by nothing.** `crates/mixengine-core/src/index/format.rs` models
  `vcredist`, `macos` and `glibc` as optional strings; its doc comment says outright that T92 found no
  consumer and names `install::SmokeTest` as the mechanism that exists. The published document also
  carries a prose `tzdata` on ten Linux PostgreSQL artifacts and, since `mixengine-packages`' P18, a
  `cpu: "avx"` on every MongoDB artifact. Neither is modelled; both parse, because the module is
  deliberately not `deny_unknown_fields`.
- **`SmokeTest` stays.** It runs the artifact from staging before the rename and maps an OS refusal
  to `Error::SmokeTestFailed`, which `mixengine-daemon/src/error.rs` sends as
  `ErrorCode::DependencyMissing`. Nothing here replaces it: it is the only check that proves rather
  than predicts, and it catches what `requires` cannot state — `mongosh_crypt_v1.dll` is the example
  `mixengine-packages` found, a library nothing loads until it is needed.
- **The selection already knows the artifact's architecture.** `Package::select(Target)` returns a
  `Selection { artifact, execution }`, and on an ARM64 Windows machine `execution` is `Emulated` for
  an x86_64 build (ADR 0023). An emulated x64 PHP needs the **x64** redistributable, not the ARM64
  one, so the requirement is judged against the artifact and never against the host.
- **Both listings compose a release per version, daemon-side.** `mixengine-daemon/src/runtimes.rs`
  and `packages.rs` build `RuntimeRelease` / `PackageRelease`, each with an optional `execution`
  added under ADR 0019. A member added the same way is readable by every client already deployed.
- **The wire `Error` has no structured data.** `mixengine-proto/src/error.rs` carries `code`,
  `message` and `hint`, and `message` is documented as never parsed by a client. So *which* remedy
  applies — install something, or pick another version — cannot ride on a refusal; a client that
  must draw a button for it has to be told in a typed answer.
- **`runtime.install` answers a `JobSummary`.** The install runs as a job; anything decided before
  the job exists is an immediate answer, and anything inside it is progress.
- **A flag is added to an install-shaped call by flattening.** `RuntimeUninstall` wraps
  `RuntimeTarget` with `#[serde(flatten)]` and adds `force`; an older client's request still parses.
- **The daemon raises nothing on its own initiative** (T40b, D1). A client learns what would need
  approval, asks the person, and only then calls the method that raises the prompt. `mix` refuses on
  end of file rather than assuming either answer, `--yes` answers in advance, and `--json` requires
  it.
- **`mixengine-elevate` is the only elevated component** (`.claude/architecture/security-model.md`),
  it is compiled with the `elevated` feature alone, and CI diffs its dependency closure against
  `.github/elevate-dependencies.txt`.
- **The platform crate already reads `HKLM`.** `windows/app_control.rs` opens a key with
  `RegOpenKeyExW` and reads a `REG_DWORD` with `RegQueryValueExW`; `Win32_System_Registry` is an
  enabled `windows-sys` feature. `libc` is a dependency on every Unix target.
- **Linux builds are `-gnu`.** `ci.yml` builds `x86_64-unknown-linux-gnu` and
  `aarch64-unknown-linux-gnu`, so `gnu_get_libc_version` exists in every Linux `mixengined`.
- **A blueprint plan never reads the index.** `blueprints::plan` holds a `VersionConstraint` where
  a release belongs (the T78 design's D9), so *which* artifact a step installs — and therefore what
  it requires — is unknowable while planning. The daemon's `Api::resolve` turns every constraint
  into a release at the top of the apply job, *"where a failure costs nothing because the ledger is
  still empty"*. A dry run answers `BlueprintApplyResponse::Planned { plan }` and resolves nothing.

Measured on the published index, 2026-09-16 — which Windows artifacts need which runtime:

| `vcredist` | Artifacts |
| --- | --- |
| 2010 | `mysql 5.6.51` |
| 2015 | `php 7.0.33`, `php 7.1.33` |
| 2017 | `php 7.2.34`, `php 7.3.33`, `php 7.4.33` |
| 2019 | `php 8.0.30` – `php 8.3.33` (4) |
| 2022 | 12, among them every MongoDB line and `mongosh` |

All 22 are `x86_64`. One Microsoft installer — *Visual C++ 2015–2022 Redistributable (x64)* —
satisfies 21 of them.

Measured on a Windows 11 x64 machine with that installer present:

```
HKLM\SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x64               Installed=1 Major=14 Minor=50 Bld=35719
HKLM\SOFTWARE\WOW6432Node\Microsoft\VisualStudio\14.0\VC\Runtimes\x64   Installed=1 Major=14 Minor=50 Bld=35719
HKLM\SOFTWARE\WOW6432Node\Microsoft\VisualStudio\14.0\VC\Runtimes\x86   Installed=1 Major=14 Minor=50 Bld=35719
HKLM\SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x86               absent
HKLM\SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\arm64             absent
…\VisualStudio\10.0\VC\VCRedist\x64, …\12.0\VC\Runtimes\x64 (both views) absent
```

`Minor=50` is newer than anything the index names, which is the first design constraint: a year is a
floor, never an exact match.

## D1 — The machine is read when it is asked about, not remembered

`mixengine-platform` gains a `machine` module, behind `host`, with one function that answers a
snapshot:

| Fact | How it is read | Where it can be read |
| --- | --- | --- |
| glibc | `gnu_get_libc_version()` | Linux |
| macOS | `sysctlbyname("kern.osproductversion")` | macOS |
| Visual C++ runtimes | `Installed`, `Major`, `Minor` under `VisualStudio\14.0\VC\Runtimes\{x64,arm64}` | Windows |

Every fact is a three-way answer: **present at a version**, **absent**, or **could not tell** — a
registry call that failed for a reason other than a missing key, a sysctl that errored, a string
that does not parse. The third is not folded into either of the first two anywhere below. A fact
that does not exist on this system — glibc on macOS — is *could not tell*, never *absent*: absent
would refuse an artifact that asks for it.

Both keys are read from the 64-bit registry view, where the measurement above found x64. **The x86
key is not read**: every Windows artifact the index publishes is `x86_64` or `aarch64`, and a probe
nothing consults is code nothing exercises.

**A snapshot per request, not one at start-up.** The daemon takes one for each listing, each
requirements question and each install, and every read is a key lookup or a single syscall. Cached
at start-up it would be wrong in exactly the case this task exists for: somebody told to install the
runtime installs it, presses Install again, and is refused by a daemon that remembers the machine as
it was.

Nothing is added to `mixengine-elevate`'s build: the module is `host`-only, and the one new
`windows-sys` feature (`Win32_Security_WinTrust`, D6) adds modules, not crates.

## D2 — Only a certain lack refuses

`mixengine-core` gains a pure function that judges an artifact's `Requires` against a snapshot and an
artifact architecture. It touches no OS and is where every rule in this section is tested.

- **`glibc` and `macos`** are dotted integers compared numerically: the machine meets it when its
  version is equal or greater. `2.27` against `2.35` is met; `14.0` against `13.6.1` is not.
- **`vcredist`** maps a year to the smallest `14.x` minor that satisfies it, and the machine meets
  it when the key for the *artifact's* architecture says `Installed=1` at that minor or higher:

  | Year | Minimum |
  | --- | --- |
  | 2015 | 14.0 |
  | 2017 | 14.10 |
  | 2019 | 14.20 |
  | 2022 | 14.30 |

- **2010 and 2013 are not judged yet.** Their keys (`10.0\VC\VCRedist`, `12.0\VC\Runtimes`) are
  spelled from Microsoft's documentation and absent on the only machine measured, so their meaning
  when *present* is unverified. Until a machine that has them has been read, both answer *could not
  tell*. That is one artifact, `mysql 5.6.51`, and `SmokeTest` still stands in front of it.
- **A value this build does not understand is not a lack.** A year the table has no row for, a
  version that is not dotted integers, a `requires` key this build does not model: *could not tell*.
  An index published after this build must not make it refuse things.
- **`cpu` is modelled and not judged.** Added to `Requires` so the MongoDB rows stop being dropped
  on the floor, and judged by nothing — no kind this build installs declares it, and a probe with no
  consumer is code nobody exercises. The task that makes MongoDB installable is where it is read.
- **`tzdata` stays unmodelled**, for the reason `format.rs` already gives: it is prose, and a
  sentence is not a precondition a machine can be compared against.

The judgement is a list of **unmet** requirements. *Could not tell* never appears in it: **only a
certain lack refuses**, and everything uncertain is left to `SmokeTest`, exactly as today.

## D3 — What can be fetched is fetched; what cannot is routed around

Each unmet requirement carries one remedy, decided by the daemon:

| Unmet | Remedy | What a client draws |
| --- | --- | --- |
| `vcredist` 2015–2022, artifact `x86_64` or `aarch64` | **Install** the *Visual C++ 2015–2022 Redistributable* for that architecture | "MixEngine will install it — Windows will ask for administrator approval" |
| `glibc` | **Choose** the newest published version of the same kind whose artifact this machine meets | "The newest PHP that runs here is 8.3.33" with an install action |
| `macos` | **Choose**, as above | as above |
| any, and no version of the kind is met | **None** | the requirement, stated; no action |

**Choose is a suggestion and never a substitution.** The version somebody asked for is the version
that gets installed or refused; a daemon that quietly installed 8.3 when asked for 8.4 would be
deciding something only the person can. The suggested version is found by walking the stable
releases of the kind newest first and judging each one's selected artifact with the same snapshot.

**No Install remedy exists for glibc or macOS**, and none is planned: upgrading an operating system
is not something a development environment does to a machine.

## D4 — The answer is a question the client asks first

Because a refusal cannot carry a remedy (the wire `Error` has no data), the remedy travels in typed
answers, and there are three places a client meets it:

1. **The listings.** `RuntimeRelease` and `PackageRelease` gain an optional `needs` — the unmet
   requirements of the artifact this machine would install, each with its remedy — added under ADR
   0019, where `None` means a peer that predates the member. `mix runtime available` and
   `mix package available` grow a `NEEDS` column **only when a row has something in it**, the way
   T92's `RUNS` column appears.
2. **A read method per namespace**, `runtime.requirements` and `package.requirements`, taking the
   existing `RuntimeTarget` / `PackageTarget` and answering the same list. It is what `mix` asks
   before an install and what the window asks when an install starts from anywhere other than a
   listing row.
3. **The install itself re-judges**, with a fresh snapshot, because the daemon does not trust that
   the client asked and because the machine may have changed since.

`runtime.install` and `package.install` take new params types that flatten the target, on
`RuntimeUninstall`'s pattern:

- **`install_prerequisites`** — the person agreed to what the Install remedies will do. Without it,
  an install whose judgement holds an Install remedy is refused before a job is created, with
  `DependencyMissing`, a message naming the runtime and a hint naming the flag.
- **`ignore_requirements`** — skip the judgement entirely, for a probe that is wrong about this
  machine. `SmokeTest` still runs: the flag sets aside MixEngine's prediction, never the proof.

An install whose judgement holds only Choose or None remedies is refused before a job is created,
with `DependencyMissing` and the suggested version in the hint.

Every refusal in this section happens **before the job exists**, so it arrives as the call's answer
and not as a failed job, and nothing is downloaded.

## D5 — Nobody sees an administrator prompt they did not agree to

T40b's rule, unchanged: the daemon never raises a prompt because a call happened to need one.

- **The window** asks `*.requirements` (or reads `needs` off the row), and when an Install remedy is
  present shows one dialog naming what will be installed, who publishes it, and that Windows will ask
  for approval. Agreeing sends the install with `install_prerequisites`. A Choose remedy is a second
  button that installs the suggested version instead.
- **`mix runtime install` / `mix package install`** ask the same question on the terminal,
  `[y/N]`. End of file is refused, not assumed. `--yes` answers in advance and sets
  `install_prerequisites`. `--json` requires `--yes`, as it does for elevation.
  `--ignore-requirements` maps to its param.

## D6 — Installing the redistributable

Inside the install job, before the artifact's own download, when `install_prerequisites` is set and
the judgement holds an Install remedy:

1. **Fetch from an address written into the daemon**:
   `https://aka.ms/vs/17/release/vc_redist.x64.exe` or `…/vc_redist.arm64.exe`. Not from the index
   and not from configuration — nothing a third party can edit chooses what is about to run with
   administrator rights. The download reuses the installer's HTTP client and cache directory.
   Measured 2026-09-16: both answer `301` to `download.visualstudio.microsoft.com` and then `200`,
   25,635,768 bytes for x64 and 11,722,336 for ARM64. **The size is not shown before somebody
   agrees**: learning it is a request to Microsoft, and a listing that made one per row would be a
   listing that reaches a third party every time a screen opens. Downloads are capped at 64 MiB.
2. **Believe it only after three checks**, in `mixengine-platform`:
   - `WinVerifyTrust` with `WINTRUST_ACTION_GENERIC_VERIFY_V2` and whole-chain revocation checking
     accepts the file;
   - the leaf certificate's subject organisation is exactly `Microsoft Corporation`;
   - the file's version resource names the Visual C++ Redistributable, so a different
     Microsoft-signed program at that address is refused too.
3. **Hold the file against change** from before the first check until the installer has started: a
   handle opened with `FILE_SHARE_READ` only, the mechanism the single-instance lock already uses,
   so the bytes that were verified are the bytes that run.
4. **Open it as an ordinary program**, `ShellExecuteExW` with the `open` verb and
   `/install /quiet /norestart`. The installer asks Windows for elevation itself, as it does when
   somebody double-clicks it, and the approval dialog shows the verified publisher. MixEngine
   requests no token and `mixengine-elevate` is not involved.
5. **Read the exit code**: `0` installed; `1638` a newer one was already there; `3010` installed and
   Windows wants a restart, which the job's final message says. Anything else fails the job with the
   code, and a declined approval dialog is reported as declined.
6. **Take a new snapshot and judge again.** Whatever the exit code said, the artifact's download does
   not start unless the requirement is now met.

**The job cannot be cancelled while the installer runs**, because MixEngine has no right to stop an
elevated process. The job's progress message says so while that step lasts, rather than offering a
cancel that does nothing; cancellation is honoured before the step starts and after it ends.

**This is an elevated process started because MixEngine asked**, whatever launches it. The security
model's sentence that `mixengine-elevate` is the only elevated component stops being true without
qualification, and that is **ADR 0037**'s to state: what is allowed (a Microsoft-signed Visual C++
Redistributable, from a fixed address, after the three checks, after a person agreed), what is not
(anything else, ever, through this path), and why the helper is not the route (it would need an HTTP
client and a path argument, both of which ADR 0005 keeps out of it).

## D7 — Blueprints

**`blueprints::plan` is not touched.** It cannot judge a step, because it does not know the release
a constraint resolves to and must not learn it (the T78 design's D9). The judgement happens in the
daemon, around the plan, at the two moments it already resolves or could:

- **The dry run** resolves every `Create` install step the way `Api::resolve` does, judges each
  resolved artifact against one snapshot, and answers
  `BlueprintApplyResponse::Planned { plan, needs }` — `needs` optional under ADR 0019, and deduplicated,
  so three PHPs that each need the Visual C++ runtime are **one** requirement and one question. An
  index that cannot be read at dry run leaves `needs` absent rather than failing the dry run:
  nothing here may make a plan unprintable.
- **The apply job** judges again immediately after `Api::resolve`, before the first step writes to
  the ledger. An Install remedy with `install_prerequisites` installs the redistributable there,
  once; without it — or with any Choose or None remedy — the job fails with the requirements named
  and nothing written. `ignore_requirements` skips the judgement.

`BlueprintApply` gains the two flags. `mix blueprint apply` renders `needs` with the plan and asks
the same `[y/N]` once for the whole plan; MixLab's apply dialog does the same.

## D8 — What this is not

- **Not a glibc or macOS installer**, and not a plan for one (D3).
- **Not an AVX probe.** `cpu` is modelled and not judged (D2).
- **Not MongoDB support.** No kind this build installs declares `cpu`; making MongoDB a service is
  its own task.
- **Not a change to `mixengine-elevate`.** Its source, features and dependency closure are untouched,
  and CI's diff of that closure is the proof.
- **Not a mirror.** The redistributable is not republished through `mixengine-packages`: a mirror
  goes stale when Microsoft patches the runtime, and whether its licence permits a package index to
  redistribute it is a question this task does not need to answer.
- **Not the self-update feed.** `updates/feed` selects MixEngine's own build and has no `requires`.
- **Not a replacement for `SmokeTest`** (above).

## Verification

**Step zero, before any code**: on a Windows machine, launch `vc_redist.x64.exe /install /quiet
/norestart` from an unelevated process with the `open` verb, and observe three things — that Windows
raises the approval dialog, that the exit code arrives, and what a *declined* dialog produces — with
a `FILE_SHARE_READ`-only handle held on the file throughout. Also read the file's signer with
`Get-AuthenticodeSignature`, so the subject string D6 compares against is the one Microsoft actually
signs with rather than the one this document expects. D6 is built on all of it; if any of it does
not hold, this design comes back for review before anything else is written.

**Measured 2026-09-16, Windows 11 Pro 26200, x64, runtime 14.50.35719 already present:** signature
`Valid`, subject `CN=Microsoft Corporation, O=Microsoft Corporation, L=Redmond, S=Washington, C=US`;
`ProductName` `Microsoft Visual C++ 2015-2022 Redistributable (x64) - 14.44.35211` (aka.ms served an
older build than the machine had); launched unelevated with `open` while a `FILE_SHARE_READ` handle
was held: the launch succeeded and exit `1638` arrived both times, **with no approval dialog** — the
Burn bundle is `asInvoker`, detects before it plans, and logged `WixBundleElevated = 0`. So the
dialog is raised by the bundle's own elevated child only when there is something to install, and a
decline surfaces as the bundle's exit code, never as `ERROR_CANCELLED` from `ShellExecuteExW`. Which
code a decline produces (`1223` or `1602`) could not be measured on this machine; both already map to
*declined*. It is measured on the M18 run, on a machine with no runtime.

- **The judgement** — unit tests in `mixengine-core`, no OS: met, unmet and could-not-tell for each
  fact; `Minor=50` meeting 2022; an unknown year, an unparseable version and an unmodelled key never
  refusing; an x86_64 artifact on an ARM64 snapshot judged against the x64 key; Choose finding the
  newest met version and None when there is none.
- **The probes** — tests that run on each OS in CI and assert a parseable present-or-absent answer
  from the real machine, never *could not tell* on a supported runner.
- **The signature checks** — the downloaded installer is accepted; the same file with one byte
  flipped is refused; an unsigned file is refused. The download needs the network, so these are
  `#[ignore]`d and run from the release checklist, the way `tests/index.rs` reaches the published
  document.
- **The wire** — the new params parse without their flags, and a listing without `needs` parses, so
  older peers keep working; `packaging/bindings.sh` regenerates `bindings/`.
- **The refusals** — a daemon test with a snapshot fixture: an install without consent is refused
  before a job exists and nothing is downloaded; with `ignore_requirements` it proceeds.
- **The window** — tests for the dialog: Install remedy, Choose remedy, None.
- **The milestone, by hand**: on a Windows machine with no Visual C++ runtime, choosing PHP 8.3 in
  the window and agreeing once produces one approval dialog naming Microsoft Corporation and ends
  with `php -v` answering.

## Risks

- **Microsoft moves the address or changes the signing subject.** Either makes step 1 or 2 fail
  loudly, and the install is refused with the reason — never run unverified. The `/vs/17/` in the
  address names a Visual Studio generation, so a future one may publish under another; this build
  keeps asking for the one it knows, and the re-judgement says whether what it installed was enough.
- **A runtime present without its registry key** — installed app-locally, or by a tool that does not
  register it — reads as absent and would ask to install something already there. `1638` and the
  re-judgement make that harmless for the 2015–2022 family, and `ignore_requirements` is the way
  past it for anything else.
- **A standard-user account** is asked for administrator credentials rather than consent. That is
  Windows' behaviour for any installer and the dialog says so; the job reports a declined dialog as
  declined.
- **Somebody running as the same user swaps the file** between verification and launch. Step 3 holds
  it; and such a person can already start any installer and raise the same dialog, which names the
  publisher of what actually runs.
- **`3010`** leaves a machine that wants a restart. The install continues, because the runtime's DLLs
  load without one; the message says a restart was requested.

## Tasks

A proposed split, settled in the roadmap file:

- **T148** the snapshot (D1) and the judgement (D2), with `cpu` modelled and the `Requires` doc
  comment corrected.
- **T149** the listings' `needs`, the two `*.requirements` methods, and the refusals (D3, D4).
- **T150** the redistributable: download, the three checks, the launch, the re-judgement, and
  ADR 0037 (D6).
- **T151** consent in `mix` and in the window (D5).
- **T152** blueprints (D7).
