# T72b — one transport for three signed documents (design)

Roadmap task **T72b**, phase 7: *"Where the five megabytes went: find what the idle daemon holds on
2026-09-07 that it did not on 2026-08-30 … What this task owes is a reading per suspect and either a
fix or a sentence saying why the memory is worth holding, after which `DAEMON_BUDGET` in
`idle_footprint.rs` is set again from what is measured. Not a licence to raise it a second time."*

## What was measured, and how

Three paired, repeated runs of
[`idle_footprint.rs`](../../../crates/mixengine-cli/tests/idle_footprint.rs), release, on one machine,
each pair separated only by the setting under test — the roadmap's own list of seven suspects turned
out to be incomplete (T80 and T81 also landed inside the window and are not on it), so rather than
bisecting seven-plus tasks one at a time, the question was split in two: *how much of the week's
growth is T88's, and how much is everything else's.*

| Build | `updates.enabled` | daemon RSS (median of 3 runs) |
| --- | --- | --- |
| commit `62f6f7a`, 2026-08-30 (T72 itself) | *(feature does not exist yet)* | 29.5 MB |
| HEAD, 2026-09-07 | `false` | 30.8 MB |
| HEAD, 2026-09-07 | `true` (the default) | 34.3 MB |

Two numbers fall out of that:

- **Everything landed this week except T88's own check costs ~1.3 MB** (30.8 − 29.5), spread across
  T77b, T80, T81, T83, T84, T88a, T96 and T97. Too small and too distributed to be one cache
  somewhere; read as the ordinary cost of a week's more code and more static data, not investigated
  further — this is this task's "sentence," for that ~1.3 MB.
- **T88's startup check costs ~3.5 MB** (34.3 − 30.8), reproduced identically across three separate
  pairs of runs. This is this task's "fix," argued below.

`updates.enabled = false` does **not** skip constructing
[`Updates::new`](../../../crates/mixengine-daemon/src/updates.rs:157) — only the periodic task it
hands to [`updates::start`](../../../crates/mixengine-daemon/src/updates.rs:758) — so the 3.5 MB is
specifically the cost of the **eager startup fetch** `updates.enabled` cannot turn off: an HTTPS
connection to GitHub, a minisign verification, and a parsed [`Feed`] held in
[`Updates::last`](../../../crates/mixengine-daemon/src/updates.rs:120) for the rest of the daemon's
life.

**What this reading is not is a proof of mechanism.** The measurement window is the settle plus five
readings — under a minute since start — which sits inside `reqwest`'s default 90-second idle-connection
lifetime, so the pooled connection from that one fetch is plausibly still open when the last reading is
taken. Whether the RSS these 3.5 MB describe would fall on its own after that connection closes is not
tested here, on the module's own rule for what this measurement honestly is: worse than a real idle
machine's, on purpose, because an allocator gives memory back to the OS slowly or not at all. The fix
below is argued from what it removes, not from a profiler trace of what it removed.

[`Feed`]: ../../../crates/mixengine-core/src/updates/feed.rs

## Goal

Three long-lived HTTP clients where the daemon's own comment already argues for one. Bring
`update.*`'s client under the rule `runtime.*` and `package.*`'s already follows, and re-measure
before touching the budget.

## Scope

**In:**

- `mixengine_core::index::Client<D>`: a constructor that takes an existing `reqwest::Client` instead
  of building one.
- `mixengined`'s `main`: one `reqwest::Client`, built once, handed to the package index client, the
  extension registry client and the update feed client in place of the three each builds today.
- Re-measuring `idle_footprint.rs` after the change, and only then moving `DAEMON_BUDGET`.

**Out:**

- The ~1.3 MB the measurement above already assigned to "ordinary growth" — no fix proposed, per the
  reading above.
- Anything about *when* the update feed is first read. `updates.md`'s "daemon check at startup" is a
  requirement this task does not touch — the fetch still happens, on the same schedule; only how many
  `reqwest::Client`s exist to make it changes.
- Retrying the pool-lifetime question with a profiler. If D1 alone does not close enough of the gap on
  re-measurement, that is this task's own next reading, taken with numbers rather than argued in
  advance.

## Decisions

### D1 — one `reqwest::Client`, built once, shared by all three document clients

Three places build their own transport today, each through the same generic constructor:

| Client | Document | Built at | Held by |
| --- | --- | --- | --- |
| [`runtimes::Fetcher`](../../../crates/mixengine-daemon/src/runtimes.rs:115) | package index | `main`, [runtimes.rs:132](../../../crates/mixengine-daemon/src/runtimes.rs:132) | the daemon's whole life |
| [`extensions::registry::client`](../../../crates/mixengine-core/src/extensions/registry.rs:149) | extension registry | `main`, [main.rs:1460](../../../crates/mixengine-daemon/src/main.rs:1460) | the daemon's whole life |
| [`updates::Updates`](../../../crates/mixengine-daemon/src/updates.rs:96) | update feed | `main`, [main.rs:1488](../../../crates/mixengine-daemon/src/main.rs:1488) | the daemon's whole life |

