# The conformance suite

One test suite for both sync server implementations. Neither server defines the protocol.

The suite is written against D2 to D4a of
[the sync design](../../docs/specs/2026-09-20-t177-a-copy-only-you-can-read-design.md), not against
`../worker/` or `../native/`. That is also why it was written before either server existed. A suite
written afterwards would only describe what the first server happened to do, `/v1` would come to
mean exactly that, and a second implementation would become impossible to write.

**If the suite and the design disagree, the design is right** and the suite has a bug. Fix the
suite. Don't change the design to match a test.

## Running it

```bash
npm ci
CONFORMANCE_BASE_URL=http://127.0.0.1:8787 npm test
```

Point it at any server: `wrangler dev` on a laptop, either implementation in CI, a container, or a
self-hosted deployment. There is nothing else to configure. The suite reads every limit it needs
from `GET /v1/capabilities`.

## What a server needs to provide

**A test outbox.** Verification and reset codes arrive by email, which an HTTP test can't read. So
a server under test serves `GET /__test__/outbox?email=…`, and answers `404` unless that mode was
turned on on purpose. It sits outside `/v1`, so the frozen API stays unchanged and a deployed server
can't be asked for it.

**Nothing else.** Every test creates its own account with a random address, so the suite needs no
reset hook, leaves no shared state, and can run twice in a row against the same server.

## What it doesn't include

**No cryptography.** The server never looks inside a ciphertext (D1), so every opaque field the
suite sends (`collection`, `id`, `nonce`, `ciphertext`, `a`, `saltAccount`, `wrappedMk…`) is random
bytes of the right length. If the suite rebuilt the key hierarchy to test the server, it would be
testing something the server must never do, and it would keep passing against a server that had
started doing it.

**No checks that a limit equals a specific number.** Every limit is configuration, reported by
`/v1/capabilities` (D4a). The suite checks that a server respects the value it reported, not what
that value is.

**One exception: the verification limit, which the suite uses up on purpose.** Verification asks
the person to type an eight-character code, and forty bits is only safe because the number of
guesses is limited. That makes the limit part of the protocol rather than a deployment detail, and
a server without it would pass every other test. The suite only reads the other limits.

## What it can't test on its own

Three tests are skipped, with a clear message, instead of passing without testing anything:

- **Quota**, when the server reports an account quota larger than 8 MB. Filling that over HTTP
  would take minutes of CI time for one check.
- **Cursor expiry**, unless the server reports `tombstoneRetentionDays: 0`. The real value is
  ninety days, and no test can wait that long.
- **A closed deployment**, unless the server was started with a shared access token. An open server
  can't show how a closed one behaves (D4a).

CI covers all three. The quota test runs because the `conformance` environment reports small
limits. Cursor expiry runs against **a second instance** with a retention of zero; reaping
immediately on the first instance would break every other tombstone test. The same second instance
is also closed with a token and announces a closing date.

**Freezes no longer need a second instance.** A freeze used to be a lease, and seeing it expire
needed a server that granted leases for a few seconds. Now a freeze ends when a client ends it, so
all of it can be tested against any server (D4b).

**Reaping happens in the background**, so the expiry test polls instead of checking right after the
delete. D8 schedules an alarm rather than cleaning up inline, and a test that assumed otherwise
would be testing one implementation instead of the protocol. For the same reason, the three tests
that need a tombstone to still exist are skipped against a zero-retention server. Otherwise one of
them would pass or fail depending on a one-second race.

One case has no test at all, because it can't happen: `403 email-not-verified` on a record route.
You can't sign in until your address is verified, so in v1 no token can reach a record route with an
unverified address (D4a). The server still checks it as a second line of defence, but a test that
claimed to cover it would be claiming something untrue.
