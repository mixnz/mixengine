---
status: approved
date: 2026-09-20
task: T177
---

# T177 — A copy only you can read

Roadmap task [T177](../roadmap/phase-30-a-copy-only-you-can-read.md), phase 30. 2026-09-20.
Decisions: [ADR 0045](../decisions/0045-mixlab-has-an-account-and-mixengine-does-not.md) and
[ADR 0046](../decisions/0046-the-sync-server-lives-beside-the-client-it-serves.md).

**The case this comes from.** A person who uses MixLab on a machine at work and a machine at home
keeps two of everything by hand: the same saved connections typed twice, a REST collection that
only exists on one of them, a cheatsheet snippet written on the laptop and unavailable on the
desktop. Every one of those lives in a file this application already writes — `connections.json`,
`rest-requests.json`, `query-snippets.json`, `terminal-hosts.json` — and in the OS credential store
beside it. Nothing carries them across.

What makes this hard is not the carrying. It is that the same files hold a list of somebody's
internal hosts and the passwords to reach them, and a server that could read either is a better
target than anything this project has built so far.

## Principle

**The server holds the bytes and cannot read them, and the division of labour is what makes that
checkable rather than promised.** Everything is encrypted on the machine that wrote it, under a key
the server never receives in any usable form. The server therefore cannot merge, cannot search,
cannot show a person their own data on a web page, and cannot help anybody who has lost both their
password and their recovery key. Each of those is a capability given up on purpose: a server that
could do any of them is a server that could read.

The second half is that **a person chooses what leaves the machine, one kind of thing at a time**,
and the answer starts at *nothing*. There is no "turn on sync" switch. There is a list, every row
off, and the rows that carry passwords are their own rows.

## What is already true

- **The split between plaintext and secret exists and is enforced.**
  `apps/desktop/src/modules/db/savedConnections.ts` takes every credential out of a saved
  connection before it is written and puts it back on read; the credential half goes to the OS
  store through `secrets_save` / `secrets_load` (`apps/desktop/src-tauri/src/secrets.rs`, service
  `MixLab`). The same pair already serves the database module, REST environments and terminal
  hosts, because all three take their ids from one uuid generator.
- **Every syncable thing already has a stable id.** Saved connections, REST requests, REST
  environments, query snippets and terminal hosts are each a list of records with a uuid. Nothing
  here has to invent identity.
- **The shell already knows how to stay ignorant of a module.** `src/shell/registry.ts` and
  `src/i18n/dicts.ts` are the only two files outside `src/modules/` allowed to name one, and
  `npm run lint` fails on a third. Sync has to join a module to the app the same way, or it becomes
  that third exception.
- **A single keychain service is a deliberate constraint.** macOS asks once per *item* for an
  application it cannot recognise by signature, which is why every saved connection's secrets share
  one vault entry. A second service name would buy a second dialog for nothing.
- **Missing today:** there is no account anywhere in this product, nothing in MixLab talks HTTP to
  anything but a server the user named, and nothing in `crates/` or `apps/desktop/` performs
  authenticated encryption.

## D1. What the server is allowed to learn

The server is a dumb, authenticated, versioned blob store. What it necessarily sees is listed here
in full, because a list that is not written down grows.

| It sees | Why it must |
| --- | --- |
| An email address | It is the login, and the only channel for verification and for a reset |
| `account_key`, a stable hash of that address | It is the account's only name, and it means the same thing on any server (D4a) |
| A password *verifier* (D2), never the password | To answer "is this the account holder" |
| An opaque collection id and an opaque record id, 32 bytes each | To address a record without being told what kind of thing it is (D3) |
| A version number and a per-account sequence number | To refuse a lost update, and to answer "what changed since" |
| `updatedAt`, a client clock reading | So the *client* can resolve a conflict; the server never compares them |
| A deletion flag, and when the row arrived | To reap a tombstone after 90 days |
| Ciphertext, and its length | It is the payload |
| A device list: id, a name the person typed, first and last seen | So a lost laptop can be cut off |

**What it never sees:** a plaintext value of any kind, the name of any collection, the name or host
of any connection, a URL, a file name, how many of each kind of thing there are, or anything
derived from the master key other than ciphertext.

**The address is kept, and that was decided rather than assumed.** A draft of this design dropped
it — every route that needs one is handed it in the same request, so nothing here has to remember
one — and a database would then have held hashes of addresses and no addresses. What that costs is
the row of D8's table where somebody runs this for their own team: **an operator who cannot see who
has an account cannot administer one**, and that is a real need rather than a convenience. The same
binary serves both rows, so the choice is made once, for everybody, in favour of the deployment
that has an operator. What is given up is that a stolen database holds a list of addresses, which
the rest of this design does not make any worse and does not pretend to fix.

Record sizes and counts leak a shape, and that is accepted rather than concealed: padding every
record to a fixed size costs bandwidth on every sync to defeat an observer who has already taken
the database.

## D2. The key hierarchy

