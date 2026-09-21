# The native server

MixLab's sync server as a single binary with a SQLite file, for a machine you run yourself.

This is the second implementation, and that is why it exists. The default instance is the Worker
in `../worker/`. This server speaks the same `/v1` on different machinery, which is the only way to
show that `/v1` is a real protocol and not a description of one codebase. `../conformance/` tests
against the design both servers follow, D2 to D4a of
[the sync design](../../docs/specs/2026-09-20-t177-a-copy-only-you-can-read-design.md), and not
against either of them.

The server can't read what it stores. Every value is encrypted on the machine that sent it. D1 of
the design lists everything a server does see.

## Running it

```bash
cargo run
```

It won't start without a pepper and an email provider. When something is missing, it lists
everything missing at once, so you don't have to fix one value, restart and find the next.

```bash
MIXLAB_SYNC_PEPPER=$(head -c 32 /dev/urandom | base64) \
MIXLAB_SYNC_EMAIL_PROVIDER=one-of-the-seven-below \
MIXLAB_SYNC_EMAIL_API_KEY=… \
MIXLAB_SYNC_EMAIL_FROM=noreply@example.com \
cargo run --release
```

To run it the way CI does, with no email, small limits, and `/__test__/outbox` served so the
conformance suite can read verification codes:

```bash
MIXLAB_SYNC_TEST_OUTBOX=1 cargo run
```

## Using the container image

```bash
docker pull ghcr.io/mixnz/mixlab-sync-server:latest
```

**Generate the pepper once, and never again.** It is mixed into every stored password verifier and
into the salt the server returns for addresses that have no account. If a redeploy generates a new
one, everyone who already had an account is locked out for good: each of them has to reset their
password, and their records are lost, since the server could never read them in the first place.
Back the pepper up the way you back up the database, somewhere that survives losing the machine.

```bash
umask 077
cat > .env <<EOF
MIXLAB_SYNC_PEPPER=$(head -c 32 /dev/urandom | base64)
MIXLAB_SYNC_EMAIL_FROM=noreply@example.com
# One of: smtp, brevo, mailgun, mailtrap, postmark, resend, sendgrid. There is no default.
MIXLAB_SYNC_EMAIL_PROVIDER=
# Every provider except smtp.
MIXLAB_SYNC_EMAIL_API_KEY=
# mailgun only. Its URL contains your sending domain and region, so it can't be guessed:
# https://api.mailgun.net/v3/<domain>/messages, or api.eu.mailgun.net in the EU. Also for mailtrap
# when testing against a sandbox: https://sandbox.api.mailtrap.io/api/send/<sandbox id>.
# MIXLAB_SYNC_EMAIL_ENDPOINT=
# smtp only, instead of the API key above. Username and password are optional: a mail server on
# your own network often needs neither.
# MIXLAB_SYNC_SMTP_HOST=smtp.example.com
# MIXLAB_SYNC_SMTP_USERNAME=
# MIXLAB_SYNC_SMTP_PASSWORD=
# Set this to close the server to anyone who doesn't have the token. See below.
# MIXLAB_SYNC_ACCESS_TOKEN=
# Set this once you know when you'll shut the server down, so people see it in MixLab
# ahead of time instead of on the day.
# MIXLAB_SYNC_CLOSING_ON=2027-03-01
EOF
```

Where `/dev/urandom` is awkward, `openssl rand -base64 32` works too. Any 32 truly random bytes will
do, and nobody ever types it: it's an HMAC key, not a password. `umask 077` is there because after
the database, this file is the most valuable thing on the machine.

```yaml
services:
  sync:
    image: ghcr.io/mixnz/mixlab-sync-server:latest
    restart: unless-stopped
    ports: ["8765:8765"]
    volumes: ["mixlab-sync:/data"]
    # Everything the server needs to start is in this file. The image already listens on
    # 0.0.0.0:8765 and keeps the database inside the volume.
    env_file: [".env"]
volumes:
  mixlab-sync:
```

```bash
docker compose up -d && docker compose logs sync
```

If the container exits right away, the log says why. It lists everything missing in one line,
`mixlab-sync will not start without: …`, and exits with code 78, so one look at the log is enough
to finish the file.

The image tracks `master` and has two tags: `latest`, and `sha-<short>` if you want to pin a fixed
version. It is deliberately not tied to release tags.
[ADR 0046](../../docs/decisions/0046-the-sync-server-lives-beside-the-client-it-serves.md) names a
versioned release cycle for the server as the one reason to move it into its own repository.
Tracking `master` also keeps self-hosted servers on the same version of `/v1` as the default one.

The hosted server doesn't use this image. The default instance is the Worker, which Cloudflare builds
from `../worker/`. The image is only for the self-hosted row of D8's table.

The port is up to you. 8765 is a default, not a requirement. If something else already uses it, the
server says so and stops instead of half-starting. Set `MIXLAB_SYNC_BIND` to a free address.

Put a reverse proxy with TLS in front of it. There is no public URL setting: the emails contain a
code the person types into MixLab, not a link (D4a), so the server never needs to know its own
address.

