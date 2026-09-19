# T166 — A checkout on an external disk, and a refusal somebody can read

Roadmap task [T166](../../../.claude/roadmap/phase-17-a-disk-somebody-chose.md), phase 17. 2026-09-19.

**The case this comes from**: this repository checked out on an external SSD
(`/Volumes/SSD/app/mixengine`), MixLab started with `npm run dev:app`. The window spawned

```
mixengined --home /Volumes/SSD/app/mixengine/.mixengine-home --runtimes /Volumes/SSD/… …
```

and every Allow on the administrator prompt ended in *the elevation helper left no report beside
…/run/elevate/oZP6HOJESJfj4mK6/response.json*. `/Library/Logs/MixEngine/elevate.log` has no line
for any of those runs. Re-running the same `osascript` line by hand with a lone `probe` said why:

```
execution error: mixengine-elevate: cannot read …/run/elevate/diagtest2/request.json:
                 Operation not permitted (os error 1) (65)
```

It is T143's incident again — TCC gates a removable volume, and the helper arrives through
`osascript` and `authtrampoline` with no responsible process to inherit a grant from — reached by
a road T143 did not close. T143 kept `run/` fixed so that `[paths]` could move everything else
safely; it said nothing about **who picks the home**. For a development build that is not a person,
it is the repository:

- `.cargo/config.toml` sets `MIXENGINE_HOME = { value = ".mixengine-home", relative = true }` for
  everything cargo runs;
- `apps/desktop/scripts/stage-daemon.mjs:49` defaults to `join(root, ".mixengine-home")` so that the
  window's daemon and a terminal's `cargo run` are one daemon.

So a checkout on an external disk puts `run/` on it, whatever the developer chose with the storage
picker. And the message that reached the window was the same sentence T143 already called *true and
says nothing a person can act on*: the helper **wrote** the reason to stderr, and the daemon only
logs stderr at `debug`.

Two parts, independent of each other:

- **A** — a development build does not put its home where root cannot read it. **macOS only.**
- **B** — when the helper leaves no report, what it said is in the error. **Every OS.**

## What is already true

- **ADR 0024** gives a non-release build its own default home, beside the released one:
  `~/Library/Application Support/MixEngine-dev` on macOS. The released `MixEngine` is never touched by
  a development build, and every OS's build script refuses to ship an artifact without the release
  marker. The `.cargo/config.toml` entry predates that ADR and is described there as *the path a
  developer walks*, not the fix.
- **Three places resolve a home, all through `HomeDirs::default_home()`** when nothing overrides it:
  `mixengine_cli::home` (`mix`), `mixengine_core::paths::resolve_root` (`mixengined`), and
  `apps/desktop/src-tauri/src/modules/mixengine/endpoint.rs::home` (the window, which then passes
  `--home` to the daemon it spawns). `MIXENGINE_HOME` and `--home` win over all three.
- **cargo's config is hierarchical.** `tauri dev` builds `apps/desktop/src-tauri` from below the
  repository root, so the root `.cargo/config.toml` `[env]` reaches the window as well.
- **The helper's refusals are sentences on stderr** with exit codes 64/65/69/70
  (`crates/mixengine-elevate/src/main.rs`), and it writes no response when it refuses — by design:
  an untrusted request gets no file beside it.
- **Where stderr goes today**: macOS `osascript.output()` captures it and logs it at `debug`
  (`macos/prompt.rs`); Linux runs `pkexec … .status()`, so it goes to the daemon's own stderr;
  Windows `ShellExecuteExW` with `runas` gives the elevated process no stream we own.
- **T40a D7**: the helper's exit code goes no further than a log line, because a caller that
  *branched* on it would branch on something Windows cannot supply. Part B does not branch on
  anything — it carries a sentence for a person — so D7 stands.

## A — the development home follows the checkout, unless root cannot read it there

### D1. A suggestion, not an override

`.cargo/config.toml` stops setting `MIXENGINE_HOME` and sets **`MIXENGINE_DEV_HOME`** instead, with
the same value (`.mixengine-home`, relative to the repository root). `MIXENGINE_HOME` keeps its
meaning — *a person chose this* — and stays authoritative over everything below.

`stage-daemon.mjs` stops computing a home. It passes the same `MIXENGINE_DEV_HOME` suggestion —
its `mix daemon stop` runs outside cargo and would not otherwise see it — and lets the binaries
decide; its messages speak of *this checkout's daemon* rather than naming a path the rule in Rust
may have passed over.

### D2. One function decides, in `mixengine-platform`

A new `mixengine_platform::home::development_home() -> Option<PathBuf>`:

1. `None` in a release build (`RELEASE` is true), unconditionally — `MIXENGINE_DEV_HOME` means
   nothing to a shipped binary.
2. `None` when `MIXENGINE_DEV_HOME` is unset or empty.
3. `None`, with a `warn` log naming both paths, when **this OS says an elevated helper could not
   read that directory** (D3).
4. The path otherwise.

The three resolvers become: `--home` / `MIXENGINE_HOME` → `development_home()` →
`default_home()`. One function, so `mix`, `mixengined` and the window cannot disagree — the property
`stage-daemon.mjs` exists for, now held by the binaries rather than by a script.

**Read at each binary's edge, never inside `mixengine-core`.** `mixengined` applies it right after
clap, beside `--home` and `MIXENGINE_HOME`; `core::paths::resolve_root` reads no environment. The
first cut read it there, and a test calling `open_home(None, mock_host)` under cargo — where the
variable is always set — reached the checkout's real home instead of the mock's.

