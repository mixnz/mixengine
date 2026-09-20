---
status: approved
date: 2026-09-20
task: T175
---

# T175 — Dependencies that earn their place

T173 took the `window` build from a 17.5–18.5 band to 9.1 minutes by asking cargo to optimise less.
That lever is spent: off a tag it is already at `opt-level = 0`, and a tag has to build what a tag
builds. What is left is the work itself, and T173c built the instrument that shows where it is —
`MIX_TIMINGS=1`, one repository variable, no commit.

**The report is the argument.** Run 35486085024, the `window (windows-latest)` leg, at `opt-level = 1`:

| | |
| --- | --- |
| units in the graph | 908 |
| their work added up | 2498 s |
| wall of the cargo graph | 15.6 min |
| elapsed before `mixlab` starts | 624 s |
| **`mixlab` itself** | **306 s**, against 4.4 s to link it |

So there are two questions, not one: what the 908 dependencies cost, and what this crate's own
34,000 lines cost. They have very different answers.

## What the dependencies cost, and who asks for them

| Crate | Cost | Asked for by |
| --- | --- | --- |
| `mongodb` | 112.5 s | the db module — Mongo is a product feature (phase 19) |
| `windows` 0.61.3 | 75.5 s | `tauri` and `tao` |
| `sqlx-postgres` + `-mysql` + `-sqlite` + core | ~180 s | the db module — three drivers, all shipped |
| **`moxcms`** | **54.6 s** | `image` |
| `windows` 0.62.2 | 49.7 s | `russh` → `pageant`, and `sysinfo` → `mixengine-platform` |
| **`image`** | **44.5 s** | `arboard` |
| `rustls` | 44.3 s | `mongodb` (documented in `Cargo.toml`: its only alternative is OpenSSL) |
| `russh` | 35.2 s | the terminal module — SSH tunnels |
| `hickory-proto`/`-resolver`/`-net` | 51.3 s | `mongodb`'s `dns-resolver` |
| **`bson` 2.15.0** | **26.0 s** | `mongodb`'s default `compat-3-0-0`, beside the bson 3 the app uses |

Three of those are bold because nothing in this product asked for them.

### F1 — 102 seconds for a clipboard that only reads text

`image` (44.5) + `moxcms` (54.6) + `arboard` (3.1) enter through
`tauri-plugin-clipboard-manager` → `arboard`, whose default feature `image-data` pulls `image` for
clipboard *pictures*.

What this application asks of that plugin is one call: `readText()` in
`src/modules/terminal/clipboard.ts`, so a paste reaches the terminal without WebView2's
`clipboard-read` prompt. `capabilities/default.json` grants exactly `clipboard-manager:allow-read-text`
and nothing else. Images go through `navigator.clipboard` in the webview
(`src/core/clipboard.ts`, `copyImage`) and never touch Rust.

**It cannot be switched off from here.** The plugin declares
`arboard = { version = "3", features = ["wayland-data-control"] }` without `default-features = false`,
and cargo features are additive: nothing in our `Cargo.toml` can subtract one.

### F2 — 26 seconds of a bson nobody calls

`mongodb`'s default set is `compat-3-0-0`, `rustls-tls`, `dns-resolver`, and `compat-3-0-0` pulls
**bson 2.15 in addition to bson 3**. Every use in this application is through `mongodb::bson::…` —
`doc`, `Document`, `to_document`, `spec::BinarySubtype`, `de::Error` — which is the bson the driver
itself re-exports.

### F3 — 125 seconds of two `windows` crates, and not ours to fix

0.61.3 comes with `tauri` and `tao`; 0.62.2 with `russh` → `pageant` and with `sysinfo` →
`mixengine-platform`. Only the last is ours, and pinning `sysinfo` back would merge one of the two
users while changing a crate the daemon also depends on. **This is a note for the next Tauri
upgrade, not a task**: when `tauri` moves to 0.62 the duplicate disappears by itself.

### The cut that was checked and refused

`dns-resolver` — 51.3 s of hickory — looked like the same kind of default nobody asked for, until
`modules/db/drivers/mongo.rs` turned out to call `ClientOptions::parse(uri)` and
`drivers/dump.rs` to have a `mongodb+srv://` branch with tests of its own. An SRV connection string
is a supported thing a person can paste. **It stays**, and this paragraph is here so the next
person does not spend the afternoon rediscovering it.

