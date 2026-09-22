---
status: approved
date: 2026-09-22
task: T178d
---

# T178d — A skipped record is delivered again

Follow-up to [T178a–b](2026-09-22-t178-a-pull-that-keeps-what-it-has-not-agreed-design.md), phase 30.
2026-09-22.

## The case

Machine A runs a newer MixLab and saves an item in a shape machine B's older MixLab cannot read,
for example a REST request with a new kind of body. B pulls the record, its module skips it, and
since T178a (L4) sync does not agree on it. B therefore neither deletes the record as missing nor
pushes its own older copy over it. That part is done.

**What is left:** B's cursor has moved past the record. When B upgrades and its reader now
understands that shape, nothing delivers the record again. B only meets it if another machine edits
it, which gives it a new `seq`, or if B happens to resync. Nothing is lost, but B quietly lacks
items the account holds, and nobody is told.

Two kinds of record are skipped today, and this spec has to hold for both:
- **Unreadable data:** a module's `fromSync` answers `null`.
- **Credentials parked in the vault** for an item that has not arrived yet: `read` does not return
  them, so they count as skipped (T178a, L4).

## Principle

**A record this machine skipped is owed to it, and a new version of the app is the moment to ask
for it again.** A module's reader only learns a new shape by shipping a new release, so asking at
every launch would download a collection again and again for a machine that still cannot read what
it holds.

## D1. The store remembers what it owes

A new table:

```sql
CREATE TABLE IF NOT EXISTS owed (
  server     TEXT NOT NULL,   -- the store scope, as every table here
  collection TEXT NOT NULL,   -- opaque
  id         TEXT NOT NULL,   -- opaque
  version    TEXT NOT NULL,   -- the MixLab that skipped it
  PRIMARY KEY (server, collection, id)
)
```

- **Recording:** `lend::land`, when it drops the agreement of a record the module skipped, also
  records that record as owed under the running app's version (`env!("CARGO_PKG_VERSION")`). The
  skipped local ids map to opaque ids through the same agreements `land` already holds.
- **Clearing:** a row goes when the record stops being owed:
  - an agreement lands for it (`Store::agree`): the module wrote it, or the parked credential was
    pushed once its item arrived;
  - a tombstone for it is remembered (`Store::remember` of a deleted record);
  - a resync ends without meeting it (`Store::end_resync`): its tombstone was reaped. This is
    checked against `resync_met`, not against `unmet`. An owed record was never agreed, so `unmet`
    never names it.

## D2. A new version asks for it again

Before a collection's page is fetched (`engine::fetch`), the store is asked whether it holds owed
rows for that collection recorded by **another** version of the app. If it does:
1. The collection **starts a resync**, reusing `Store::begin_resync` from T178b (M1). The cursor
   goes back to `0`, and agreements stay.
2. Every owed row is **re-stamped with the running version**. If the new reader still cannot read
   a record, the next pull skips it again and it waits for the release after this one. It does not
   wait for the next launch.

The resync then does what T178b already made it do:
- An agreed record comes back with content already agreed, so it is not handed to the module
  (T178a, L3). **Only owed records reach the module**, plus anything genuinely new.
- `resync=1` keeps it from being expired halfway (T178b, M4). Its last page removes nothing that is
  owed, because owed records were never agreed, so `agreed_live` does not list them.

`engine::fetch` gains the app version as a parameter, which is all the engine needs to know about
it. `session.rs` passes `env!("CARGO_PKG_VERSION")`; the tests pass whatever they set.

## Cost

One download of a collection, once per release, and only for collections that hold an owed record.
A machine that has never met an unreadable record never pays it. A machine that keeps a parked
credential for an item that never arrives resyncs `connection-secrets` (or its terminal or REST
counterpart) once per release. That is acceptable and self-limiting: the row clears as soon as the
item arrives.

## Alternatives not taken

- **Ask again at every launch.** That needs no version, but a machine that still cannot read a
  record would download the whole collection on every start.
- **A server route to fetch one record by id** (`GET /v1/records/{c}/{id}`). It is more exact, but
  it is a `/v1` change on both servers and in the conformance suite, for a client-only concern that
  a resync already covers.
- **Keep the cursor from moving past a skipped record.** Every later page would then be read again
  until the app is upgraded, which is worse than one resync.

## How it is proven

- **`store.rs`:**
  - an owed row is written by `land` and cleared by `agree`, by a tombstone and by `end_resync`;
  - `owed_elsewhere(collection, version)` is true only for rows recorded under another version, and
    re-stamping makes it false.
- **`engine.rs`:** `fetch` with owed rows from another version starts a resync, and with the same
  version it does not.
- **`tests/sync_scenarios.rs`:** the story itself. Machine B skips a record, B's reader is
  "upgraded" (the helper takes the unreadable set away and bumps the version), and the next sync
  hands B the record. Two more cases:
  - the same sync without a version bump does not resync;
  - a reader still unable to read after the upgrade leaves the record owed, and a third version
    tries again.

## What this does not do

- It does not tell a person that some records could not be read. That may be worth a notice, but it
  is a decision about wording, not about delivery.
- It does not cover development builds between releases: they share a version number, so a reader
  changed without a version bump is not retried. A developer resyncs by signing out and back in.

## Settled before approval

1. **A release is the trigger.** A machine that still cannot read a record pays one download per
   release, not one per launch.
2. **An owed record is not shown.** Delivery comes first; whether a person should be told that
   some items came from a newer MixLab is left for a task of its own.
