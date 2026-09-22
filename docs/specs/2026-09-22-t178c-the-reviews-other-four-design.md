---
status: approved
date: 2026-09-22
task: T178c
---

# T178c — The review's other four

Follow-up to [T178a–b](2026-09-22-t178-a-pull-that-keeps-what-it-has-not-agreed-design.md) and to
[T177](2026-09-20-t177-a-copy-only-you-can-read-design.md), phase 30. 2026-09-22.

## Where this comes from

The review of T177's sync found nine faults. T178a–b fixed the five that lose data in ordinary use
or never finish, plus one the tests found. This spec covers the remaining four. Each was confirmed
by reading the code at `db693fe7`:

| # | Fault | Where |
| --- | --- | --- |
| C1 | **A tombstone keeps the `updatedAt` of the version it replaced**, because `DELETE` carries none. A delete-versus-edit conflict is then decided by which one reaches the server first, not by D4 | `apply_delete` in `server/native/src/records.rs`, `applyDelete` in `server/worker/src/records.ts`, `operation_for` in `engine.rs` |
| C2 | **`push` stops at the first failed batch entry.** The entries after it, which the server did write, are never remembered, and the successful writes before it are never agreed. The next push then reports this machine's own edits as "replaced by a newer one", and writes the rest again under a new version that every other machine pulls | `engine::push`, the `_ => return Err` arm |
| C3 | **Moving an account never checks the password it registers with.** A typo becomes the new server's password. Nothing fails until `move_finish` tries to delete the old account with the wrong `A`, after the copy is done | `session.rs` `move_begin` |
| C4 | **The client's store is keyed by server URL alone.** An account deleted and registered again on that server under the same `MK` (a move A → B → A) starts again at `seq` 1. This machine then keeps its old cursor and versions: it pulls nothing, and pushes with an `If-Match` the new account has never issued | `store.rs`, `Store::open(path, &saved.server)` |

None of the four loses data the way T178a–b's faults did. C1 can bring back a record that was
deleted after a later edit. C2 misreports and writes needlessly. C3 and C4 leave an account unusable
until a person repairs it. All four ship with sync's first release unless fixed now. That release
has not happened yet, so `/v1` can still change in place (settled in T178a–b).

## Principle

**The protocol says what D4 needs, and the client acts on everything the server answered.** A
deletion is an edit with a time. A batch's result is read to its last entry. A password is checked
before anything is built on it. And an account is told apart by something that dies with it, not
by its address.

## C1. A deletion carries the time it was made

`DELETE /v1/records/{c}/{id}` takes the body `{updatedAt}`, and the batch's delete entry takes
`updatedAt` beside `ifMatch`. The tombstone stores the value it was given, validated the same way
a `PUT`'s `updatedAt` is. **It is required**, and a delete without it is `400 invalid-request`. No
released client sends the old shape, and an optional field would keep the fault alive for any
client that forgets it.

The client already stamps a deletion (`Outgoing.updated_at` on `Change::Delete`). Only
`operation_for` drops that stamp, and after this change it sends it.

With the time on the wire, D4 decides a delete-versus-edit conflict in either order, and so does
the L2 row of T178a that weighs a local edit against a pulled tombstone.

Proven by:
- a two-machine scenario that plays both arrival orders and expects the same survivor;
- conformance tests: a tombstone reports the `updatedAt` it was sent, from both the single route
  and the batch; and a delete without `updatedAt` is `400`.

## C2. A batch is read to its last entry

`engine::push` handles every result a batch returned, whatever came before it:
- a success is remembered;
- a conflict is resolved;
- a refusal (`413 record-too-large`, `404 unknown-record` on a write, `507` on one entry) is kept
  as that change's failure and does not stop the loop.

Later batches are still sent, since one oversized record says nothing about the others. **Only a
failure of the request itself stops the push**: the transport, `401`, or `507` for the whole
envelope. The changes not yet sent then count as failed too.

`Pushed` gains two fields:
- `landed`: the opaque ids that were written.
- `error`: the first failure, if any.

`settle_pushed` then agrees **only on what landed**, instead of on everything except what was
superseded. A failed change keeps its stamp and is tried again at the next push, with its first
time (D4's first rule).

`session::push` returns `PushedChanges { …, error }` instead of an `Err`, so the lost conflicts the
same push resolved are still handed to the module. `pushCollection` writes and commits them, and
**then** throws the error, so the account screen reports the failure exactly as it does today.

Proven by:
- an engine test where entry three of five is refused: entries four and five are remembered,
  entries one, two, four and five are agreed, and the error comes back;
- a loop test showing that `pushCollection` commits the replaced records before it throws.

## C3. A move checks the password first

`POST /v1/account/check` takes `{a}` under an access token and answers `204`, or
`401 invalid-credentials`. It counts attempts against the **same per-account limit** as login and
`/v1/account/delete` (`429 too-many-attempts`), so it offers no cheaper way to guess.
`move_begin` calls it on the old server with the `A` just derived, before it registers anything on
the new server. A wrong password now fails at the first step, where the person is still typing,
and the new server never learns it.

Two alternatives were weighed and rejected:
- **Checking locally, by unwrapping a stored `wrapped_mk_password`.** That needs no request, but
  the stored copy goes stale the moment the password is changed on another machine, and the
  correct new password would then read as wrong.
- **Signing in to the old server and revoking the device at once.** That needs no new route, but it
  leaves a sign-in and a revocation in the person's device list for every move.

Proven by conformance tests: the right `A` answers `204`, a wrong one `401`, and the attempt limit
applies. Also by `sync_live.rs`: a move begun with a wrong password is refused and registers nothing
on the second server.

## C4. An account is told apart by an id that dies with it

Registration gives every account a random `accountId`, and `/v1/auth/login` returns it. It never
changes while the account lives, a reset included, and it is **never reused**: deleting the account
and registering the same address again produces a new one. Neither server has an existing value
that fits:
- native's `account.id` is an `INTEGER PRIMARY KEY`, which SQLite may reuse after the last row is
  deleted;
- `account_key` is derived from the address;
- the Worker's object is found by the address, and its row is always `1`.

So both servers store a new column. Native adds it to a database that already exists, and fills it
for the rows already there, because the image published from `master` may already be running
somewhere.

`Saved` keeps `account_id` (`#[serde(default)]`, `None` for an entry kept before it existed), and
the store's scope becomes `server` plus `accountId` instead of `server` alone. A new account on the
same server therefore starts with an empty store. A second account signed in on the same machine
keeps its own store, as it did before. An entry without an id keeps the old scope until the next
sign-in. Rows left under an old scope are not cleaned up: they are opaque, small, and harmless.

Proven by:
- conformance: login returns an `accountId`, and a delete followed by registering again returns a
  different one;
- a unit test showing that two scopes on one server share nothing;
- `sync_live.rs`: a move A → B → A pulls everything again on its return.

## What this does not do

- It does not deliver a record that L4 skipped once the app can read it. That remains the
  follow-up T178a named.
- It does not add a retry for C2's per-entry failures beyond what the next push already does.
- It does not clean up store rows left by C4's old scopes.
