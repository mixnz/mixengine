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
MIXLAB_SYNC_EMAIL_PROVIDER=one-of-the-seven-below \
MIXLAB_SYNC_EMAIL_API_KEY=… \
MIXLAB_SYNC_EMAIL_FROM=noreply@example.com \
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

**Make the pepper first, once, and then never again.** It is keyed into every stored password
verifier and into the salt this server answers with for an address that has no account, so a
deployment that generates a fresh one on its next redeploy has locked out everybody who already had
an account — permanently, with a reset letter each and their records gone, because the records were
never readable by this server to begin with. Treat it the way you treat the database: back it up,
somewhere that losing the machine does not lose it.

```bash
umask 077
cat > .env <<EOF
MIXLAB_SYNC_PEPPER=$(head -c 32 /dev/urandom | base64)
MIXLAB_SYNC_EMAIL_FROM=noreply@example.com
# One of: smtp, brevo, mailgun, mailtrap, postmark, resend, sendgrid. There is no default.
MIXLAB_SYNC_EMAIL_PROVIDER=
# Every provider except smtp.
MIXLAB_SYNC_EMAIL_API_KEY=
# mailtrap and mailgun only: their URL carries an inbox id or a sending domain, so nothing can
# guess it for you. Leave it out for the other five.
# MIXLAB_SYNC_EMAIL_ENDPOINT=
# smtp only, in place of the API key above. Username and password are optional — a mail server on
# your own network often wants neither.
# MIXLAB_SYNC_SMTP_HOST=smtp.example.com
# MIXLAB_SYNC_SMTP_USERNAME=
# MIXLAB_SYNC_SMTP_PASSWORD=
# Set this to close the server to everybody who has not been told the string. See below.
# MIXLAB_SYNC_ACCESS_TOKEN=
# Set this when you know the date you will switch this server off, so the people using it are
# told in the application instead of on the day.
# MIXLAB_SYNC_CLOSING_ON=2027-03-01
EOF
```

`openssl rand -base64 32` does the same job where reaching `/dev/urandom` is awkward. Any 32 bytes
of real randomness will do, and nobody ever types it: it is an HMAC key, not a password. `umask 077`
is there because that file is now the most valuable thing on the machine after the database itself.

```yaml
services:
  sync:
    image: ghcr.io/mixnz/mixlab-sync-server:latest
    restart: unless-stopped
    ports: ["8765:8765"]
    volumes: ["mixlab-sync:/data"]
    # Everything the server refuses to start without is in that file, and nothing else has to be:
    # the image already binds 0.0.0.0:8765 and puts the database inside the volume.
    env_file: [".env"]
volumes:
  mixlab-sync:
```

```bash
docker compose up -d && docker compose logs sync
```

A container that exits immediately has already said why. **It names everything it is missing at
once rather than the first thing** — `mixlab-sync will not start without: …`, exit code 78 — so one
reading of the log is enough to finish the file.

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
| `MIXLAB_SYNC_EMAIL_FROM` | The address the two letters are sent from |
| `MIXLAB_SYNC_EMAIL_PROVIDER` | `smtp`, `brevo`, `mailgun`, `mailtrap`, `postmark`, `resend` or `sendgrid` — see below. **No default**: a key on its own does not say where to send it |
| `MIXLAB_SYNC_EMAIL_API_KEY` | The provider's key. Not used by `smtp` |
| `MIXLAB_SYNC_EMAIL_ENDPOINT` | Where to post. Has a default for every provider except `mailtrap` (its URL carries an inbox id) and `mailgun` (a sending domain) |
| `MIXLAB_SYNC_SMTP_HOST` | The mail server, when the provider is `smtp` |
| `MIXLAB_SYNC_SMTP_PORT` | Defaults to the port the TLS mode implies: 587, 465 or 25 |
| `MIXLAB_SYNC_SMTP_TLS` | `starttls` (the default), `implicit`, or `none` — **`none` is for a mail server on this machine or this private network, and nowhere else** |
| `MIXLAB_SYNC_SMTP_USERNAME` | Optional: many mail servers on a private network want no login |
| `MIXLAB_SYNC_SMTP_PASSWORD` | Optional, with the username |
| `MIXLAB_SYNC_MAX_RECORD_BYTES` | Reported by `/v1/capabilities` |
| `MIXLAB_SYNC_MAX_BATCH_OPERATIONS` | Reported by `/v1/capabilities` |
| `MIXLAB_SYNC_MAX_BATCH_BYTES` | Reported by `/v1/capabilities`, and the largest body this server will read |
| `MIXLAB_SYNC_MAX_PAGE_RECORDS` | Reported by `/v1/capabilities` |
| `MIXLAB_SYNC_ACCOUNT_QUOTA_BYTES` | Reported by `/v1/capabilities` |
| `MIXLAB_SYNC_TOMBSTONE_RETENTION_DAYS` | Reported by `/v1/capabilities` |
| `MIXLAB_SYNC_REGISTRATIONS_PER_HOUR` | How many accounts one source may open in an hour |
| `MIXLAB_SYNC_RESETS_PER_HOUR` | How often one source may ask for a reset letter |
| `MIXLAB_SYNC_LOGINS_PER_WINDOW` | Attempts on one account in fifteen minutes, right or wrong |
| `MIXLAB_SYNC_VERIFY_ATTEMPTS_PER_WINDOW` | Codes tried against one account in fifteen minutes |
| `MIXLAB_SYNC_PARAMS_PER_HOUR` | How often one source may ask where an address's salt is |
| `MIXLAB_SYNC_CLOSING_ON` | A date this server will be switched off, such as `2027-03-01`. Reported by `/v1/capabilities` so a person has warning enough to move their account. **Advisory**: nothing here refuses a request after it |
| `MIXLAB_SYNC_ACCESS_TOKEN` | A shared token that closes this server to everybody who has not been given it. Unset means open, which is what the hosted instances are |
| `MIXLAB_SYNC_TEST_OUTBOX` | `1` serves `/__test__/outbox` and sends no mail. **Never on a real deployment** |