Five values, four of them derived. `MK` is generated once, on the first machine, from the OS random
source.

```
K_pw   = Argon2id(password, salt_account, m = 64 MiB, t = 3, p = 4)   -> 32 bytes
K_wrap = HKDF-SHA256(K_pw, info = "mixlab-sync/wrap/v1")           -> 32 bytes
A      = HKDF-SHA256(K_pw, info = "mixlab-sync/auth/v1")           -> 32 bytes  (sent to the server)
MK     = random                                                        -> 32 bytes  (never sent in any form)
K_data = HKDF-SHA256(MK, info = "mixlab-sync/data/v1")             -> 32 bytes
K_id   = HKDF-SHA256(MK, info = "mixlab-sync/id/v1")               -> 32 bytes
```

**The five labels contain `mixlab-sync`, and that is not a repository name to be tidied up.** They
are domain-separation strings: once any record exists under them, a change to one makes every
record written under it undecryptable. The server has since moved to `server/` in this repository
([ADR 0046](../decisions/0046-the-sync-server-lives-beside-the-client-it-serves.md)) and the
repository that name once referred to no longer exists, but the strings stay exactly as they are.
`sync/crypto.rs` has a test that fails if anybody edits one.

`A` arriving at the server does not put `K_wrap` within reach: they are two HKDF expansions of one
secret, and neither yields the other.

**The server stores `HMAC-SHA256(pepper, A)`, and deliberately not another Argon2id.** Memory-hard
hashing exists to make a wordlist expensive against a secret a person chose. `A` is not that — it is
256 bits of HKDF output, uniform, with nothing to guess. A single keyed hash is preimage-resistant
at that size, and the pepper means a stolen database is not a list of login tokens. The expensive
work stays where the low-entropy secret is, which is the client. This also keeps the check inside
what a serverless runtime will do per request (D8).

It also stores two wrapped copies of `MK`, and can open neither:

```
wrapped_mk          = XChaCha20-Poly1305(K_wrap, MK)
wrapped_mk_recovery = XChaCha20-Poly1305(HKDF-SHA256(RK, info = "mixlab-sync/recovery/v1"), MK)
```

`RK` is 32 random bytes shown to the person **once**, at registration, as **thirteen groups of four
Crockford base32 characters** — the alphabet without `I`, `L`, `O` and `U`, so nothing written by
hand is ambiguous. Fifty-two characters carry the whole 256 bits; an earlier draft said ten groups
of five, which is 250 bits and cannot hold a 32-byte key. Registration does not finish until the
person types two of the thirteen groups back.

**Changing the password re-wraps `MK` and re-encrypts nothing.** One request, carrying a new
`salt_account`, a new `A` and a new `wrapped_mk`. That is the whole reason `MK` is a random value
rather than the password stretched directly.

**On this machine `MK` lives in the OS credential store**, service `MixLab`, account
`sync-master-key` — beside the vault, never in a service of its own, for the reason `secrets.rs`
already gives. It is unwrapped at sign-in and written nowhere else. **The session's refresh token and
a closed server's access token share that entry**: on macOS every item is one more question, and
all three are asked for at the same moment.

## D3. A record on the wire

```json
{
  "collection": "<32 bytes hex: HMAC-SHA256(K_id, collection_name)>",
  "id":         "<32 bytes hex: HMAC-SHA256(K_id, local_uuid)>",
  "version":    42,
  "seq":        901,
  "updatedAt":  1758300000,
  "deleted":    false,
  "device":     "<the id of the device whose session wrote it>",
  "nonce":      "<24 bytes base64>",
  "ciphertext": "<base64>"
}
```

- The plaintext inside is the item as this application already holds it, **including its real uuid
  and its real collection name**. A machine signing in for the first time has no index, so it
  learns the mapping back from opaque id to real id by decrypting, and by nothing else.
- **The AAD is `collection || id || deleted`.** Without it a server could move a blob into another
  record's slot, or unset a deletion, and the client would decrypt it happily. With it, either edit
  fails authentication.
- `version` is that record's optimistic-concurrency token; `seq` is a per-account monotonic counter
  the server assigns, and is what `since` reads.
- **`device` is stamped by the server** from the session that wrote the record, and a value a
  client sends is ignored. It is what D4's tie-break reads, and it costs nothing: every write is
  authenticated with one device's token, so the server knew which device wrote it already.
- A tombstone carries `deleted: true` and no ciphertext. It is kept 90 days, after which a machine
  that has been offline longer is told to resync from empty rather than told incomplete news
  quietly.

## D4. The protocol

**`/v1` is not frozen**, and whether it is frozen is a decision rather than something to infer from
this document: ask before treating any shape here as fixed. What freezing buys is the reason to
decide it carefully — **a server somebody else is running does not update when this document
does** (D9, R4), so once `/v1` is frozen a shape that moves costs them a coordinated release, and a
change is a new path rather than an edit.

