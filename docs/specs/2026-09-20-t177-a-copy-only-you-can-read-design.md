---
status: draft
date: 2026-09-20
task: T177
---

# T177 — A copy only you can read

Roadmap task [T177](../roadmap/phase-30-a-copy-only-you-can-read.md), phase 30. 2026-09-20.
Decision: [ADR 0045](../decisions/0045-mixlab-has-an-account-and-mixengine-does-not.md).

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

The server stores `Argon2id(A, salt_server)`. So `A` arriving there does not put `K_wrap` within
reach — they are two HKDF expansions of one secret, and neither yields the other — and a stolen
database does not put `A` within reach either.

It also stores two wrapped copies of `MK`, and can open neither:

```
wrapped_mk          = XChaCha20-Poly1305(K_wrap, MK)
wrapped_mk_recovery = XChaCha20-Poly1305(HKDF-SHA256(RK, info = "mixlab-sync/recovery/v1"), MK)
```

`RK` is 32 random bytes shown to the person **once**, at registration, as ten groups of five base32
characters. Registration does not finish until they type two of the ten groups back.

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

Frozen as `/v1` before the first line of client code, because the two halves live in two
repositories (ADR 0045) and a shape that moves costs two coordinated releases.

| Method | Path | Does |
| --- | --- | --- |
| `POST` | `/v1/auth/register` | email, `A`, `salt_account`, the Argon2 parameters, both wrapped copies of `MK` |
| `POST` | `/v1/auth/verify` | completes the emailed link; **no record may be written before this** |
| `POST` | `/v1/auth/login` | email, `A`, a device name → a short access token and a per-device refresh token |
| `POST` | `/v1/auth/password` | current `A`, new `A`, new `salt_account`, new `wrapped_mk` |
| `POST` | `/v1/auth/reset` | emailed proof only; restores the login and **abandons the data** (D6) |
| `GET` `DELETE` | `/v1/devices` · `/v1/devices/{id}` | list, and cut off a lost machine by killing its refresh token |
| `GET` | `/v1/records?collection={c}&since={seq}` | what changed, oldest first, with the next cursor |
| `PUT` | `/v1/records/{c}/{id}` | `If-Match: {version}`, or `If-None-Match: *` to create |
| `DELETE` | `/v1/records/{c}/{id}` | writes a tombstone; `If-Match` applies |
| `POST` | `/v1/records/batch` | many of the above in one round trip, each with its own outcome |

**A conflict is the client's to resolve and the server's to refuse.** A `PUT` whose `If-Match` is
stale gets `409` and the current record. The client compares `updatedAt`, keeps the later one,
breaks a tie on the lexicographically greater device id, and retries. The server compares nothing.

`/v1/records/batch` exists because a machine signing in for the first time pushes its whole local
set, and two hundred round trips to do it is the difference between a pause and a wait. It is a
batch of independent compare-and-swaps, not a transaction: each entry succeeds or conflicts on its
own.

## D5. What syncs, and what never does

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

`mixlab-sync`, its own repository (ADR 0045): Rust, axum, and **SQLite** — one binary and one
file, which is what makes "you can run this yourself" a sentence somebody can act on in an
afternoon. One account's records are small, and the escape hatch to Postgres is a schema kept free
of SQLite-only syntax rather than an abstraction written in advance.

It owns registration and verification, tokens and their revocation, rate limiting per email and per
address, the record table with its compare-and-swap, tombstone reaping, and a per-account quota. It
owns no knowledge of what a record is.

**The contract is normative here**, in D2 to D4 of this document. The server repository carries a
conformance suite written against it that runs against any base URL — in its own CI, and in the
hands of anybody self-hosting. Two repositories can drift; what `mixengine-packages` teaches, and
what `.github/workflows/gallery.yml` was built to answer, is that a coupling maintained by memory
goes stale. So `/v1` is frozen at D4, and a change to it is a new path rather than an edit.

In MixLab the server is a setting. It defaults to the hosted instance, and changing it signs the
person out: records written under one account's `MK` are not readable under another's, and
pretending otherwise would quietly produce an account full of rows that decrypt for nobody.

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