`default_home()` is unchanged: its tests (`crates/mixengine-platform/tests/home.rs`) keep asserting
the ADR 0024 table, and they run under cargo, where `MIXENGINE_DEV_HOME` is set — which is why the new
rule is a separate function rather than a branch inside `default_home()`.

### D3. "Root cannot read it", per OS

A method on the platform, since this is OS knowledge:

- **macOS**: the path, made absolute and passed through `in_full`, starts with `/Volumes/`. That is
  every volume other than the boot volume's system/data group — `/Volumes/Macintosh HD` is a symlink
  to `/`, so `in_full` resolves it away. External, network and secondary volumes all land here, and
  TCC gates all of them for a process with no responsible parent. The directory need not exist yet:
  when it does not, the check walks up to the nearest ancestor that does.
- **Linux, Windows**: always readable. Root and an elevated token read an ext4/NTFS external disk;
  the Linux cases that fail the same way (FUSE without `allow_other`, NFS `root_squash`, a FAT mount
  with world-writable masks) are not worth guessing at — Part B makes them legible instead.

### D4. What a developer on an external disk sees

The window's daemon and `cargo run -p mixengine-cli` both land on
`~/Library/Application Support/MixEngine-dev`. The installed MixLab keeps `…/MixEngine`. The storage
picker still offers to put `runtimes/`, `packages/`, `data/`, `logs/` on the external disk, which is
what T143 made safe.

**Nothing is moved.** An existing `<repo>/.mixengine-home` on an external disk is left where it is,
on ADR 0024's reasoning: moving somebody's database on a guess is worse than an empty new home. The
`warn` line from D2 names the directory that was passed over, so the old one is findable.

## B — a helper that left no report says why

### D5. The platform hands back what the helper said

`Elevation::run` returns `Result<Raised>` instead of `Result<ElevationOutcome>`:

```rust
pub struct Raised {
    pub outcome: ElevationOutcome,
    /// What the helper wrote to stderr, trimmed, at most 1 KiB, when this OS let us read it.
    pub said: Option<String>,
}
```

`ElevationOutcome` and its wire form (`GrantOutcome` flattens it, `bindings/ElevationOutcome.ts`)
**do not change** — `said` is a diagnostic for one error message, not a field a client renders or
matches on.

- **macOS**: from osascript's stderr, with AppleScript's framing removed — the leading
  `<n>:<n>: execution error: ` and the trailing ` (<code>)` that `error_code` already reads. What is
  left is the helper's own line: `mixengine-elevate: cannot read …: Operation not permitted`.
- **Linux**: `pkexec` is run with `.output()` instead of `.status()`, so the helper's stderr is
  captured rather than lost in the daemon's. stdin was never used (`--disable-internal-agent`).
- **Windows**: `None`. There is no stream to read; the exit code stays in the `debug` line (D7).

### D6. The error carries it

`Error::ElevateReportMissing` gains `said: Option<String>`, and its message becomes

```
the elevation helper left no report beside <path>: <said>
```

falling back to today's sentence when `said` is `None`. The daemon's `Completed` arm passes
`raised.said` into `read_report`'s missing case. `mix elevation grant` and the window already print
the error's message, so both show the reason with no client change.

## Not in scope

- **A daemon that warns when `MIXENGINE_HOME` itself is on a TCC-gated volume**, in a release build.
  D3's check would answer it, and `elevation.status`'s `reason` is where it would go — but a person
  who set `MIXENGINE_HOME` chose that path, and B now tells them what went wrong. A follow-up if it
  keeps happening.
- **Windows' reason.** Getting stderr out of a `runas` child would need the helper to write it
  somewhere, which is exactly the file it refuses to write beside an untrusted request.

## Decision record

**ADR 0040 — a development build's home follows its checkout, unless root cannot read it there.**
Records D1–D3 and D4's "nothing is moved"; ADR 0024 stays accepted and is not edited — this narrows
the `.cargo/config.toml` entry it describes, and leaves its release/dev split as it was.

## Tests

- `development_home()`: `None` without the variable, with an empty one, and for a macOS path under
  `/Volumes/` (through the mock host's readability answer, so it runs on every OS); the path otherwise.
- Each of the three resolvers: `MIXENGINE_HOME` beats `development_home()`, which beats
  `default_home()`.
- `macos::said` (pure): strips the AppleScript framing from the stderr captured in this incident, and
  leaves a line with no framing unchanged.
- `ElevateReportMissing`'s message with and without `said`.
- A daemon test with a mock prompt that "says" a refusal and leaves no report: the grant job fails
  with a message ending in that sentence, and the operation stays pending. At the daemon rather than
  the CLI because that is where a mock prompt is reachable, and `mix` prints the message verbatim.

## Files

- `.cargo/config.toml` — `MIXENGINE_HOME` → `MIXENGINE_DEV_HOME`.
- `apps/desktop/scripts/stage-daemon.mjs` — no home of its own.
- `crates/mixengine-platform` — `home::development_home`, the per-OS readability check,
  `Raised`, `macos::said`, Linux `.output()`, mock updates.
- `crates/mixengine-cli/src/home.rs`, `crates/mixengine-daemon/src/main.rs`,
  `apps/desktop/src-tauri/src/modules/mixengine/endpoint.rs` — the resolution order.
- `crates/mixengine-core/src/lib.rs`, `crates/mixengine-core/src/elevation.rs`,
  `crates/mixengine-daemon/src/elevation.rs` — `said` on the error and through the grant.
- `.claude/decisions/0040-…md`, `.claude/roadmap/phase-17-a-disk-somebody-chose.md` (T166 as a
  follow-up to T143), `.claude/roadmap/todo.md`, `.claude/architecture/overview.md` (the `run/`
  paragraph gains the development-home sentence).