| Method | Path | Does |
| --- | --- | --- |
| `GET` | `/v1/capabilities` | **No authentication.** Protocol versions this server speaks, the largest record and batch it accepts, the per-account quota, and the optional features it has |
| `GET` | `/v1/auth/params` | **No authentication.** The salt and Argon2 parameters a client needs before it can compute `A` at all |
| `POST` | `/v1/auth/register` | email, `A`, `salt_account`, the Argon2 parameters, both wrapped copies of `MK` |
| `POST` | `/v1/auth/verify` | completes with the emailed code; **no record may be written before this** |
| `POST` | `/v1/auth/login` | email, `A`, a device name → a short access token and a per-device refresh token |
| `POST` | `/v1/auth/password` | current `A`, new `A`, new `salt_account`, new `wrapped_mk` |
| `POST` | `/v1/auth/reset` | emailed proof; restores the login, and keeps the data only for somebody holding the recovery key (D6) |
| `GET` `DELETE` | `/v1/devices` · `/v1/devices/{id}` | list, and cut off a lost machine by killing its refresh token |
| `GET` | `/v1/records?collection={c}&since={seq}` | what changed, oldest first, with the next cursor |
| `PUT` | `/v1/records/{c}/{id}` | `If-Match: {version}`, or `If-None-Match: *` to create |
| `DELETE` | `/v1/records/{c}/{id}` | writes a tombstone; `If-Match` applies |
| `POST` | `/v1/records/batch` | many of the above in one round trip, each with its own outcome |
| `GET` `POST` | `/v1/account/freeze` | read, and set, whether this account is holding still for a copy (D4b) |
| `POST` | `/v1/account/delete` | current `A`; removes the account and every record with it (D4b) |

**`/v1/capabilities` is what stops a limit from becoming a release.** A client that assumes the
largest record or the size of a batch has to be updated in step with every server that disagrees,
and a server that wants to raise a number has to ship an endpoint to say so. Reported rather than
assumed, those become configuration on one side and a read on the other — which is the whole of what
D9 asks for, bought for one handler.

**A conflict is the client's to resolve and the server's to refuse.** A `PUT` whose `If-Match` is
stale gets `409` and the current record. The client compares `updatedAt`, keeps the later one,
breaks a tie on the lexicographically greater `device`, and retries. The server compares nothing.

**The loser writes the winner down, and nobody is asked.** Every machine applies the same rule to
the same two versions, so every machine reaches the same survivor; the one whose edit lost stores
the winning version locally, as if it had pulled it, and has nothing left to push. That is what
ends a conflict. A prompt would end it differently on each machine, and two machines resolving one
conflict two ways push at each other forever — so the account screen *reports* that an edit here
was replaced by a newer one, and asks nothing.

**Both fields the rule reads are the server's to set**, and that is deliberate rather than an
oversight: `updatedAt` is outside the AAD of D3 and `device` is stamped from the session, so a
hostile server could tilt a conflict between two versions of a record. Both versions are the
person's own, and the server can already refuse either write outright, so sealing these would
protect nothing it could not take another way.

**A client's `updatedAt` is the sync layer's, not a module's.** No module stores when an item
changed. The record store keeps a hash of each record's canonical plaintext as last synced: a
reader returning something different is a local change, stamped with the time sync notices it,
and an id it no longer returns is a deletion. Sync runs on a local change and at launch (D8), so
noticing is close to editing — and the hash is taken of what the reader returns, so a field it
leaves out, such as a sidebar's width, changes nothing.

Two rules keep that stamp honest, and each closes a way for an older edit to beat a newer one:

- **A change is stamped once.** The time it was first noticed is kept until it lands, and every
  retry sends that time. Stamped afresh on each attempt, an edit made offline yesterday would win
  over one made elsewhere this morning simply by being retried last.
- **A lost conflict teaches this machine nothing until the winner is written down.** The version
  it reveals is recorded together with the winner, never before: recorded first, a failed write
  would leave the next push carrying that version, meeting no `409`, and replacing the newer edit
  without a conflict ever being seen. Unrecorded, the next push meets the same conflict, loses it
  the same way, and tries the write again.

`/v1/records/batch` exists because a machine signing in for the first time pushes its whole local
set, and two hundred round trips to do it is the difference between a pause and a wait. It is a
batch of independent compare-and-swaps, not a transaction: each entry succeeds or conflicts on its
own.

## D4a. The wire

D4 is a table of intentions; the bytes are decided in
**[the protocol reference](../features/sync-protocol.md)** — encoding, the account key, the one
shape every failure takes, every route's body, the closed table of codes a client can meet, and the
four choices that could have gone the other way.

**It is a separate file because it outlives this one.** A spec stops being edited when its work is
implemented, and `/v1` does not stop growing. Nothing in it is a new decision: each line is
something D4 left open that two implementations would otherwise settle differently.

## D4b. Copying an account to another server, and deleting one