The five rate limits are not reported by `/v1/capabilities`, unlike every other number here:
publishing the figure that stops abuse helps only the abuser. The verification one is the only
allowance `../conformance/` deliberately exhausts — eight characters typed by a person are safe
only because guessing is bounded, so that bound is part of the protocol.

## Sending mail

Seven providers, and **which one is a deployment decision rather than a protocol one**. They sit
behind a single function in `src/email.rs`, which is the part that matters: every free tier in this
market will be renegotiated within a few years, and what protects a deployment is that changing
provider is one file.

| Provider | How the key travels | What the body looks like |
| --- | --- | --- |
| `smtp` | Optional username and password | A real message over a real socket |
| `resend` | `Authorization: Bearer` | `from` and `to` are plain strings |
| `mailtrap` | `Api-Token` | `from` and `to` are objects. **Endpoint required** — it carries an inbox id |
| `brevo` | `api-key` | `sender`, and the body is `textContent` |
| `postmark` | `X-Postmark-Server-Token` | `From`, `To`, `Subject`, `TextBody` |
| `sendgrid` | `Authorization: Bearer` | Recipients under `personalizations`, body as typed parts |
| `mailgun` | HTTP basic auth, user `api` | **Form-encoded, not JSON.** Endpoint required — it carries the sending domain |

**`smtp` is here and not in `../worker/`**, and it is the one capability the two implementations do
not share: Workers cannot open a socket to port 587. It is also the provider most people
self-hosting already have.

```bash
MIXLAB_SYNC_EMAIL_PROVIDER=smtp \
MIXLAB_SYNC_SMTP_HOST=smtp.example.com \
MIXLAB_SYNC_SMTP_USERNAME=… \
MIXLAB_SYNC_SMTP_PASSWORD=… \
MIXLAB_SYNC_EMAIL_FROM=noreply@example.com \
MIXLAB_SYNC_PEPPER=… \
cargo run --release
```

## Closing it to everybody but your own people

```bash
MIXLAB_SYNC_ACCESS_TOKEN=whatever-your-company-knows
```

Every route then requires `X-MixLab-Access` carrying that string, **`/v1/capabilities` included** —
the point is that somebody who finds the address cannot use the host at all, and a capabilities
document that answered anybody would tell them the server is there and that it is worth coming
back to. MixLab asks for the token when somebody sets up a self-hosted server in the application.

Change it whenever you like; every client is locked out until it is told the new one, which is the
behaviour this is for. **It protects the host, not the accounts**: everything else about this
design is unchanged, and somebody holding the token still cannot read a record.

A wrong one answers `401` with the code `invalid-access-token` — its own code, not the one that
means a session ended, because *ask your administrator* and *sign in again* are different
sentences. Wrong ones are counted per source, because the string is yours to choose and you may
choose a short one.

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