## Configuration

| Name | Default | What it is |
| --- | --- | --- |
| `MIXLAB_SYNC_BIND` | `127.0.0.1:8765` | The address to listen on. **Not 8080**, because MixEngine's own front end uses it on a machine running MixLab. The image changes this to `0.0.0.0:8765`, since inside a container the loopback address only reaches the container |
| `MIXLAB_SYNC_DATABASE` | `mixlab-sync.db` | The SQLite file. The image changes this to `/data/mixlab-sync.db`, inside the volume |
| `MIXLAB_SYNC_PEPPER` | **required** | Mixed into each stored password verifier, so a stolen database is not a list of verifiers. **Changing it locks out every existing account** |
| `MIXLAB_SYNC_EMAIL_FROM` | **required** | The address verification and reset emails come from |
| `MIXLAB_SYNC_EMAIL_FROM_NAME` | `MixLab` | The sender name shown next to that address. Without it, inboxes show the part before the `@`, such as `no-reply` |
| `MIXLAB_SYNC_EMAIL_PROVIDER` | **required** | `smtp`, `brevo`, `mailgun`, `mailtrap`, `postmark`, `resend` or `sendgrid` (see below). There is no default, because a key alone doesn't say which provider it belongs to |
| `MIXLAB_SYNC_EMAIL_API_KEY` | **required**, except for `smtp` | The provider's key |
| `MIXLAB_SYNC_EMAIL_ENDPOINT` | the provider's own | Where to send the request. **Required for `mailgun`**, whose URL contains the sending domain and region, which can't be guessed. `mailtrap` defaults to its transactional stream, `https://send.api.mailtrap.io/api/send`; set this only to test against a sandbox (`https://sandbox.api.mailtrap.io/api/send/<sandbox id>`) |
| `MIXLAB_SYNC_SMTP_HOST` | **required** for `smtp` | The mail server |
| `MIXLAB_SYNC_SMTP_PORT` | `587`, `465` or `25` | Follows the TLS mode |
| `MIXLAB_SYNC_SMTP_TLS` | `starttls` | Or `implicit`, or `none`. **Use `none` only for a mail server on the same machine or private network** |
| `MIXLAB_SYNC_SMTP_USERNAME` | none | Optional: many mail servers on a private network need no login |
| `MIXLAB_SYNC_SMTP_PASSWORD` | none | Optional, used with the username |
| `MIXLAB_SYNC_MAX_RECORD_BYTES` | `1048576` | Reported by `/v1/capabilities` |
| `MIXLAB_SYNC_MAX_BATCH_OPERATIONS` | `100` | Reported by `/v1/capabilities` |
| `MIXLAB_SYNC_MAX_BATCH_BYTES` | `8388608` | Reported by `/v1/capabilities`, and the largest body this server will read |
| `MIXLAB_SYNC_MAX_PAGE_RECORDS` | `500` | Reported by `/v1/capabilities` |
| `MIXLAB_SYNC_ACCOUNT_QUOTA_BYTES` | `20971520` | Reported by `/v1/capabilities` |
| `MIXLAB_SYNC_TOMBSTONE_RETENTION_DAYS` | `90` | Reported by `/v1/capabilities` |
| `MIXLAB_SYNC_REGISTRATIONS_PER_HOUR` | `10` | How many accounts one source can create in an hour |
| `MIXLAB_SYNC_RESETS_PER_HOUR` | `10` | How often one source can request a reset email |
| `MIXLAB_SYNC_LOGINS_PER_WINDOW` | `20` | Sign-in attempts on one account in fifteen minutes, right or wrong |
| `MIXLAB_SYNC_VERIFY_ATTEMPTS_PER_WINDOW` | `10` | Codes tried against one account in fifteen minutes |
| `MIXLAB_SYNC_PARAMS_PER_HOUR` | `200` | How often one source can look up an address's salt |
| `MIXLAB_SYNC_AUTH_PER_HOUR` | `300` | How often one source can try to sign in or use a code, across all accounts. The per-account limits can't see someone working through a list of addresses |
| `MIXLAB_SYNC_LETTERS_PER_ACCOUNT_PER_HOUR` | `3` | How many emails **one address** can receive. The limits above cap what one network sends, not what one mailbox receives |
| `MIXLAB_SYNC_RESET_TICKET_SECONDS` | `600` | How long the ticket from a recovery-key reset stays valid (D6): long enough to type a new password twice, short enough that one left in a log has expired by the time anyone reads it |
| `MIXLAB_SYNC_TRUST_FORWARDED_FOR` | off | `1` takes the source address from `X-Forwarded-For`. **Turn this on only when a proxy you run sits in front of the server**, and read the section below |
| `MIXLAB_SYNC_CLOSING_ON` | none | The date this server will be shut down, such as `2027-03-01`. Reported by `/v1/capabilities` so people have time to move their account. **Advisory only**: requests aren't refused after that date |
| `MIXLAB_SYNC_ACCESS_TOKEN` | none (open) | A shared token that closes this server to anyone who doesn't have it. The hosted instances are open |
| `MIXLAB_SYNC_TEST_OUTBOX` | off | `1` serves `/__test__/outbox` and sends no email. **Never set this on a real deployment** |