**Both are in `/v1` from the start rather than added later, and that is the only reason either can
ever be used.** Once `/v1` is frozen a server somebody else runs does not update when this document
does (D9, R4), so a client that meets an answer it does not understand stops syncing with a
strange error. A way to say *"hold still, I am copying"* added later would only work for clients
written after it — which is exactly the population that does not need it. Moving servers is
hypothetical; the place to say so is not.

**There is no *move* in this protocol.** There is a copy, which the client performs with the
ordinary read and write routes, and there is a deletion. A move is the two of them in order, and a
backup is the first one on its own. Neither operation knows about the other, and the server never
learns that a move is what it was taking part in.

**The client copies; the server is only asked to hold still.** Nothing here asks a server to export
anything, and nothing asks it to enumerate its accounts — which it cannot do, because addressing by
`account_key` is what this design has instead of an index (D8). The machine that already holds the
data is the one that carries it across.

**The data crosses unchanged.** The client keeps `MK`, so it registers on the new server with the
*same* `salt_account` and the same two wrapped copies, and `K_id` and `K_data` come out the same on
the other side: the opaque ids and the ciphertexts are identical bytes, and the recovery key still
opens the account. Nothing is re-encrypted, and the peppers of the two servers never have to match,
because each one keys its own verifier.

### Two states

`active`, and `frozen` — which reads and does not write. `GET`/`POST /v1/account/freeze` moves
between them and answers in both; the shapes are in
[the protocol reference](../features/sync-protocol.md).

**Thawing is a route, and the only way out.** Posting `active` is how a client ends a copy it has
finished and how it abandons one it has given up on. Nothing else ends a freeze, and the section
below is about why nothing else should.

Reads stay open while frozen because **the copy is a read**: the machine doing the work needs the
same route any machine uses, and a second machine that wants to take over needs it too.

### A freeze ends when a client ends it, and not before

**There is no timeout.** Posting `active` is reachable from every signed-in machine, and reading
and signing in both work while frozen, so a freeze nobody meant to leave behind is one request away
from over — nothing is stranded and no operator is needed.

An expiry would cost more than that buys. A copy that *succeeds* and is then not finished off would
let the old server quietly become writable again, and a machine nobody repointed would begin
writing into it: the silent divergence this section exists to prevent, arriving on a timer.
**Between a failure that asks a question and a recovery that answers one on its own, this takes the
question.**

`frozenAt` is when it started, so a client can say how long this has been true rather than only
that it is.

**Resuming needs no bookkeeping.** The client keeps `MK`, so the records it re-uploads are the same
opaque ids and the same bytes as the ones that already arrived: pushing the whole set again with
`If-None-Match: *` and treating `412 already-exists` as success is exactly the right behaviour, and
it is correct whether the previous attempt copied nothing, half, or everything. There is no
progress to record and nothing to reconcile.

**Any machine can take over, or give up, and that is the recovery path.** A second machine that
meets `423` reads `GET /v1/account/freeze`, sees `frozen`, and either continues the copy — it can
read everything from this server, which is still readable — or posts `active` and abandons it.
What it must not do is guess, and what it must not do is wait: nothing is coming to clear this
but a decision.

**Freeze first, then copy — not copy, then freeze.** With the other order there is a window between
the last record the client reads and the moment the account stops accepting writes, and anything a
*second* machine writes in that window is lost silently. Two machines writing to two servers cannot
be reconciled afterwards either, because their `seq` counters are independent. The cost of the
right order is a short read-only period, which a local-first application does not show anybody.

**While frozen, any mutation** — a record, a batch, a password change — answers **`423 Locked`**,
code `account-frozen`. Sessions are untouched.

### Where the copy goes is the client's business, and cannot be the server's

**The destination is a thing a person typed.** Somebody on the hosted instance who wants their own
box types its address into MixLab; somebody with two boxes of their own picks one. A hosted
instance serving many people cannot hold a setting naming each of their private machines, and if it
held one it would name the same destination for everybody.

**So nothing is forwarded, and each machine is pointed at the new server by the person, once**, the
same way the first one was (D8). A server that could send a client to an address of its choosing
would be a phishing primitive: the destination learns `A`, which is the login verifier and is the
same value on every server because it comes from the password. It could not read a record — it has
no `MK` — but it would not need to.

**What an old server does contribute is a date.** `closingOn` in `/v1/capabilities` is the whole of
it: an operator who intends to switch the server off says when, every client reads it before every
sync, and a person has warning enough to copy the account somewhere while the server is still there
to copy from. It says when, never where.

### Deleting an account

`POST /v1/account/delete`, carrying the current `A`.

**It re-proves the password, and the session is not enough.** A borrowed unlocked machine already
holds a valid access token; asking for `A` means the person deleting the account is the person who
knows the password, not whoever is sitting at the desk. It is the same check
`POST /v1/auth/password` makes, and a wrong `A` is counted against the same per-account window as a
login, so the route cannot become a password oracle.