All three go through [`index::Client::<D>::with`](../../../crates/mixengine-core/src/index.rs:203),
which builds its own `reqwest::Client::builder().timeout(FETCH_TIMEOUT).user_agent(…).build()` —
identical settings, three times, three separate TLS configurations and root-certificate stores, three
connection pools that will only ever hold one host's connections each.

**`Fetcher`'s own doc comment already states the rule this task is applying one layer down**: *"One
per daemon, and not one per namespace … The pair is built once, where the public key is checked, and
handed to both"* — written for the index client and the installer that shares its cache directory.
`reqwest::Client` is the same shape of thing: cheap to clone (it is an `Arc` internally, per its own
documentation), expensive to build, and meant to be built once and reused across every host a process
talks to — not once per host.

**The change**: `index::Client::<D>::with` keeps its signature and behaviour, for the unit tests and
any external caller that has no client to share. A new `index::Client::<D>::with_transport(url,
public_key, cache_dir, http: reqwest::Client)` takes one in; `with` becomes `with_transport` given a
freshly built default. `main` builds one `reqwest::Client` immediately before
[runtimes.rs:132](../../../crates/mixengine-daemon/src/runtimes.rs:132) — beside the check that a
supplied `--index-key` parses, since a client that cannot be built should fail the start on the same
rule the key does — and `.clone()`s it into the fetcher, the registry client and `Updates::new`.

Nothing about *what* each client reads changes: three URLs, three public keys, three cache files, one
transport underneath them. A `--update-url` pointed somewhere else still fails independently of the
package index; only the object that opens a socket is shared.

### D2 — the pool question is re-measured, not pre-decided

`reqwest`'s default keeps an idle connection for 90 seconds, which already covers most of why this
measurement — under a minute since start — might be seeing a connection that a truly idle daemon
would have let go of on its own. Shortening that window, or dropping the pool entirely for a client
used at most once a day, is a plausible second lever, and is deliberately **not** part of this
change: D1 is argued from what it removes (two redundant TLS configurations and connection pools that
never do anything), and this would be argued from a guess about allocator behaviour nobody here has
measured, which is exactly the mistake `DAEMON_BUDGET`'s own comment already warns against making
twice.

So the order is: make D1's change, run `idle_footprint.rs` the way this document's measurement did,
and read the number. If the 3.5 MB is mostly D1's — three root stores down to one — the reading says
so and this task is done. If most of it is still there, that is this task's evidence that the pool
lifetime is worth a second, narrower change, made against a number rather than in place of one.

### D3 — `DAEMON_BUDGET` moves once, from what D1 and D2 leave measured

Whatever the daemon measures after this task's change — release, this machine, the same methodology —
replaces both the 42 MB constant and its comment in
[idle_footprint.rs](../../../crates/mixengine-cli/tests/idle_footprint.rs:84). The comment names this
task and the number it found, the same way the 42 MB one names T72b. What it must not do is repeat the
36→42 MB move's own mistake of a margin applied without a reading behind it: the new constant is the
worst of what this task's own re-measurement shows, plus the fifth-above-worst rule already in force,
and nothing more generous than that.

## What this does not do

Does not touch `mix self-update`'s behaviour, the feed's schema, the daily check's interval, or
anything in [updates.md](../../../.claude/features/updates.md). A person running `mix self-update`
sees nothing different. Does not chase the ~1.3 MB the measurement above already assigned to eight
other tasks' ordinary growth — reopening that would be measuring noise this task's own numbers show is
smaller than the spread between consecutive runs.

## Testing

| What | Where | How |
| --- | --- | --- |
| a `Client<D>` built from a shared transport reads the same document a dedicated one would | `core` unit | two clients, one `reqwest::Client`, against `MockRegistry` |
| `with` (no shared transport) still builds and behaves as before | `core` unit | existing tests, unchanged |
| the daemon starts with one `reqwest::Client` shared three ways | `cli` integration | `declared()`'s existing daemon start; nothing here needs a new fixture |
| the idle daemon's RSS, before and after | `cli` bench, `idle_footprint.rs` | this document's own methodology: three paired release runs, median of five readings each, on the same machine |

The last row is the one this task is answerable to: it is what decides D2 and what D3's new constant
comes from, and it is not satisfied by the other three passing.

## Documentation changed

- `crates/mixengine-cli/tests/idle_footprint.rs` — `DAEMON_BUDGET` and its comment (D3).
- `.claude/roadmap/phase-7-efficiency.md` — T72b ticked, with the reading this document found.
