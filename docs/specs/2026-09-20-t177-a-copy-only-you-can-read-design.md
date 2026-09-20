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
are domain-separation strings, frozen, in released ciphertext: a change to one makes every record
written under it undecryptable. The server has since moved to `server/` in this repository
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
already gives. It is unwrapped at sign-in and written nowhere else.

## D3. A record on the wire

```json
{
  "collection": "<32 bytes hex: HMAC-SHA256(K_id, collection_name)>",
  "id":         "<32 bytes hex: HMAC-SHA256(K_id, local_uuid)>",
  "version":    42,
  "seq":        901,
  "updatedAt":  1758300000,
  "deleted":    false,
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
- A tombstone carries `deleted: true` and no ciphertext. It is kept 90 days, after which a machine
  that has been offline longer is told to resync from empty rather than told incomplete news
  quietly.

## D4. The protocol

Frozen as `/v1` before the first line of client code. The original reason was that the two halves
lived in two repositories; [ADR 0046](../decisions/0046-the-sync-server-lives-beside-the-client-it-serves.md)
brought them into one, and the freeze outlived it — **a server somebody else is running does not
update when this document does** (D9, R4), so a shape that moves costs them a coordinated release
whatever this repository's layout is. A change to `/v1` is a new path, not an edit.

| Method | Path | Does |
| --- | --- | --- |
| `GET` | `/v1/capabilities` | **No authentication.** Protocol versions this server speaks, the largest record and batch it accepts, the per-account quota, and the optional features it has |
| `POST` | `/v1/auth/register` | email, `A`, `salt_account`, the Argon2 parameters, both wrapped copies of `MK` |
| `POST` | `/v1/auth/verify` | completes with the emailed code; **no record may be written before this** |
| `POST` | `/v1/auth/login` | email, `A`, a device name → a short access token and a per-device refresh token |
| `POST` | `/v1/auth/password` | current `A`, new `A`, new `salt_account`, new `wrapped_mk` |
| `POST` | `/v1/auth/reset` | emailed proof only; restores the login and **abandons the data** (D6) |
| `GET` `DELETE` | `/v1/devices` · `/v1/devices/{id}` | list, and cut off a lost machine by killing its refresh token |
| `GET` | `/v1/records?collection={c}&since={seq}` | what changed, oldest first, with the next cursor |
| `PUT` | `/v1/records/{c}/{id}` | `If-Match: {version}`, or `If-None-Match: *` to create |
| `DELETE` | `/v1/records/{c}/{id}` | writes a tombstone; `If-Match` applies |
| `POST` | `/v1/records/batch` | many of the above in one round trip, each with its own outcome |
| `GET` `POST` | `/v1/account/relocation` | read, and set, whether this account still lives here (D4b) |

**`/v1/capabilities` is what stops a limit from becoming a release.** A client that assumes the
largest record or the size of a batch has to be updated in step with every server that disagrees,
and a server that wants to raise a number has to ship an endpoint to say so. Reported rather than
assumed, those become configuration on one side and a read on the other — which is the whole of what
D9 asks for, bought for one handler.

**A conflict is the client's to resolve and the server's to refuse.** A `PUT` whose `If-Match` is
stale gets `409` and the current record. The client compares `updatedAt`, keeps the later one,
breaks a tie on the lexicographically greater device id, and retries. The server compares nothing.

`/v1/records/batch` exists because a machine signing in for the first time pushes its whole local
set, and two hundred round trips to do it is the difference between a pause and a wait. It is a
batch of independent compare-and-swaps, not a transaction: each entry succeeds or conflicts on its
own.

## D4a. The wire

D4 is a table of intentions. This appendix decides the bytes, because `server/conformance/` is
written against **this document** and against neither implementation — and a suite can only be
written first if the document decides first. Nothing below is a new decision; each line is
something D4 left open that two implementations would otherwise settle differently and discover in
the suite.

**The numbers here are configuration, not protocol.** Every limit is reported by
`/v1/capabilities`, and a server may report any value it likes. The suite asserts that a limit is
present and that the server honours the value it reported — never that it equals the default. The
defaults are what this project's instance ships with.

### Encoding, and what both sides ignore

- JSON, UTF-8, `Content-Type: application/json`. Field names are camelCase, as in D3.
- Opaque ids — `collection` and `id` — are lowercase hex, 64 characters. Everything else that is
  bytes (`nonce`, `ciphertext`, `a`, `saltAccount`, `wrappedMkPassword`, `wrappedMkRecovery`) is
  **standard base64 with padding**, not base64url. One spelling, written down here, because two
  implementations will otherwise each pick a reasonable one.
- **Both sides ignore members they do not recognise**, in requests and in responses. This is
  [ADR 0019](../decisions/0019-an-added-response-member-is-optional.md)'s rule applied to two
  parties that upgrade separately: a server somebody else is running is older than this document
  (D9, R4), and a client that refused an unknown member would break the moment a newer server
  added one.
- `Authorization: Bearer <access token>` on every route except `/v1/capabilities`.
- Times on the wire are **seconds** since the epoch. `updatedAt` is the client's clock and the
  server stores it without ever comparing it (D1).

### The account key

```
account_key = SHA-256("mixlab-sync/account/v1" || 0x00 || lowercase(trim(email)))   -> 32 bytes, hex
```

**Frozen, and deployment-independent on purpose.** It is the only name an account has. The Worker
uses it as the name of the Durable Object that holds the account; the native server uses it as the
unique key of the row. Both arrive at the same value for the same address, which is what makes a
row mean the same thing on either — see *Moving the default instance* in D8.

It carries no pepper, and that is the trade this makes: a peppered value could not be moved between
servers, which is the whole point of it. What is given up is that somebody holding a stolen
database and a list of candidate addresses can confirm which of them have accounts. What is bought
is that the database holds no addresses at all.

The label is a frozen constant in the same way the five HKDF labels of D2 are: changing it does not
corrupt anything, it makes every existing account unfindable. One vector, which both
implementations assert:

```
alice@example.com -> 176d00c0673f7e1e711ea55a7d9345f43949376bd9777c4854be01448b5b74a4
```

### One shape for every failure

```json
{ "error": { "code": "quota-exceeded", "message": "…", "limit": 20971520, "used": 20971520 } }
```

`code` is a stable identifier a client switches on. `message` is for a log and is **never shown to
a person** — MixLab's strings live in `src/i18n/` and are chosen by `code`. Any further members are
particular to that code and optional.

### `/v1/capabilities`

`200`, no authentication, `Cache-Control: public, max-age=3600`. It never reaches an account object
(D8). *No authentication* means exactly that: an `Authorization` header that is absent, malformed
or expired changes nothing about the answer, because a client reads this route before it has an
account at all.

```json
{
  "protocolVersions": ["v1"],
  "maxRecordBytes": 1048576,
  "maxBatchOperations": 100,
  "maxPageRecords": 500,
  "accountQuotaBytes": 20971520,
  "tombstoneRetentionDays": 90,
  "features": []
}
```

`features` is how a server announces something optional it has; an empty list is a complete v1
server. A client must run against an empty list forever.

### Accounts

| Route | Body in | Out | Refuses with |
| --- | --- | --- | --- |
| `POST /v1/auth/register` | `email`, `a`, `saltAccount`, `argon: {m, t, p}`, `wrappedMkPassword`, `wrappedMkRecovery` | `201`, `{}` | `400 invalid-request` · `409 email-taken` · `429` · `502 letter-not-sent` |
| `POST /v1/auth/verify` | `email`, `token` | `200`, `{}` | `400 invalid-token` · `429` |
| `POST /v1/auth/login` | `email`, `a`, `deviceName` | `200`, `{accessToken, refreshToken, deviceId, expiresIn}` | `401 invalid-credentials` · `403 email-not-verified` · `429` |
| `POST /v1/auth/refresh` | `refreshToken` | `200`, `{accessToken, refreshToken, expiresIn}` | `401 invalid-token` |
| `POST /v1/auth/password` | `a`, `newA`, `newSaltAccount`, `newWrappedMkPassword` | `200`, `{}` | `401 invalid-credentials` |
| `POST /v1/auth/reset` | `email` alone | `202`, `{}` | `429` |
| `POST /v1/auth/reset` | `email`, `token`, `a`, `saltAccount`, `wrappedMkPassword`, `wrappedMkRecovery` | `200`, `{recordsDeleted: 214}` | `400 invalid-token` |

- **Registration is not complete until the letter is accepted.** If the provider refuses it, the
  account is removed again and the answer is `502 letter-not-sent`. Keeping the account would be
  worse than it sounds: the address is now taken, so registering again answers `409`, and there is
  no route in `/v1` that re-sends a verification letter. A provider outage would hand somebody an
  address they can never use and never free.
- **Registering over an *unverified* account replaces it**, and sends a fresh letter. `409
  email-taken` is for an address with a **verified** account and for nothing else. Without this, a
  verification token that expires unused — twenty-four hours is not long — leaves the same trap by
  a different road: cannot verify, cannot register, and cannot reset, because a reset is only
  offered to an address that proved itself. Replacing it loses nothing, since D4 forbids writing
  any record before verification, so there is never anything there to lose. It also narrows the
  enumeration below: an address with an unverified account no longer answers differently.
- **`/v1/auth/reset` is one path with two shapes**, told apart by whether `token` is present: ask
  for the letter, then complete with what it carried. Two shapes rather than a second path because
  D4's table is the frozen surface, and a forgotten password is one operation a person performs in
  two steps rather than two operations.
- **Asking for a reset always answers `202`**, whether or not that address has an account. Unlike
  registration — which has to refuse a taken address and therefore leaks one (see below) — this
  route has no such obligation, so it does not leak.
- **Verification is the gate on signing in, not on writing.** Until an address is verified,
  `/v1/auth/login` answers `403 email-not-verified` and issues nothing, so in v1 **no token exists
  that could reach a record route with `verified` false**. D4's *"no record may be written before
  this"* is therefore enforced at the door, and the `403 email-not-verified` listed on the record
  routes below is defence in depth that `/v1` cannot currently reach. `server/conformance/` asserts
  the login refusal and does not assert the record one, because a suite that claimed to test an
  unreachable path would be claiming something false. Issuing tokens for an unverified address was
  the alternative, and it means handing credentials to whoever typed an address that may not be
  theirs.
- **Both codes are eight Crockford base32 characters**, shown as `XXXX-XXXX`: the same alphabet the
  recovery key uses (D2), without `I`, `L`, `O` and `U`, so nothing read off a screen is ambiguous.
  A server accepts them in any case and with any separators, and is strict about the alphabet —
  the rule `parse_recovery_key` already applies, so a person learns one way of typing a code from
  this product rather than two.
- **A code, and not a link.** A link has to carry an address the server believes it is reachable
  at, which is a second piece of configuration that is silently wrong until the first person clicks
  one — and this is a desktop application, so the person is already in front of the window that
  wants the code. It also removes a class of bug worth naming: mail scanners and link previewers
  fetch every URL in a message, so a link that verified on `GET` would be spent before the person
  read the letter, and a link that did not would need a page with a button. There is no link, so
  there is nothing to prefetch and no page to serve.
- **Eight characters are only safe because guessing is bounded**, so verification attempts are rate
  limited per account and `server/conformance/` asserts that they are. This is the one allowance
  the suite deliberately exhausts; every other limit it only reads.
- **A verification code lives 24 hours**; a reset code, one hour.
- **`400 invalid-token` covers wrong, expired and already-used alike.** Telling them apart is an
  oracle and buys a client nothing: the remedy is the same sentence in all three cases.
- **`POST /v1/auth/reset` deletes every record** and says how many (D6, case 3). It is the only
  route in `/v1` that destroys data, and the count exists so the client can show what it did rather
  than claim it. It deletes them outright rather than writing tombstones — a tombstone exists to
  tell another machine that something it can read is gone, and after a reset no machine can read
  anything. Every refresh token is revoked with them, so the other machines are signed out rather
  than left syncing an account whose `MK` they still hold and the server no longer serves. `seq`
  does not restart: it is monotonic for the life of the account.
- **`POST /v1/auth/password` re-wraps and does not re-encrypt.** `MK` is unchanged, so no record is
  touched and no `seq` moves (D6, case 1). Every refresh token except the calling device's is
  revoked.

### Devices

| Route | Out | Refuses with |
| --- | --- | --- |
| `GET /v1/devices` | `{devices: [{id, name, createdAt, lastSeenAt, current}]}` | `401` |
| `DELETE /v1/devices/{id}` | `204` | `401` · `404 unknown-device` |

Deleting a device **ends both its tokens at once**, and a request carrying either answers `401`
from the next one. An earlier draft of this appendix let the access token live out its fifteen
minutes, reasoning that closing it immediately would cost a revocation check on every request. That
reasoning was wrong for the servers actually being built: a token here is an opaque string the
server looks up (see below), so the lookup that would notice a revocation is the same lookup that
authenticates the request, and there is nothing to pay. Cutting off a lost machine is the whole
purpose of the route, so it cuts it off now. Deleting your own device is how a person signs out.

### Records

`PUT /v1/records/{collection}/{id}` carries `{updatedAt, nonce, ciphertext}` — **not** `version`
and **not** `seq`, which are the server's to assign. `DELETE` carries no body. Both answer with the
stored record of D3 and an `ETag` holding its `version` as a quoted decimal.

| Condition | Answer |
| --- | --- |
| `If-None-Match: *`, no such record | `201` + the record |
| `If-None-Match: *`, it exists | `412 already-exists` + the current record |
| `If-Match: "41"`, current is 41 | `200` + the record, `version` 42 |
| `If-Match: "41"`, current is 42 | `409 version-conflict` + the current record |
| neither header | `428 precondition-required` |
| `DELETE`, `If-Match` matches | `200` + the tombstone |
| `DELETE`, already a tombstone, `If-Match` matches it | `200` + that same tombstone, **no new version and no new `seq`** |
| `DELETE`, never existed | `404 unknown-record` |
| body over `maxRecordBytes` | `413 record-too-large` |
| account over `accountQuotaBytes` | `507 quota-exceeded`, with `used` and `limit` |
| `collection` or `id` not 64 lowercase hex characters | `400 invalid-request` |
| address not yet verified | `403 email-not-verified`, unreachable in v1 — see above |

The tombstone rule is worth its row: without it, a delete retried after a dropped connection bumps
`seq` and every other machine pulls a change that is not one.

**A tombstone is a version like any other.** `If-Match` on its version writes over it and the
record comes back — which is what happens when somebody deletes a saved query on one machine and
the same local uuid is written again from another — and `If-None-Match: *` counts it as existing
and answers `412`. The alternative, treating a deleted row as absent, would let a creation slip
past a deletion and leave the two machines disagreeing about which one won.

`GET /v1/records?collection={c}&since={seq}`:

- **`collection` is optional**, and omitting it means every collection. D4 writes the narrow form;
  the broad one is what a burst sync actually wants, and D8's first rule is about how often a
  client wakes an object rather than how much it carries.
- `since` is **exclusive**, and `since=0` means from the beginning.
- `200`, `{records: [...], nextSince: 903, more: false}`, ordered by `seq` ascending, at most
  `maxPageRecords`. A client that sees `more: true` calls again with `nextSince`.
- `410 cursor-expired` when `since` is older than the oldest surviving tombstone — D3's *"told to
  resync from empty rather than told incomplete news quietly"*, made into a status code.

`POST /v1/records/batch`:

```json
{ "operations": [
  { "op": "put", "collection": "…", "id": "…", "ifNoneMatch": true,
    "record": { "updatedAt": 1758300000, "nonce": "…", "ciphertext": "…" } },
  { "op": "delete", "collection": "…", "id": "…", "ifMatch": 41 }
] }
```

```json
{ "results": [ { "status": 201, "record": {…} }, { "status": 409, "record": {…} } ] }
```

One result per operation, in the order sent, each carrying exactly the status and body that the
single-record route would have. **The envelope is `200` whatever the entries say** — it is a batch
of independent compare-and-swaps and not a transaction (D4), so a `409` in entry seven is news for
the client, not a failure of the request. `400 invalid-request` when the list is empty or longer
than `maxBatchOperations`; `507` on the envelope only when the account is already over quota.

### Tokens

An access token lives **fifteen minutes**, a refresh token **ninety days**, and a refresh **rotates
on use**: the answer carries a new one and the old one dies. Presenting a rotated refresh token
again revokes that device's whole chain and answers `401` — either it was stolen, or two clients
raced, and both want the person to sign in again rather than to continue quietly.

**They are opaque strings, not JWTs.** The only party that reads a token is the server that issued
it, so the stateless validation a JWT buys has no customer here, and a signed token that cannot be
withdrawn is the wrong shape for a route whose whole purpose is cutting off a lost machine.

### Rate limiting

`429` with `Retry-After` in seconds. The limits are configuration and are not reported by
`/v1/capabilities` — publishing the number that stops abuse helps only the abuser. The suite
asserts the shape of the refusal and never trips it deliberately.

### The one door that is not `/v1`

Verification arrives by email, which no HTTP suite can read. A server under test therefore serves
`GET /__test__/outbox?email=…`, returning the tokens it would have sent, **and answers `404` unless
it was started with that mode explicitly enabled**. It is outside `/v1` so that the frozen surface
stays frozen, and a deployed server cannot be asked for it. Both implementations carry it, because
`server/conformance/` requires it.

```json
{ "messages": [ { "kind": "verification", "token": "…", "sentAt": 1758300000 } ] }
```

Oldest first, so the newest of a kind is the last one. `kind` is `verification` or `reset`. This
shape is written down for the same reason everything else here is: it is the seam between the suite
and both implementations, and a seam nobody specified is a seam that differs.

### Four choices that could have gone the other way

1. **`409 email-taken` lets an attacker learn which addresses have a *verified* account.** The alternative —
   always answer `201`, and send a *"somebody tried to register your address"* letter instead — is
   what a password manager does, and it costs a client that cannot tell a person they already have
   an account, plus a new way to send mail to a stranger. The leak it prevents is *"this address
   uses MixLab"*, against a threat model (D1) that is about the server operator and whoever takes
   the database, not about an enumerator. Rate limiting makes the sweep slow and loud. **Revisit
   this if MixLab ever holds something where membership itself is sensitive** — this is a developer
   tool, and it does not.
2. **A code the person types, rather than a link they click.** The link is the obvious design and
   it loses on three counts: it needs the server to know its own public address, which is a setting
   that is wrong silently; it is fetched by mail scanners before the person reads the letter, so
   either it does not verify on `GET` and needs a page with a button, or it is spent; and the
   person is already looking at the window that wants it. The cost is eight characters of typing
   and a rate limit that has to be real.
3. **Reusing a rotated refresh token revokes the chain** rather than being ignored. It is the one
   signal this design gets for free that a token has been copied.
4. **`updatedAt` is never compared by the server**, including here, where it would have been easy
   to reject a write whose clock runs backwards. D1 promises the server compares nothing; a client
   with a wrong clock is a client problem, and a server that enforced monotonic clocks would be
   unable to accept a legitimate write from a machine that had just fixed its own.

## D4b. Moving an account to another server

**This is in `/v1` from the first commit, and that is the only reason it can ever be used.** `/v1`
is frozen and a server somebody else runs does not update when this document does (D9, R4), so a
client that meets an answer it does not understand stops syncing with a strange error. A way for a
server to say *"this account is not here any more"* added later would only work for clients written
after it — which is exactly the population that does not need it. Migration is hypothetical; the
place to say it is not.

**The client moves the account, and the server is told.** Nothing here asks a server to export
anything, and nothing asks it to enumerate its accounts — which it cannot do, because addressing by
`account_key` is what this design has instead of an index (D8). The machine that already holds the
data is the one that carries it across.

**The data crosses unchanged.** The client keeps `MK`, so it registers on the new server with the
*same* `salt_account` and the same two wrapped copies, and `K_id` and `K_data` come out the same on
the other side: the opaque ids and the ciphertexts are identical bytes, and the recovery key still
opens the account. Nothing is re-encrypted, and the peppers of the two servers never have to match,
because each one keys its own verifier.

### Three states

| State | Reads | Writes | What it means |
| --- | --- | --- | --- |
| `active` | yes | yes | The normal state. Nothing has moved |
| `frozen` | yes | **no** | A move is under way. The client is copying; nothing may change under it |
| `retired` | no | no | The account lives somewhere else now, and this server says where |

`GET /v1/account/relocation` answers
`{"state": …, "home": "<endpoint id>" | null, "frozenUntil": <seconds> | null}`.
`POST` takes `{"state": …}` and moves between them. Both need an access token, and **`GET` answers
in every state**, including `retired` — a machine that meets a refusal has to be able to find out
why.

- `active` → `frozen`, and `frozen` → `active`. **Thawing has to exist**: a copy that fails halfway
  must not leave an account nobody can write to.
- `frozen` → `retired`. **`active` → `retired` is refused**, with `409 must-freeze-first`.
- `retired` is terminal, and it deletes every record here. What stays is the signpost: the
  `account_key`, the address, the verifier and `salt_account`.

### The freeze is a lease, and that is the whole answer to the interesting failure

**A freeze expires.** It carries `frozenUntil`, and once that passes the account is `active` again
whatever the column says. A client that is still copying re-arms it by posting `frozen` again,
which is idempotent and pushes the lease out.

This is not tidiness. Consider the case the design has to survive: a machine freezes the account,
starts uploading, and **loses the network or the power**. The new server has part of the data or
none of it; the old one is read-only; and the machine that knew what it was doing may never come
back. With a latch, that account is unwritable for ever and nobody on earth can fix it without an
operator. With a lease it repairs itself in minutes, and the worst a person sees is an application
that could not save for a while.

**Resuming needs no bookkeeping.** The client keeps `MK`, so the records it re-uploads are the same
opaque ids and the same bytes as the ones that already arrived: pushing the whole set again with
`If-None-Match: *` and treating `412 already-exists` as success is exactly the right behaviour, and
it is correct whether the previous attempt copied nothing, half, or everything. There is no
progress to record and nothing to reconcile.

**Any machine can take over, or give up.** A second machine that meets `423` reads
`GET /v1/account/relocation`, sees `frozen`, and either continues the copy — it can read everything
from the old server, which is still readable — or posts `active` and abandons the move. What it
must not do is guess.

**Retire only after the copy has been checked**, because retiring deletes. The client compares what
the new server holds against what the old one still shows before it takes the last step, and if
they disagree it thaws instead. A server cannot enforce this; it is written here because it is the
one place where the client can destroy something.

**Freeze first, then copy — not copy, then freeze.** With the other order there is a window between
the last record the client reads and the moment the account stops accepting writes, and anything a
*second* machine writes in that window is lost silently. Two machines writing to two servers cannot
be reconciled afterwards either, because their `seq` counters are independent. The cost of the
right order is a short read-only period, which a local-first application does not show anybody.

### What a moved account answers

- Every authenticated route: **`410 Gone`**, code `account-moved`, with `home`. Retirement is
  permanent, which is what `410` says.

  **`421 Misdirected Request` reads better and was tried first.** Its prose is exactly this case —
  *this server cannot answer for this authority; ask another* — but RFC 9110 lets a client retry a
  `421` **on a different connection**, and real clients do: Node's `fetch` retried, found the body
  already sent, and failed the request with a content-length mismatch instead of surfacing the
  answer. A status whose meaning is *retry elsewhere at the transport level* is the wrong vehicle
  for *this account is at a different service*. `server/conformance/` found this, on a reused
  keep-alive connection, which is where it would have found MixLab too.

  `410` is also what `cursor-expired` uses. That is fine and is what the `code` is for: a client
  switches on the code, and the status is only the class of answer.
- `POST /v1/auth/login`: `410` **only after the verifier matches**. A wrong password still gets
  `401`. Otherwise a fresh install could ask *"where does this address live"* without proving
  anything, and that is a cheaper enumeration oracle than the `409` registration already admits to.
- `POST /v1/auth/register` on the address: `409 email-taken`, unchanged. Registration proves
  nothing, so it learns nothing new.
- While `frozen`, any mutation — a record, a batch, a password change — answers **`423 Locked`**,
  code `account-frozen`. Reads and sessions are untouched, because the client needs both to do the
  copying.

### `home` names an endpoint, and never a URL

`home` is a short symbolic id, and the client resolves it against the list of servers **it already
ships**. It is not an address the server supplies.

A server that could send a client to an arbitrary URL is a phishing primitive: the destination
learns `A`, which is the login verifier, and `A` is the same value on every server because it comes
from the password. It could not read a record — it has no `MK` — but it would not need to. Letting
the old server choose only *which of the destinations you already trust* costs nothing and closes
that.

The consequence is that **this is for the default instance**. Somebody self-hosting who moves their
own server tells their own users, the way they already choose the address in the first place (D8);
a symbolic id would mean nothing to a client that has never heard of them. `home` is `null` until
a deployment is configured with one, and `frozen` → `retired` is refused while it is, with
`409 relocation-not-configured` — so no client can strand an account somewhere with nowhere to go.

### What it does not solve

**The old server cannot be switched off.** This moves the data, not the obligation: for as long as
an old client exists — including an old installer somebody runs again — the old server has to be
there to answer `421`. Auto-update bounds that, but it does not end it on a date.

**And the client needs `A` to register on the far side**, which is derived from the password it does
not keep. Either it holds `A` beside `MK` — defensible, since anything that reaches one locally has
already reached the other — or it asks for the password once and says what it is doing. This
document does not decide that: it is a decision about the client, and it belongs with the account
screen in T177e.

## D5. What syncs, and what never does — a client-side catalogue

**Nothing in this section is part of the protocol.** The server never sees a single name in the
table below: a collection reaches it as `HMAC(K_id, name)`, 32 bytes it cannot invert and cannot
enumerate. This list is a decision MixLab makes about its own files, and it grows whenever MixLab
grows — without a line changing under `server/`, which is the point D9 is built around.

Every row is **off** until a person turns it on. A secret row cannot be turned on until the row it
belongs to is.

| Collection | Source on disk | Carries |
| --- | --- | --- |
| `preferences` | `localStorage`: theme, accent, glass, language, enabled modules | one record per key |
| `terminal-settings` | `terminal-settings.json` | font, cursor, scrollback |
| `connections` | `connections.json` | host, port, user, database, SSH configuration — **no credential** |
| `connection-secrets` | the `MixLab` vault | `password`, `uri`, `sshPassword`, `sshPassphrase` |
| `terminal-hosts` | `terminal-hosts.json` | saved SSH targets, no credential |
| `terminal-host-secrets` | the `MixLab` vault | those targets' SSH credentials |
| `rest-requests` | `rest-requests.json` | the collection: method, URL, headers, body |
| `rest-environments` | `rest-environments.json` | names, and the values **not** marked secret |
| `rest-env-secrets` | the `MixLab` vault | the values marked secret |
| `query-snippets` | `query-snippets.json` | saved SQL |
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

Three cases, and the third is the one a person has to be told about before they need it.

1. **Changed while signed in** — re-wrap `MK`, one request, nothing else moves.
2. **Forgotten, recovery key held** — `RK` unwraps `MK` on the machine; the person sets a new
   password and the client uploads a new `wrapped_mk`. The server is told after the fact and proves
   nothing about `RK`, having never seen it.
3. **Both lost** — the emailed reset restores the *login*, and nothing restores the data: every
   record is encrypted under an `MK` no surviving key unwraps. The reset therefore deletes every
   record rather than leaving an account full of bytes that decrypt for nobody, and the dialog says
   exactly that before it proceeds.

## D7. Where the code lives

- **`apps/desktop/src-tauri/src/sync/`** — the key hierarchy, the envelope, the transport, the
  record store. Rust, because `MK` should not pass through a JavaScript heap and the credential
  store is already there. `crypto.rs` is written to be read in one sitting and carries test
  vectors: the promise in D1 is a property of that file and of nothing on the server.
- **`apps/desktop/src/shell/`** — sign-in, the recovery-key ceremony, the per-collection list, the
  device list, the conflict prompt.
- **A module declares what it will lend, and the shell never learns what it is.**
  `ModuleDefinition` (`src/shell/module.ts`) gains an optional set of syncable collections, each an
  id, a label, a reader, a writer and a default of `false`. `registry.ts` wires them as it already
  wires tabs. `core/` and `shell/` see "records with an id and an `updatedAt`" and never the word
  *connection*, so the lint boundary holds without a third exception.
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

**That run is a workflow of its own.** `.github/workflows/server.yml` is not a job family in
`ci.yml` and does not share its triggers. `ci.yml` compiles the workspace for three operating
systems, which is why every ref there asks for its run rather than getting one from a push; this is
one Ubuntu runner that installs an npm project, starts a Worker and builds one small Rust crate.
`server/**` is the only path that fires it, so a change to MixLab or to the engine spends nothing on
a server nobody touched, and a change under `server/` drags no three-OS matrix behind it. **On
`master` it fires without being asked**, which is the thing `ci.yml` will not do and the reason
`gallery.yml` and `pages.yml` are also outside that file: Workers Builds deploys `server/worker/`
from `master` on its own, so there a server that is red and unrun is a server that is deployed red.
Every other ref asks, the way every other ref here does.

**Separate triggers do not cost what [ADR 0046](../decisions/0046-the-sync-server-lives-beside-the-client-it-serves.md)
bought**, because both implementations are jobs in this one workflow: the suite runs against the
Worker and against the native binary in the same run, on the same commit, in the same pull request
as whatever client change arrived with them. What that decision rejected was a second *repository* —
an artifact to publish before the halves could be compared at all. A second workflow file publishes
nothing and waits for nothing.

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

**Workers cannot speak SMTP, so an SMTP account is the wrong thing to hold.** What the server needs
is a provider with an HTTP API. Two things are worth writing down because the internet is full of
stale advice about both: Cloudflare's own Email Routing **receives** and does not send, and
MailChannels' free offering for Workers **ended in 2024**.

**The provider sits behind one function**, and that is a more important decision than which provider
it is. Every free tier in this market will be renegotiated within a few years; what protects this
project is that changing provider is one file rather than a migration.

**The volume is two messages in the lifetime of an account** — verify an address at registration,
prove control of it after a forgotten password — and nothing else. No notification, no digest, no
newsletter. A thousand new accounts in a month sits far inside any free tier on offer.

**So the cost risk is abuse, not success**, and the controls for it are already here rather than
added for this: registration is rate limited per address and per source, and D4 forbids writing any
record before an address is verified — a rule written to stop the server becoming anonymous free
storage, which stops this too. A ceiling on messages per account per day closes the rest.

**A server missing a piece of its configuration refuses to start, and names the piece.** Whoever
deploys this — us, or somebody on their own Cloudflare account — sets the provider's key and the
`pepper` themselves, and the failure that follows forgetting one is otherwise invisible: the deploy
succeeds, registration succeeds, and a person waits for a letter that was never sent. Checking at
startup turns a silence into a sentence. It costs a few lines and is the difference between an
afternoon and a weekend for the first person who self-hosts this.

**The self-hosted implementation is a native binary — Rust, and a SQLite file — and it is built
alongside the Worker rather than after it.** The promise is that `/v1` is a protocol and not a
description of one codebase, and a second implementation is the only thing that can ever prove it.
This is also why **the conformance suite is written before the first server**: a suite written
afterwards describes what was built, `/v1` quietly becomes "whatever the Worker does", and the
second implementation stops being writable at all. Built together, each is the other's proof.

Either implementation owns the same closed set: registration and verification, tokens and their
revocation, the record table with its compare-and-swap, tombstone reaping, a per-account quota, and
the capability document. Neither owns any knowledge of what a record is.

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

Durable Objects with the SQLite backend are reachable on the free plan. **Read off Cloudflare's
pricing page on 2026-09-20: 100,000 requests a day and 13,000 GB-s of duration a day.** The storage
row was not read, so every figure about stored bytes below is an assumption carried from hearsay and
is marked as one. Should the free tier ever stop
being true, the fallback is **D1**: still SQLite, still free, but the serialization that made this
design easy is gone — `seq` and the compare-and-swap would then need a written transaction instead
of a guarantee, and reaping a Cron Trigger over a shared table instead of an alarm per account. The
protocol would not change, and a client could not tell the difference.

**Duration runs out before requests do.** At 128 MB an object, 13,000 GB-s is about 104,000 seconds
of object life a day, and an object stays resident for a short while after its last request. So what
costs money is not how much data moves but **how often a client wakes an object up**: one sync that
pulls and pushes in a single burst holds one window open, while the same calls scattered through the
day open a dozen. Three of the four things that follow are therefore rules about **MixLab**, not
about the server, which is why they are in this design rather than in `server/`.

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

**On storage — and this paragraph rests on a number nobody here has checked.** A record is a couple
of hundred bytes of metadata and its ciphertext; a light account — twenty connections, thirty saved
requests, some snippets and preferences — is around 150 KB, and a heavy one one or two megabytes, so
half a megabyte is a fair average. *If* the free allowance is the 5 GB it is commonly said to be,
that is on the order of 10,000 accounts, with an honest range of 5,000 to 25,000. **The allowance is
the unknown, not the arithmetic**: read the storage row before anything depends on the answer, and
if it is smaller, every number here scales with it. The per-account quota exists to bound the worst
case rather than to promise the average; 20 MB is the number to start from.

**The two ceilings measure different populations**, which is worth knowing whatever the storage
number turns out to be: storage bounds how many accounts have ever existed, duration bounds how many
are used on a given day, and a tool like this sees perhaps a tenth to a fifth of its accounts in a
day. On the assumption above the two land within a factor of one of each other, so neither is wasted
on the other — but that is a consequence of the unchecked figure, not an argument for it.

**D5's refusal list is what makes any of this arithmetic work**, and here the ratio is the point
rather than the allowance. Syncing `rest-history.json` would put a hundred response bodies at up to
256 KB each into one account — twenty-five megabytes a person against half a megabyte, **fifty times
the storage for every user**, whatever the ceiling is. The reason that file is not in the catalogue
is that it holds somebody else's production data; the capacity is a second dividend from a decision
made for another reason entirely.

### Moving the default instance

**The two implementations do not share an account id, and it does not matter.** The Worker
addresses an account by `idFromName(SHA-256(lowercased address))`; the native server gives it a row
number. Neither is ever on the wire. What *is* on the wire — the opaque `collection` and `id` of D3
— is `HMAC(K_id, …)`, derived on the client from `MK`, so it is a property of the account's own key
and not of whichever server is holding it.

**But the Worker cannot list its accounts, and that is deliberate.** D8 above has no account table
and no index, because nothing in this design ever queries across accounts. The direct consequence
is that **the operator has no list of addresses to migrate** and cannot perform a bulk server-side
move. That is a cost of the privacy property, not an oversight, and it is written here so nobody
discovers it on the day they want to move.

**It is also not needed, because the client is the source of truth.** Everything in an account is
derived from files MixLab already holds in plaintext on the machine, plus an `MK` the person holds
two wrappings of. The server is a carrier. So moving the default instance is a thing a *person*
does — point MixLab at the new server, make an account, push — and it is lossless, because nothing
was only ever on the server. The records arrive under a new `MK` with new opaque ids and a `seq`
that starts again, and no other machine can tell the difference once it has signed in too.

**The one person this fails** is somebody whose only copy *was* the server: one machine, lost, with
sync as the backup. For them a move that is not a migration is data loss. Two things follow. An
operator who moves the default instance announces it and leaves the old one answering until
everybody has signed in to the new one — a deprecation, not a switch. And **if a silent migration
ever becomes necessary, the thing that has to change first is the no-index decision**, in a new
spec that argues for the index and says what it costs, rather than in a hurry.

**These limits are per Cloudflare account**, so somebody who deploys this Worker to their own gets
the whole allowance for themselves. The middle row of the table above scales without anybody paying
for it, which is not usually true of a self-hosting story.

**The contract is normative here**, in D2 to D4 of this document, and `server/conformance/` is
written against *it* rather than against either implementation — which is why the suite sits beside
both rather than inside one, and why it is written before the first server exists. It runs against
any base URL: against the Worker and the native binary in CI, and against whatever a self-hoster
has deployed.

**`/v1` is frozen at D4** and a change to it is a new path rather than an edit. That was the
mitigation for two repositories drifting when the server had one of its own; with both halves in
one tree the drift cannot happen at all, and the freeze now earns its place for the other reason —
a server somebody else is running does not update when this document does (D9, R4).

In MixLab the server is a setting. It defaults to the hosted instance, and changing it signs the
person out: records written under one account's `MK` are not readable under another's, and
pretending otherwise would quietly produce an account full of rows that decrypt for nobody.

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