**A confirmation letter would add nothing.** Anybody who can call this can already delete every
record one at a time through `/v1/records`; the account row is all that survives that, and it holds
nothing a person would miss. A round trip through email would slow down the one honest case and stop
nobody. Whether a person is asked *"are you sure"* is a question for the account screen (T177e2), not
for the wire.

**Nothing is kept.** Every record, every device, every refresh token, every access token, every
attempt counter, and the account row itself. The address is free to register again immediately, and
**the server is left exactly as it was before the account existed** — no tombstone, no row saying
this address was once here. Keeping one would be keeping the single fact D1 promises a server does
not accumulate.

On the Worker this is the Durable Object deleting all of its storage, after which the object has
nothing left and stops existing. Because it is addressed by `idFromName(account_key)`, registering
the same address again arrives at the same object, which is now empty — the name is genuinely free.

**Deleting a frozen account is allowed.** It is the person's data, and whatever a copy has already
carried across belongs to them too. Afterwards every token on every machine is gone, so the next
request from any of them answers `401 invalid-token`. There is no code meaning *this account was
deleted*: the account is not there, and a server that could tell the difference would be keeping the
row this route exists to remove.

### A move is a copy, and then a deletion

1. `POST /v1/account/freeze` with `frozen` on the old server.
2. `GET /v1/records?since=0`, paged to the end. **The ordinary read route.**
3. Register on the new server with the same `salt_account` and the same wrapped keys, and confirm
   the address there — the new server sends its own letter and will not take the old one's word.
4. `POST /v1/records/batch`, with `If-None-Match: *`. **The ordinary write route.**
5. Compare what the new server holds against what the old one still shows, then either
   `POST /v1/account/delete` on the old one, or post `active` to thaw it.

**There is no export route and no import route**, and steps 2 and 4 are why: a copy is the paged
read and the batch write a client already performs every day. The server never acquires a way to
hand out a whole account at once, which is the property D1 would otherwise have to qualify.

**Step 5 is the fork.** Delete, and it was a move. Thaw, and it was a backup, and two independent
accounts exist from that moment — the same address, the same password, two histories that cannot be
merged afterwards because `seq` is per-server.

**A copy is not byte-identical, and nothing pretends otherwise.** `version` and `seq` are assigned
by the server, so on the new one every record is at version 1 and the sequence starts again. A
machine repointed at the new server resyncs from cursor 0; if it sends an `If-Match` holding a
version from the old one it meets `409 version-conflict`, which is the correct answer to *your view
is stale* and costs a re-read rather than a record.

### What it does not solve

**A machine the person forgets to repoint.** It keeps talking to the old server. If the move ended
in a deletion, it is signed out at once and the person finds out the same day — which is the
argument for ending a move that way rather than by thawing. If it ended in a thaw, it goes on
working, writing into an account that is now a second account, and **nothing anywhere reports an
error**. That is the cost of two servers not knowing about each other, and it is accepted here
rather than solved.

**The client needs `A` to register on the far side**, which is derived from the password it does not
keep. **It asks for the password when it needs `A`, and says what it is for.** Holding `A` beside
`MK` would be defensible — anything that reaches one locally has already reached the other — but a
move and a deletion are rare, deliberate acts, and a password typed at that moment is also the
person confirming them.

**What is no longer a problem.** An earlier draft had the old server forward clients to the new one,
which meant it could never be switched off: for as long as one old client existed — including an old
installer somebody runs again — something had to be there to answer. With nothing forwarded, a
server that has been copied from and deleted from is finished, and the person who ran it can stop
it.

## D5. What syncs, and what never does — a client-side catalogue

**Nothing in this section is part of the protocol.** The server never sees a single name in the
table below: a collection reaches it as `HMAC(K_id, name)`, 32 bytes it cannot invert and cannot
enumerate. This list is a decision MixLab makes about its own files, and it grows whenever MixLab
grows — without a line changing under `server/`, which is the point D9 is built around.

Every row is **off** until a person turns it on. A secret row cannot be turned on until the row it
belongs to is.

| Collection | Source on disk | Carries |
| --- | --- | --- |
| `preferences` | `localStorage`: theme, accent, language, enabled modules | one record per key; lent by the shell, which owns them |
| `terminal-settings` | `terminal-settings.json` | font, cursor, scrollback |
| `connections` | `connections.json` | host, port, user, database, SSH configuration — **no credential** |
| `connection-secrets` | the `MixLab` vault | `password`, `uri`, `sshPassword`, `sshPassphrase` |
| `terminal-hosts` | `terminal-hosts.json` | saved SSH targets, no credential |
| `terminal-host-secrets` | the `MixLab` vault | those targets' SSH credentials |
| `rest-requests` | `rest-requests.json` | the collection: method, URL, headers, body |
| `rest-environments` | `rest-environments.json` | names, and the values **not** marked secret |
| `rest-env-secrets` | the `MixLab` vault | the values marked secret |
| `query-snippets` | `query-snippets.json` | saved SQL, identified by its name — a rename is a deletion and a new record |
| `tools-snippets` | `tools-snippets.json` | the cheatsheet |

