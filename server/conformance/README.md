# The conformance suite

One suite, two implementations, neither of them the definition.

It is written against **the document** — D2 to D4a of
[the sync design](../../docs/specs/2026-09-20-t177-a-copy-only-you-can-read-design.md) — and
against neither `../worker/` nor `../native/`. That is the whole point of it, and it is why it was
written before either server existed: a suite written afterwards describes what was built, `/v1`
quietly becomes *whatever the first server does*, and a second implementation stops being writable
at all.

**When the suite and the document disagree, the document wins** and the suite is the thing with the
bug. Fix it here; do not adjust the specification to match a test.

## Running it

```bash
npm ci
CONFORMANCE_BASE_URL=http://127.0.0.1:8787 npm test
```

Any base URL: a `wrangler dev` on a laptop, either implementation in CI, a container, or whatever
somebody self-hosting has deployed. There is no other configuration — the suite discovers every
limit it needs from `GET /v1/capabilities`.

## What it needs from a server

**A test outbox.** Verification and reset arrive by email, which no HTTP suite can read, so a
server under test serves `GET /__test__/outbox?email=…` and answers `404` unless that mode was
enabled deliberately. It is outside `/v1` so the frozen surface stays frozen and a deployed server
cannot be asked for it.

**Nothing else.** Every test opens its own account with a random address, so the suite needs no
reset hook, leaves no shared state, and can be run twice in a row against the same server.

## What it does not contain

**No cryptography.** The server never inspects a ciphertext (D1), so every opaque field the suite
sends — `collection`, `id`, `nonce`, `ciphertext`, `a`, `saltAccount`, `wrappedMk…` — is random
bytes of the right length. A suite that reproduced the key hierarchy in order to exercise the
server would be exercising something the server is not allowed to do, and would keep passing
against a server that had learned to do it.

**No assertion that a limit equals a number.** Every limit is configuration reported by
`/v1/capabilities` (D4a). The suite asserts that a server honours the value it reported, never that
it reported a particular one.

## Two things it cannot reach on its own

Both skip loudly rather than passing quietly, and both are covered in CI by an instance configured
for them:

- **Quota**, when the server reports an account quota larger than 8 MB — filling it over HTTP is
  minutes of runner time for one assertion.
- **Cursor expiry**, unless the server reports `tombstoneRetentionDays: 0`. The real value is
  ninety days and no test can wait it out.

A third is unreachable by design and has no test: `403 email-not-verified` on a record route.
Verification gates signing in, so in v1 no token can exist that reaches a record route with an
unverified address (D4a). It stays in the server as defence in depth; a test claiming to exercise
it would be claiming something false.
