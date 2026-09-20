# The native server

MixLab's sync server as a single binary over a SQLite file, for a machine somebody runs themselves.

**This is the second implementation, and that is its job.** The default instance is the Worker in
`../worker/`; this speaks the same `/v1` over different machinery. The promise the design makes is
that `/v1` is a protocol and not a description of one codebase, and something other than the Worker
speaking it is the only thing that can ever prove that. `../conformance/` is written against the
document both answer to — D2 to D4a of
[the sync design](../../docs/specs/2026-09-20-t177-a-copy-only-you-can-read-design.md) — and
against neither of them.

**It cannot read what it holds.** Every value arrives sealed under a key derived on the machine
that sent it. D1 of the design lists in full what a server necessarily sees.

## Running it

```bash
cargo run
```

It refuses to start without a pepper and an email provider, and names all of them at once rather
than the first — setting one at a time and restarting is the slow way to find out you needed three.

```bash
MIXLAB_SYNC_PEPPER=$(head -c 32 /dev/urandom | base64) \
MIXLAB_SYNC_EMAIL_API_KEY=… \
MIXLAB_SYNC_EMAIL_FROM=noreply@example.com \
MIXLAB_SYNC_EMAIL_PROVIDER=resend \
cargo run --release
```

To run it the way CI does — no mail, small limits, and `/__test__/outbox` served so the conformance
suite can read a verification token:

```bash
MIXLAB_SYNC_TEST_OUTBOX=1 cargo run
```

## Pulling it instead of building it

```bash
docker pull ghcr.io/mixnz/mixlab-sync-server:latest
```

```yaml
services:
  sync:
    image: ghcr.io/mixnz/mixlab-sync-server:latest
    restart: unless-stopped
    ports: ["8765:8765"]
    volumes: ["mixlab-sync:/data"]
    environment:
      MIXLAB_SYNC_PEPPER: "…"              # 32 random bytes, base64
      MIXLAB_SYNC_EMAIL_API_KEY: "…"
      MIXLAB_SYNC_EMAIL_FROM: "noreply@example.com"
volumes:
  mixlab-sync:
```

The image follows `master` and carries two tags: `latest`, and `sha-<short>` for anyone who wants a
fixed target to pin. **It is deliberately not attached to a release tag** — giving the server a
versioned-artifact lifecycle is the one thing
[ADR 0046](../../docs/decisions/0046-the-sync-server-lives-beside-the-client-it-serves.md) names as
a reason to split it back into a repository of its own, and following `master` is also what keeps a
self-hosted instance and the default one on the same generation of `/v1`.

**Nothing in the hosted path is a container.** The default instance is the Worker, built by
Cloudflare from `../worker/`. This image exists for the row of D8's table that is run on a machine
of somebody's choosing, and nowhere else.

**The port is the machine's business, not this program's.** 8765 is a default, not a reservation:
if something already holds it, the server says so and stops rather than half-starting. Set
`MIXLAB_SYNC_BIND` to whatever is free.

Put a reverse proxy with TLS in front of it. **There is no public-URL setting to get wrong**: the
letters carry a code the person types into MixLab, not a link (D4a), so this server never has to
know the address it is reachable at.

## Configuration

| Name | What it is |
| --- | --- |
| `MIXLAB_SYNC_BIND` | Address to listen on. `127.0.0.1:8765` by default — **not 8080**, which MixEngine's own front end binds on a machine running MixLab |
| `MIXLAB_SYNC_DATABASE` | The SQLite file. `mixlab-sync.db` by default |
| `MIXLAB_SYNC_PEPPER` | Keyed into the stored password verifier, so a stolen database is not a list of verifiers |
| `MIXLAB_SYNC_EMAIL_API_KEY` | The email provider's key |
| `MIXLAB_SYNC_EMAIL_FROM` | The address the two letters are sent from |
| `MIXLAB_SYNC_EMAIL_ENDPOINT` | The provider's HTTP endpoint |
| `MIXLAB_SYNC_EMAIL_PROVIDER` | `resend` or `mailtrap`. They differ in body shape and in the header that carries the key, which is why this is a name and not just a URL |
| `MIXLAB_SYNC_MAX_RECORD_BYTES` | Reported by `/v1/capabilities` |
| `MIXLAB_SYNC_MAX_BATCH_OPERATIONS` | Reported by `/v1/capabilities` |
| `MIXLAB_SYNC_MAX_PAGE_RECORDS` | Reported by `/v1/capabilities` |
| `MIXLAB_SYNC_ACCOUNT_QUOTA_BYTES` | Reported by `/v1/capabilities` |
| `MIXLAB_SYNC_TOMBSTONE_RETENTION_DAYS` | Reported by `/v1/capabilities` |
| `MIXLAB_SYNC_REGISTRATIONS_PER_HOUR` | How many accounts one source may open in an hour |
| `MIXLAB_SYNC_RESETS_PER_HOUR` | How often one source may ask for a reset letter |
| `MIXLAB_SYNC_LOGINS_PER_WINDOW` | Attempts on one account in fifteen minutes, right or wrong |
| `MIXLAB_SYNC_VERIFY_ATTEMPTS_PER_WINDOW` | Codes tried against one account in fifteen minutes |
| `MIXLAB_SYNC_RELOCATE_TO` | Which endpoint a retired account is sent to (D4b). A **symbolic id**, never a URL. Unset means this server will not let go of an account |
| `MIXLAB_SYNC_RELOCATION_LEASE_SECONDS` | How long a freeze lasts before it lapses. 900 by default |
| `MIXLAB_SYNC_TEST_OUTBOX` | `1` serves `/__test__/outbox` and sends no mail. **Never on a real deployment** |

The four rate limits are not reported by `/v1/capabilities`, unlike every other number here:
publishing the figure that stops abuse helps only the abuser. The verification one is the only
allowance `../conformance/` deliberately exhausts — eight characters typed by a person are safe
only because guessing is bounded, so that bound is part of the protocol.

## How it differs from the Worker, and where it does not

**Where it does not**: the protocol. Both answer the same suite, and a client cannot tell them
apart — which is the point.

**Where it does**: a Durable Object serializes execution, so the Worker gets the registration race,
the monotonic `seq` and the per-record compare-and-swap for free. Here they are transactions, and
each one carries a comment saying which guarantee it is standing in for. Reaping is a task inside
the process rather than an alarm per account. Neither difference is visible through `/v1`, and that
is the claim the conformance suite exists to check.

## A workspace of its own

Excluded from the repository's root `Cargo.toml`, the way `apps/desktop/src-tauri` is and for the
reason that manifest gives there: an HTTP server's dependency tree would defeat `deny.toml`'s
duplicate-version ban and the elevated helper's dependency budget in one move. `cargo` at the root
never sees this crate; `cargo audit` runs against it on its own in `.github/workflows/server.yml`.