**Nothing else is syncable, and that list is the promise rather than a default:**

- `rest-history.json` — it keeps up to 100 response bodies at 256 KB each. That is production data
  belonging to whoever runs the server that answered, and it is not this application's to move.
- `query-history.json`, `query-drafts.json` — the same argument, and a draft is one machine's
  unfinished thought.
- `*-workspace.json`, and every tab state — a layout is a property of a screen, not of a person.
- `tool-usage.json` — a usage count is telemetry the moment it leaves the machine.
- Any password reached through `keyringRef`. That credential belongs to MixEngine's own keyring
  ([ADR 0032](../decisions/0032-a-keyring-address-names-the-home-it-belongs-to.md)); MixLab holds a
  reference to it and never a copy, and a reference means nothing on another machine.

## D6. Losing the password

Three cases. **The recovery key decides what survives; the letter decides who you are.** Neither
does the other's job, which is what case 2 is about.

1. **Changed while signed in** — re-wrap `MK`, one request, nothing else moves.
2. **Forgotten, recovery key held** — `RK` unwraps `MK`, so the records survive. But a fresh
   install has to prove whose account this is first, and **only the emailed code can do that**:
   the server has never seen `RK` and cannot tell somebody holding one from somebody who is not.
   A route that took a new verifier on `RK` alone would be account takeover with extra steps.
3. **Both lost** — the letter restores the login and nothing restores the data: every record is
   under an `MK` no surviving key unwraps. The reset deletes them rather than leaving an account
   full of bytes that decrypt for nobody, and the dialog says so before it proceeds.

**Case 2 takes two requests and case 3 takes one**, because the client needs
`wrapped_mk_recovery` before it can compute anything and spending the code is what earns it. The
first request spends the code and answers with that key and a **single-use ticket, minutes long**;
the second carries the ticket and the new keys. D4a has both shapes.

Three things that follow, and none of them are the client's convenience:

- **The ticket is what separates keeping from deleting.** Without it the second request is the
  one-shot reset, so a stale ticket is refused rather than treated as either.
- **Records survive because the client said so by using that shape.** The server cannot check that
  the uploaded `wrapped_mk` wraps the same `MK` and does not try; a client that got it wrong
  leaves records nobody can read, which case 3 clears.
- **Reaching the mailbox buys nothing new.** That already destroys the account through case 3.
  Taking case 2 instead leaves the records in place and still unreadable: `MK` is in none of it.

**The recovery key is not enough on its own.** It preserves the data; it does not prove identity,
and the mailbox is still required. Wherever MixLab prints or explains the key it has to say so, or
a person will keep the key, lose the address, and find out the shape of this at the worst moment.

## D7. Where the code lives

- **`apps/desktop/src-tauri/src/sync/`** — the key hierarchy, the envelope, the transport, the
  record store. Rust, because `MK` should not pass through a JavaScript heap and the credential
  store is already there. `crypto.rs` is written to be read in one sitting and carries test
  vectors: the promise in D1 is a property of that file and of nothing on the server.
- **`apps/desktop/src/shell/`** — sign-in, the recovery-key ceremony, the per-collection list, the
  device list, the notice that an edit here was replaced by a newer one.
- **A module declares what it will lend, and the shell never learns what it is.**
  `ModuleDefinition` (`src/shell/module.ts`) gains an optional set of syncable collections, each an
  id, a label, a reader, a writer and a default of `false`. `registry.ts` wires them as it already
  wires tabs. `core/` and `shell/` see "records with an id" and never the word *connection*, so
  the lint boundary holds without a third exception. A module is not asked when an item changed;
  D4 says who knows.
- **The `mixengine` module and the daemon are untouched.** No new API method, no new binary in
  `crates/`, nothing in `mix`.

## D8. The server

**`server/` in this repository** holds **two implementations of one protocol**, and that is
deliberate rather than a duplication to be cleaned up later:

```
server/
  conformance/   the suite both implementations answer to
  worker/        Cloudflare Workers and Durable Objects — the default instance
  native/        Rust and a SQLite file, for a machine somebody runs themselves
```

It lives here rather than in a repository of its own so that **one CI run can prove the two halves
agree** — the Worker started, the suite pointed at it — which is
[ADR 0027](../decisions/0027-the-desktop-client-lives-in-this-repository.md)'s argument for bringing
the client home, applied to the server. [ADR 0046](../decisions/0046-the-sync-server-lives-beside-the-client-it-serves.md)
records the reversal and what would undo it; `server/native/` is excluded from the root Cargo
workspace the way `apps/desktop/src-tauri` is.

**That run is a workflow of its own**, `.github/workflows/server.yml`, fired only by `server/**`
and unasked on `master` because Workers Builds deploys from there on its own — a server that is red
and unrun is a server that is deployed red. Why it is separate from `ci.yml`, and why `master` is
the exception to *CI is asked for*, is in
[build-and-release](../operations/build-and-release.md).