## D1 — The clipboard plugin becomes one command of our own

Drop `tauri-plugin-clipboard-manager`; depend on `arboard` directly with `default-features = false`
and `features = ["wayland-data-control"]`, which is what the plugin asked for beyond the default;
expose one `#[tauri::command]` that returns the clipboard's text; point
`src/modules/terminal/clipboard.ts` at it and drop the capability entry.

The plugin is a thin wrapper over exactly this. What is given up is its iOS and Android paths,
which this product does not build, and its `writeText`, which nothing here calls — the webview
writes text itself.

## D2 — `mongodb` without its default features

`default-features = false, features = ["bson-3", "rustls-tls", "dns-resolver"]`: the same three the
default set turns on, minus the bson-2 compatibility layer. If anything in the db module turns out
to need the 2.x types, the compile says so immediately and this decision is reverted in one line.

## D3 — `mixlab`'s own 306 seconds, measured before any refactor

`modules/db` is **28,786 of the 34,000 lines** of Rust in this crate; `terminal` is 1,143, `rest`
609, `tools` 406 and `mixengine` 2,321. One crate means one single-threaded front end, and
`codegen-units = 16` does not divide that.

Moving `modules/db` into a crate of its own would let its codegen overlap with the rest of the
application's compile. **Whether that is worth a refactor of 29,000 lines is a measurement, not an
opinion**, and the instrument already exists: build once with `db` split out behind a branch that is
never merged if the number does not appear, and read `--timings` for when `mixlab` starts and how
long it takes.

**The bar: two minutes off the `window` leg's cargo wall**, at the same profile, or the split is
abandoned and this section records that it was tried. Below that it is 29,000 lines moved for a
saving the host-to-host variance can hide.

The split must keep ADR 0027: the new crate may depend on `mixengine-proto` and `mixengine-platform`
and nothing else in this workspace, which `apps/desktop/src-tauri/tests/layering.rs` already checks.

## How this is judged

**Unit-seconds are not wall-seconds.** Removing 128 s of work from a graph that runs four units at a
time is worth tens of seconds of wall, not minutes, and only if the crate was on the critical path.
D1 and D2 are worth doing because a dependency nothing asks for is a dependency nobody audits, and
the time is a bonus; **D3 is the only one with minutes in it.**

The instrument is `--timings` (T173c), because its per-crate numbers do not care which host the leg
landed on — the thing that made T173's first measurement unreadable. For each change: the crate is
gone from the report and nothing has taken its place. The leg's wall time is the secondary reading,
against `window (windows-latest)`'s post-T173 band.

## What must not change

- Pasting into the terminal, on all three systems — the one thing the clipboard plugin did here.
- Mongo: `mongodb+srv://`, TLS, and what `dump.rs` does with a tunnel.
- The layering ADR 0027 allows, and `npm run lint`'s rule that the toolbox modules never import
  from the `mixengine` module.

## The tasks

- **T175a** The clipboard plugin is replaced by a direct `arboard` dependency without `image-data`,
  and `image`, `moxcms` and the plugin leave the tree.
- **T175b** `mongodb` is taken without default features, keeping `bson-3`, `rustls-tls` and
  `dns-resolver`; bson 2 leaves the tree.
- **T175c** Whether `modules/db` becomes a crate of its own is decided by one measured build against
  the bar in D3, and the answer — either way — is written into the phase file.

**Milestone M28**: the `--timings` report for the `window` leg holds no `image`, no `moxcms` and no
`bson 2`, terminal paste still works on all three systems, and T175c's measurement is recorded
whichever way it went.

## Accepted costs

**E1 — A plugin dropped is a code path owned.** The command, its error and its capability entry
become this repository's. It is about twenty lines, and the alternative is 102 s of compile for a
feature the product does not have.

**E2 — `default-features = false` is a line that ages.** A later `mongodb` release can move
something needed into its default set, and the compile will say so — which is the good case. The
bad case is a runtime feature that silently was not compiled in, so the Mongo suite is what has to
stay green, not just the build.

**E3 — The dependency cuts are small in wall time, and this spec says so rather than implying
otherwise.** Their better argument is the tree: 908 units is a lot to audit, sign and ship, and two
of them are here because a clipboard plugin wanted to paste pictures.
