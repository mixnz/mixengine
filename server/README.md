# The sync server

Two implementations of one protocol, and the suite that decides which of them is right.

```
conformance/   the suite both implementations answer to
worker/        Cloudflare Workers and Durable Objects — the default instance
native/        Rust and a SQLite file, for a machine somebody runs themselves
```

**The protocol is normative in the design document**, D2 to D4a of
[the sync design](../docs/specs/2026-09-20-t177-a-copy-only-you-can-read-design.md), and in
neither implementation. `conformance/` is written against that document, which is why it sits
beside both rather than inside one, and why it was written before the first server existed: a suite
written afterwards describes what was built, `/v1` quietly becomes *whatever the first server does*,
and a second implementation stops being writable at all.

**Two implementations is the point, not a duplication to be cleaned up.** The promise is that `/v1`
is a protocol and not a description of one codebase, and something other than the Worker speaking
it is the only thing that can ever prove that. Each is the other's proof; the suite is what makes
the claim checkable rather than asserted.

**Neither of them can read what it holds.** Every value arrives sealed under a key derived on the
machine that sent it. D1 of the design lists in full what a server necessarily sees, and the list
is written down because a list that is not written down grows.

Why this lives here rather than in a repository of its own, and what would reverse that:
[ADR 0046](../docs/decisions/0046-the-sync-server-lives-beside-the-client-it-serves.md).

## Its CI is its own

`.github/workflows/server.yml`, fired by `server/**` alone. `ci.yml` gains no job family from this
and no server change fires its three-OS matrix; the argument is in the workflow's own header.

One run answers for both implementations, which is what
[ADR 0046](../docs/decisions/0046-the-sync-server-lives-beside-the-client-it-serves.md) was decided
to buy. It runs the suite **four times**: against the Worker, against the native binary, and
against a second instance of each configured for the things that are otherwise out of reach in a
test: tombstones reaped at once, a closing date announced, and a shared access token.
`410 cursor-expired` is ninety days away otherwise, and a status no suite reaches is a status
the two implementations are free to disagree about. On `master` it also builds the image and runs the suite against the
container before publishing it, so what is published is what was tested.