**The default instance runs on Cloudflare Workers, with one Durable Object per account.** That
single primitive answers the three things this design actually needs from a server: execution is
serialized, so the per-record compare-and-swap and the per-account monotonic `seq` are correct
without a carefully written transaction; its storage backend is SQLite, so the table is the one
designed here, one file per account rather than one shared; and its alarms reap that account's
tombstones at ninety days without a cron sweeping everybody's rows. A shared database would make all
three harder for nothing gained — an account's records are small and never joined against another's.

**Everything about one account lives inside that account's object** — the email address, the stored
`HMAC(pepper, A)`, `salt_account`, both wrapped copies of `MK`, whether the address has been
verified, the device list, and the record table. There is no second store and no account table,
because **nothing in this design ever queries across accounts**: there is no administrative screen,
no statistic and no search, and every operation begins by naming one account.

The one lookup that looks like it needs an index — which account is this email — is answered by
addressing instead: a Durable Object derived from `SHA-256` of the lowercased address is the same
object every time, so there is nothing to keep in step. It settles the registration race for free,
too: two simultaneous attempts on one address arrive at one serialized object, and one of them
loses cleanly without a transaction being written. **The cost is that changing an email address
changes the address of the object, so v1 does not offer it.** Adding it later is an alias table and
a server-side addition, which `/v1` neither notices nor forbids (D9, R4).

**Rate limiting belongs inside the object** for the same reason the compare-and-swap does: it is
already the serialized place.

### Sending email

Two letters — a verification code and a reset code — and **which provider sends them is a
deployment decision rather than a protocol one**. They sit behind one function in each
implementation, which is the part that matters: every free tier in this market will be renegotiated
within a few years, and what protects a deployment is that changing provider is one file.

**A deployment must name one**, and there is no default: a key on its own does not say where to
send it, and guessing meant somebody pasting a SendGrid key had it posted to Resend — which fails,
correctly but confusingly, at the first letter rather than at the first start. A server missing any
of this refuses to serve and names what is missing.

`server/native/README.md` has the seven providers and what each one wants; `server/worker/README.md`
has the six that a Worker can reach, SMTP being the one it cannot.

### Two implementations, three things a person can run

| Shape | Runs on | Who holds the data |
| --- | --- | --- |
| The Worker | this project's Cloudflare account | us — this is the default instance |
| The same Worker | the person's own Cloudflare account | them, on Cloudflare |
| The native binary, or a container built from it | a machine of their choosing | them, entirely |

**A container is a packaging of `server/native/`, not a third implementation.** The middle row is
nearly free: the same source as the default instance, reached by forking this repository and
pointing Workers Builds at `server/worker/` as its root directory. The bottom row is the one that
costs real work, and it is the only one that answers somebody whose objection to a hosted service
*is* Cloudflare.

**No container runs anywhere in the top row.** The default instance is the Worker, and Cloudflare
builds it from this repository's `server/worker/` directory — nothing in the hosted path is built,
pulled or run as an image. The Dockerfile exists for one purpose: to produce an image, published to
this repository's own GitHub Packages, that somebody self-hosting can pull instead of compiling
Rust. It is a distribution format for the bottom row and appears nowhere else, which is also why
[ADR 0003](../decisions/0003-no-container-isolation.md) is untouched — that decision is about how
MixEngine runs a person's PHP, and this is an artifact somebody else's machine runs.

**The image follows `master`, and the server has no release of its own.** It is built from
`master` and tagged `latest` and `sha-<short>`, the same cadence the Worker already deploys on, so
a self-hoster and the default instance are never running different generations of `/v1`. Attaching
it to a `v*` tag would give the server the versioned-artifact lifecycle that
[ADR 0046](../decisions/0046-the-sync-server-lives-beside-the-client-it-serves.md) names as the one
thing that would justify splitting it back out — the image is deliberately not that. Somebody who
wants a fixed target pins the `sha-` tag.

**Forking a repository this size to deploy a directory is the price of
[ADR 0046](../decisions/0046-the-sync-server-lives-beside-the-client-it-serves.md)**, and it is a
worse sentence than *clone this small thing* for anyone who reads what they cloned. Nobody on this
path does: they fork and point a build at a directory, or they pull an image.

### What the free tier holds, and what that decides

Durable Objects with the SQLite backend are reachable on the free plan, and the figures that
say how far it goes are in `server/worker/README.md`, beside the limits they constrain —
a supplier's pricing will be wrong before this document is. Should the free tier ever stop
being true, the fallback is **D1**: still SQLite, still free, but the serialization that made
this design easy is gone — `seq` and the compare-and-swap would then need a written
transaction instead of a guarantee, and reaping a Cron Trigger over a shared table instead of
an alarm per account. The protocol would not change, and a client could not tell the
difference.

**What costs money is not how much data moves but how often a client wakes an object up.** An
object stays resident for a short while after its last request, so one sync that pulls and
pushes in a single burst holds one window open while the same calls scattered through the day
open a dozen. **Three of the four things that follow are rules about MixLab**, not about the
server, which is why they are in this design rather than in `server/`.