**Required** means that without the value, the server prints what is missing and exits with code
78 instead of starting, listing everything at once. Everything else has a sensible default, so a
normal deployment sets the four required values and leaves the rest alone.

Unlike every other number here, the seven rate limits are not reported by `/v1/capabilities`:
publishing the number that stops abuse only helps the abuser. The verification limit is the only
one `../conformance/` deliberately uses up. An eight-character code typed by a person is only safe
because guessing is limited, so that limit is part of the protocol.

### How the server identifies a caller

Every per-source limit needs an address to count against, and **this server takes it from the
connection, not from the request**. Any caller can write an `X-Forwarded-For` header. If a server
that is reachable directly trusted it, anyone could get a fresh allowance on every request, which
means no limit at all.

We tested this with six registrations, each with a different forged header, against a server that
allows two per hour:

| | Accepted | Refused |
| --- | --- | --- |
| Default | 2 | 4 |
| `MIXLAB_SYNC_TRUST_FORWARDED_FOR=1` | 6 | 0 |

That second row is why the setting exists and why it's off by default. Behind a proxy, the header
is the only way to tell callers apart. Without a proxy, trusting it makes every caller look new.
Turn it on only when a proxy you control is the only way to reach the server, and if you can, have
the proxy replace the header instead of appending to it. The server reads the **last** entry, which
is the address the nearest proxy saw and the one part of the header a client can't choose.

When the setting is off and the connection has no peer address, every caller shares one limit.
That's the safe answer when the server can't tell callers apart, and it still limits them.

## Sending email

There are seven providers, and which one you use is up to you; the protocol doesn't care. They all
sit behind a single function in `src/email.rs`. Free email tiers change often, and keeping every
provider in one file means switching is a one-file change.

| Provider | How the key is sent | What the body looks like |
| --- | --- | --- |
| `smtp` | Optional username and password | A standard email over an SMTP connection |
| `resend` | `Authorization: Bearer` | `from` and `to` are plain strings |
| `mailtrap` | `Api-Token` | `from` and `to` are objects. Uses the transactional stream by default; a sandbox is an endpoint with its ID |
| `brevo` | `api-key` | `sender`, and the body is `textContent` |
| `postmark` | `X-Postmark-Server-Token` | `From`, `To`, `Subject`, `TextBody` |
| `sendgrid` | `Authorization: Bearer` | Recipients under `personalizations`, body as typed parts |
| `mailgun` | HTTP basic auth, user `api` | **Form-encoded, not JSON.** The endpoint is required because it contains the sending domain and region |

**Only this server supports `smtp`; the Worker in `../worker/` doesn't**, because Workers can't open
a socket to port 587. It's also the option most people self-hosting already have.

```bash
MIXLAB_SYNC_EMAIL_PROVIDER=smtp \
MIXLAB_SYNC_SMTP_HOST=smtp.example.com \
MIXLAB_SYNC_SMTP_USERNAME=… \
MIXLAB_SYNC_SMTP_PASSWORD=… \
MIXLAB_SYNC_EMAIL_FROM=noreply@example.com \
MIXLAB_SYNC_PEPPER=… \
cargo run --release
```

## Limiting access to your own people

```bash
MIXLAB_SYNC_ACCESS_TOKEN=whatever-your-company-knows
```

With this set, every route requires an `X-MixLab-Access` header containing that string,
**including `/v1/capabilities`**. Someone who finds the address can't use the server at all. If
the capabilities endpoint answered everyone, it would tell them a server is there and worth coming
back to. MixLab asks for the token when someone sets up a self-hosted server in the app.

You can change the token at any time. Every client is then locked out until it gets the new one,
which is the point. **The token protects the server, not the accounts.** Nothing else about the
design changes, and someone with the token still can't read a record.

A wrong token gets a `401` with the code `invalid-access-token`. It has its own code, separate from
the one for an expired session, because the user needs to hear "ask your administrator" rather than
"sign in again". Wrong tokens are counted per source, since you pick the string and might pick a
short one.

## How it differs from the Worker

The protocol is identical. Both servers pass the same suite, and a client can't tell them apart.

The internals differ. A Durable Object runs one request at a time, so the Worker gets the
registration race, the increasing `seq` and the per-record compare-and-swap for free. Here they are
database transactions, each with a comment naming the guarantee it provides. Reaping runs as a task
inside the process instead of an alarm per account. None of this is visible through `/v1`, and the
conformance suite is there to confirm that.

## A separate Cargo workspace

This crate is excluded from the repository's root `Cargo.toml`, like `apps/desktop/src-tauri`, and
for the reason given in that manifest: an HTTP server's dependency tree would break both
`deny.toml`'s duplicate-version ban and the elevated helper's dependency budget. `cargo` at the root
never sees this crate. `.github/workflows/server.yml` runs `cargo audit` on it separately.
