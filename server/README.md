# The sync server

MixLab's sync server comes in two implementations of one protocol, plus a test suite both of them
have to pass.

```
conformance/   the suite both implementations are tested against
worker/        Cloudflare Workers and Durable Objects, the default instance
native/        Rust and a SQLite file, for a machine you run yourself
```

The protocol is defined in D2 to D4a of
[the sync design](../docs/specs/2026-09-20-t177-a-copy-only-you-can-read-design.md), not by either
implementation. `conformance/` is written against that document, so it sits beside both servers
instead of inside one. It was also written before the first server existed. A suite written
afterwards would only describe what the first server happened to do, and `/v1` would drift into
meaning exactly that.

Having two implementations is deliberate. The only way to show that `/v1` is a real protocol, and
not a description of one codebase, is for a second server to speak it. The suite is what checks
that they agree.

Neither server can read what it stores. Every value is encrypted on the machine that sent it, with a
key the server never sees. D1 of the design lists everything a server does see.

[ADR 0046](../docs/decisions/0046-the-sync-server-lives-beside-the-client-it-serves.md) explains why
the server lives in this repository and what would make us move it out.

## CI

The server has its own workflow, `.github/workflows/server.yml`, which runs only when something under
`server/**` changes. It adds no jobs to `ci.yml`, and a server change never starts the three-OS
matrix. The workflow's header explains why.

One run covers both implementations, which is what
[ADR 0046](../docs/decisions/0046-the-sync-server-lives-beside-the-client-it-serves.md) set out to
get. It runs the suite four times: against the Worker, against the native binary, and against a
second instance of each, configured to reach what a normal test can't: tombstones reaped
immediately, an announced closing date, and a shared access token. Without that second instance,
`410 cursor-expired` would be ninety days away, and a status the suite never reaches is one the two
servers could quietly disagree on. On `master`, the workflow also builds the container image and
runs the suite against it before publishing, so the published image is the one that was tested.
