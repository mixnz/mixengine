---
status: implemented
date: 2026-09-22
task:
  - T178a
  - T178b
---

# T178a–b — A pull that keeps what it has not agreed, and a resync that ends

Follow-up to [T177](2026-09-20-t177-a-copy-only-you-can-read-design.md), phase 30. 2026-09-22.

## Where this comes from

A review of T177's sync found nine faults. Reading the code confirmed all nine. Writing tests to
reproduce them found a tenth, which is more likely to happen than any of the nine. This spec covers
the six that lose data or never finish. `apps/desktop/src-tauri/tests/sync_scenarios.rs` runs two
machines against a server that answers the way both servers do, and `server/conformance` holds one
more test. All of them are red at `e89fc20d`:

| Test | Fault |
| --- | --- |
| `an_edit_is_not_overwritten_by_this_machines_own_earlier_push` | **new** — a pull hands a machine back its own push and the module writes it over a later edit |
| `a_deletion_is_not_undone_by_this_machines_own_earlier_push` | **new** — the same, for a deletion |
| `a_newer_edit_made_offline_survives_a_pull_of_an_older_one` | review 1 — a pull replaces an unpushed edit without weighing it (D4) |
| `a_deletion_is_not_undone_by_a_resync_after_the_cursor_expired` | review 2 — `410` wipes the agreements, and a surviving tombstone is written over |
| `a_deletion_whose_tombstone_was_reaped_is_not_undone_by_a_resync` | review 2 — an item whose tombstone was reaped is created again |
| `a_quiet_collection_resyncs_once_and_not_on_every_pull` | review 3 — a collection's cursor stops at its own last row, below an account-wide reap mark |
| `a_resync_longer_than_a_page_reaches_the_end` | review 3 — past one page, a resync is expired again and starts over, for ever |
| `a_record_the_module_cannot_read_is_not_deleted_by_the_machine_that_skipped_it` | review 5 — a skipped record is agreed anyway, then deleted as missing |
| conformance: *do not expire the cursor a resync of one collection has just handed out* | review 3, on the real native server |