1. **Sync in bursts, never on a poll.** On launch, on a local change after a debounce, on window
   focus, and a long idle interval. A five-minute poll costs several times what this does and
   carries no more news.
2. **Batch.** `/v1/records/batch` is one request whatever it carries — D4 wrote it for the round
   trips, and this is its second reason.
3. **`/v1/capabilities` never touches an object.** It needs no account and barely changes: the
   Worker answers it from configuration and the edge caches it. Routed to a Durable Object it would
   spend a window every time a client said hello.
4. **An alarm is scheduled only when there is a tombstone to reap.** Alarm invocations are requests.
   A daily alarm per account bills for every account that has ever existed rather than for every
   account in use, and it does it quietly, forever.

**D5's refusal list is what makes any of this arithmetic work**, and here the ratio is the point
rather than the allowance. Syncing `rest-history.json` would put a hundred response bodies at up to
256 KB each into one account — twenty-five megabytes a person against half a megabyte, **fifty times
the storage for every user**, whatever the ceiling is. The reason that file is not in the catalogue
is that it holds somebody else's production data; the capacity is a second dividend from a decision
made for another reason entirely.

### Moving the default instance

**The two implementations do not share an account id, and it does not matter.** Neither is ever on
the wire; what is — the opaque `collection` and `id` of D3 — is derived on the client from `MK`, so
it is a property of the account's key and not of whichever server holds it.

**But the Worker cannot list its accounts, and that is deliberate.** There is no account table and
no index, because nothing here queries across accounts. The direct consequence is that **an
operator has no list of addresses to migrate and cannot perform a bulk server-side move.** That is
a cost of the privacy property rather than an oversight, and it is written here so nobody discovers
it on the day they want to move.

**It is also not needed, because a person moves their own account** — D4b, and it is lossless. The
one person that fails is somebody whose only copy *was* the server: one machine, lost, with sync as
the backup. So an operator who moves the default instance announces it with `closingOn`, and leaves
the old one answering until people have gone. **If a silent migration ever becomes necessary, the
thing that has to change first is the no-index decision**, in a new spec that argues for the index
and says what it costs, rather than in a hurry.

## D9. MixLab grows; the server does not

**Neither the hosted instance nor a self-hoster should have to deploy `server/` because MixLab
shipped a release.** The design mostly achieves this already — a collection reaches the server as an
opaque 32-byte address and a payload as ciphertext, so a new module, a new kind of record or a new
field inside one costs the server nothing. Four rules turn that from an accident into a property.

**R1. A MixLab feature expresses itself as records, never as an endpoint.** This is the rule the
other three serve. Wanting a new endpoint for a MixLab feature is simultaneously the sign that this
property has broken and the sign that the server is about to learn something — and a server that
knows what a row is for is a server on its way to being able to read it. One rule guards both, which
is why it is worth stating as a rule rather than as a habit.

**R2. A collection a client does not recognise is left alone, never reaped.** Two machines on one
account will not run the same release. The older one pulls records belonging to a collection it has
never heard of, and the obvious handling — treat it as rubbish, write a tombstone — deletes what the
newer one just made. Unknown collections are carried, counted against quota, and otherwise ignored.

**R3. Fields inside a payload that a client does not understand are preserved when it writes back.**
The same skew, one level down: a newer MixLab adds a field, an older one decrypts the record, the
person edits something else, and the write-back silently drops it. A client re-seals what it read
and did not understand, alongside what it changed. This is the failure that leaves no trace at all,
which is why it is a rule and not a code comment.

**R4. `/v1` grows by addition only, and MixLab speaks to the oldest of them forever.** A field may
be added; the meaning of one already there may never change, and both sides ignore what they do not
recognise. Limits are read from `/v1/capabilities` rather than assumed, so raising one is
configuration on the server and a read on the client. Where MixLab genuinely needs something a
server does not have, the feature is **switched off with a sentence naming what is missing** — never
an error, and never a demand that somebody upgrade.

**What will eventually force a `/v2`, said plainly:** anything shaped like authentication — a second
factor, a passkey — and sharing between people. None of those can be expressed as records, which is
the honest reason the last of them stays in the list below rather than in this design.

## What this deliberately does not do

- **No sharing between people.** One person, several machines. A shared collection needs key
  exchange, membership and revocation, and none of that is designed here.
- **No web interface.** There is nothing a browser could show without the key.
- **No object-store backend.** A protocol this small could one day sit on S3 or WebDAV and let
  somebody self-host with no server at all, at the cost of device revocation and server-side rate
  limiting. `/v1` does not block it; this task does not build it.
- **No licensing, entitlements or telemetry.** An account proves who may write to a row, and
  nothing else.
  [ADR 0022](../decisions/0022-a-crash-report-is-recorded-by-default-and-sent-by-nothing.md) stands:
  a crash report is still transmitted by nothing.