"Review N" is the review's own numbering, kept only as a label; each fault is described where it
is named, and the review itself is not kept. Review 6 (the REST module reports a write before it
reaches the disk) has no test yet.
It is part of this spec because its fix is the same contract as review 5's. Reviews 4, 7, 8 and 9 are left out
(see [What this does not do](#what-this-does-not-do)).

**The new fault needs no second machine and no failure.** A push does not move the cursor, so the
next pull returns every record this machine pushed since its last pull. `lend::incoming` hands each
of them to the module as news, and the module writes it over whatever changed in between. That
happens whenever a full run (focus after a minute, *Sync now*, the fifteen-minute idle pull) comes
before the thirty-second local check. It has the same root as review 1: **a pull never looks at
what this machine has not pushed yet.**

**Why now.** Sync is under `## [Unreleased]` in `CHANGELOG.md`, and no released MixLab speaks
`/v1`. Every wire change below is additive (see question 1), but changing things now costs nothing,
and after the first release it does.

## Principle

**A pull is news, and news is weighed like any other write.** Only a version that D4's rule says
wins may replace what a module holds. An agreement records only what the module actually wrote, and
a resync ends having told this machine everything a resync can tell it.

## T178a — what a pull may overwrite (client only)

### L1. Notice before pulling

`syncCollection` reads the collection once, before the first page, and hands the items to a new
command, `sync_notice`. That command stamps every local change the way `lend::outgoing` does today:
edits and creations under their hash, a missing agreed item as `deleted`. A retry keeps its first
time (D4's first rule). `outgoing` is then `notice` plus sealing.

**The stamp table becomes "what this machine has not landed yet", and a pull can read it.** Today a
change is stamped only when a push is built, so the edit made just before a full run has no stamp
when the pull arrives.

An edit made after `notice` and before a page is written is still overwritten. That window is one
request long rather than thirty seconds, and closing it would require the module to write
conditionally. This spec accepts the smaller window and does not close it.

### L2. `incoming` weighs each record

`incoming` takes this machine's device id and decides, record by record:

| Pulled | Here | Outcome |
| --- | --- | --- |
| live, hash equals the agreed hash | anything | **not news**: no upsert; the version is remembered on landing (L3) |
| live | a stamp | `resolve(stamp.at, device, record.updated_at, record.device)`: **Local** → no upsert, no agreement, version remembered, so the next push says `If-Match` with it and wins without a `409`; **Remote** → upsert and agreement, which clears the stamp |
| live | no stamp | upsert and agreement (as today) |
| tombstone | agreed and stamped | the same `resolve` against the tombstone: **Local** → nothing removed, version remembered; **Remote** → removal |
| tombstone | agreed, not stamped | removal (as today) |
| tombstone | not agreed | nothing, version remembered (as today) |

A tombstone's `updatedAt` is still the time of the version it replaced (review 4). This table uses
it as it is, and fixing it belongs to review 4's spec.

### L3. Identical content is not news

**A pulled record whose plaintext hashes to what is already agreed is never handed to the module.**
That is the echo of this machine's own push, and it holds even in the one case L2 alone gets wrong:
an edit noticed in the same second as its own earlier push, where D4's exact-tie rule would keep
the remote copy. It also means a resync (M1) rewrites nothing that did not change.

### L4. The module says what it wrote

`SyncableCollection.write` resolves to the ids it **did not** apply: `Promise<string[]>`, empty when
it applied everything. `applySyncChanges` returns `{ items, skipped }`. `commitPull` and
`commitPush` carry `skipped`, and `lend::land` still remembers those records' versions but drops
their agreements.

- A skipped new item then has no agreement, so `agreed_live` never lists it and nothing deletes it.
- A skipped existing item keeps its old agreement. Its unchanged local copy hashes equal and is not
  pushed.

`shell/preferencesSync.ts` and the terminal `settings` collection skip unknown keys today, so they
have the same fault and change the same way. **Delivering a skipped record once an upgraded app can
read it is not in this spec.** Remembering its version does not block that later: L3 compares
content, not versions.

### L5. A write resolves after the disk, and fails when the disk does

Every `write` awaits its durable save, and rejects when the save fails. Two writers are known to
break this today:

- `rest-requests`: `persistRequests` is fire-and-forget.
- `rest-environments`: `flushEnvironments` swallows every error.

The environments dialog's own flush keeps swallowing errors, and sync gets a variant that rejects.
The plan checks the other eight writers against the same rule: `connections`, the two secret
collections, `terminal-hosts`, terminal `settings`, `query-snippets`, cheatsheet snippets and
preferences.

## T178b — a resync that ends (client, both servers, conformance)

### M1. A `410` forgets the cursor, not the agreements

`store.forget` deletes the cursor row only. What was agreed stays agreed, so a surviving tombstone
removes what it names (L2), and L3 keeps the resync from rewriting the collection. A new table,
`resync (server, collection)`, records that a resync is under way. **It outlives the process**: a
resync interrupted by quitting resumes as a resync, rather than as an ordinary pull that has
forgotten why it started.

### M2. A resync ends by removing what it did not meet

During a resync, every id a page carries is recorded in `resync_met (server, collection, id)`. The
page that ends the resync (`more: false`) also removes every item that is agreed, live, and was not
met. Its tombstone was reaped, so it was deleted at least `tombstoneRetentionDays` ago.

- **A stamped item among them wins by D4.** Its change is newer than a deletion that old, so it is
  kept, and its `seen` row is dropped so that the push re-creates it under `If-None-Match`.
- On commit, the removed items' `seen` rows go, and both resync tables are cleared for that
  collection.

`Fetched::restarted` is replaced by this persisted state.

### M3. The last page's `nextSince` is the account's latest `seq`

When `more` is `false`, `nextSince` is `max(last row's seq, the account's latest seq)`. The latest
seq is read in one snapshot with the rows: the Durable Object runs one request at a time on the
Worker, and native reads both inside one read transaction, because its pool of WAL connections lets
a writer commit between two statements. **Read after the rows and outside that snapshot, a write
could take a `seq` between the two reads and never be delivered.**

That value tells the truth: no record of this collection exists between the last row and the
account's latest seq. A collection nobody writes to then keeps a current cursor, and one reap
expires it at most once. Both servers change, `docs/features/sync-protocol.md` says what
`nextSince` means, and the conformance test above turns green.

### M4. A resync is not expired halfway

**M3 does not cover the second fault in review 3.** During a resync, the second page's cursor is
the first page's last `seq`. That can sit below `reaped_below_seq`, and the server cannot tell such
a cursor from a stale one. So `GET /v1/records` gains `resync=1`, meaning *this cursor was handed out
by a read that began at `0`*. The server skips the expiry check for it. The client sends it on every
page of a resync after the first.

**It is safe to trust.** A read from `0` meets every live record and every surviving tombstone, and
M2 accounts for the reaped ones. A client that sends `resync=1` falsely only misleads itself: every
record is the person's own, and the server protects nothing by refusing.

Two known gaps:
- A tombstone written *and* reaped while a resync is still running is missed. That takes the full
  retention period, and so only happens on a server with a retention of `0`, which is a test setup.
- A server without M4 ignores the parameter, so the loop remains there until it is updated.

A conformance test on the retention-0 instance checks that a paged read from `0` with `resync=1`
reaches `more: false`.

### Alternatives not taken

- **A reap mark per collection instead of M3.** It adds state to both servers, and still leaves the
  multi-page loop that M4 exists for.
- **Pulling the whole account instead of one collection.** Protocol D4a already allows it, and it
  would remove the quiet-collection problem. But it reshapes `session.rs` and `loop.ts`, turning one
  page per collection into one stream routed by collection. It still needs M4, and it is a larger
  change than one line on each server.
- **A client-only fix.** There is none. The server refuses the page, and nothing the client does
  gets it back.

## How it is proven

**Where each test lives.** A test of one file's rule stays in that file's `mod tests`: the L2
table's rows and L3 in `lend.rs`, M1's resync state in `store.rs`, M3 and M4's server halves in
`server/conformance`, since neither server has record tests of its own. The stories that need
two machines and the whole round trip cross `lend`, `engine` and `store` at once, so no module's
`mod tests` owns them: they live in `tests/sync_scenarios.rs`, beside `sync_live.rs`, through the
same public `sync` API. Server behaviour a second implementation must match goes in
`server/conformance`, never in one server's own tests alone.

- The eight tests in `sync_scenarios.rs` and the conformance test above turn green unchanged, except that
  `Machine::sync` gains `notice` and `skipped` so it follows `loop.ts` and `session.rs`.
- New scenarios:
  - a local edit stamped later than a pulled record wins (L2, the tombstone row included);
  - an edit noticed in the same second as its own push survives (L3);
  - a stamped item that a resync did not meet is re-created rather than removed (M2);
  - a resync interrupted after one page ends correctly after a restart (M1).
- The existing test `a_forgotten_cursor_starts_over_from_nothing` changes with M1.
  `an_edit_a_pull_replaced_is_forgotten` stays as it is: there, the remote copy is newer.
- A vitest test for each writer L5 changes, showing that `write` rejects when the save does.
- `server/conformance` is green against both servers on both instances.

## What this does not do

- **Review 4**: a tombstone keeps the replaced version's `updatedAt`, so a delete-versus-edit
  conflict depends on arrival order. The fix is `DELETE` carrying `updatedAt`: a wire change on both
  servers.
- **Review 7**: `push` stops at the first failed batch entry and loses the outcome of the ones after
  it.
- **Review 8**: moving an account does not check the password it re-registers with.
- **Review 9**: the store is keyed by server URL, which misleads a machine that moves A → B → A under
  the same key.

These four go into a separate task, T178c, with a spec of its own. None of them loses data in
ordinary use the way the six above do. Delivering a record skipped by L4 after an upgrade is a
follow-up as well.

## Settled before approval

1. **`/v1` is not frozen.** No MixLab has been released from this repository, so no installed client
   speaks it. M3 and M4 are written into `/v1` and `docs/features/sync-protocol.md` in place. They
   are additive anyway: an old client treats `nextSince` as opaque, and an old server ignores
   `resync`.
2. **The default Worker instance holds no real accounts.** Nothing orders the rollout; the servers
   and the client land together.
3. **The parameter is `resync=1`.** It names the one situation a client may send it in, so a reader
   of a request log knows why it is there. Any other value is `400 invalid-request`: a flag that
   silently turns off expiry should not also accept `resync=true`, `resync=0` or `resync=`.
