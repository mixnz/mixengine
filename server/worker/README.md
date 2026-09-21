# The Worker

MixLab's sync server on Cloudflare Workers, with one Durable Object per account. This is the
default instance, the one MixLab uses unless you change the setting. It is also what you deploy if
you want to host the server on your own Cloudflare account.

It speaks `/v1` as defined in D2 to D4a of
[the sync design](../../docs/specs/2026-09-20-t177-a-copy-only-you-can-read-design.md). The design is
the reference. This is one of two implementations of it, and `../conformance/` tests against the
design rather than against either server.

The Worker can't read what it stores. Every value is encrypted on the machine that sent it, and
nothing here decrypts, parses or inspects a ciphertext. D1 of the design lists everything the
server does see.

## Running it locally

```bash
npm ci
npm run dev
```

`npm run dev` starts the normal configuration, which won't serve anything until it has a pepper and
an email provider. Put them in a `.dev.vars` file next to `wrangler.toml`, one `NAME=value` per
line. To run it the way CI does, with no email and small limits:

```bash
npx wrangler dev --env conformance
```

A running `wrangler dev` doesn't pick up a new Durable Object binding. It reloads source changes, so
adding a handler is fine, but after adding a class or a migration you have to stop it and start it
again. If you forget, requests hang instead of failing, which is hard to diagnose. CI always starts
fresh, so it never hits this.

## Deploying it to your own Cloudflare account

1. Fork this repository.
2. In the Cloudflare dashboard, create a Worker from your fork and set the root directory to
   **`server/worker/`**. The build needs nothing outside that folder.
3. Under the Worker's **Settings → Variables and Secrets**, set:
   - `PEPPER` and `EMAIL_API_KEY` as type **Secret** (use 32 random bytes in base64 for the pepper);
   - `EMAIL_FROM` (an address your provider can send from) and `EMAIL_PROVIDER` as type
     **Variable**, plus `EMAIL_ENDPOINT` if you use `mailgun`.

   Anything in [Configuration](#configuration) that `wrangler.toml` doesn't list can be set the same
   way. If a required value is missing, the Worker refuses every request and names what is missing.
   You can also set a secret with `wrangler secret put PEPPER` instead of using the dashboard.

   Don't use **Settings → Build** for these. Those variables are only visible to the build command,
   and the running Worker never sees them.
4. Point MixLab at it. The server is a setting in MixLab, and changing it signs you out, because
   records written under one account's master key can't be read under another's.

The capability numbers in `wrangler.toml`'s `[vars]` are changed in that file, not on the dashboard.
The file sets `keep_vars = true`, so a deploy, including the one a push to your fork starts, leaves
the variables you set on the dashboard alone. But any value written in the file overrides the
dashboard on every deploy.

Durable Objects are available on the free plan with the SQLite storage backend, which is what
`new_sqlite_classes` in the migration selects.

As of Cloudflare's pricing page on 2026-09-20, the free plan allows 100,000 requests a day and
13,000 GB-s of duration a day. At 128 MB, that is about 104,000 seconds of object time, so you run
out of duration before you run out of requests. An object also stays in memory for a short while
after its last request, so the cost depends on how often clients wake an object, not on how much
data moves. We didn't check the storage allowance, so we can't say how many accounts fit. A light
account is around 150 KB and a heavy one a megabyte or two. `ACCOUNT_QUOTA_BYTES` caps the worst
case; it says nothing about the average.

These numbers belong to Cloudflare and will change. The design's D8 sets out four rules that keep a
deployment within them, and three of those rules are about how MixLab behaves, not about this
server.

## Configuration

| Name | Kind | Default | What it is |
| --- | --- | --- | --- |
| `PEPPER` | secret | **required** | Mixed into each stored password verifier, so a stolen database is not a list of verifiers. **Changing it locks out every existing account** |
| `EMAIL_API_KEY` | secret | **required** | Your email provider's key. The provider is your choice, and `src/email.ts` keeps it behind one interface so it's easy to switch |
| `EMAIL_FROM` | var | **required** | The address verification and reset emails come from |
| `EMAIL_FROM_NAME` | var | `MixLab` | The sender name shown next to that address. Without it, inboxes show the part before the `@`, such as `no-reply` |
| `EMAIL_PROVIDER` | var | **required** | `brevo`, `mailgun`, `mailtrap`, `postmark`, `resend` or `sendgrid`. There is no default, because a key alone doesn't say which provider it belongs to. The providers differ in body shape, in the header that carries the key and in how they name the sender, so this has to be a name and not just a URL. **`smtp` is refused**: Workers can't open a socket to port 587. Use `server/native/` for SMTP |
| `EMAIL_ENDPOINT` | var | the provider's own | Where to send the request. **Required for `mailgun`**: `https://api.mailgun.net/v3/<domain>/messages`, or `api.eu.mailgun.net` in the EU, since the domain and region can't be guessed. `mailtrap` defaults to its transactional stream, `https://send.api.mailtrap.io/api/send`; set this only to test against a sandbox (`https://sandbox.api.mailtrap.io/api/send/<sandbox id>`) |
| `MAX_RECORD_BYTES` | var | `1048576` | Reported by `/v1/capabilities` |
| `MAX_BATCH_OPERATIONS` | var | `100` | Reported by `/v1/capabilities` |
| `MAX_BATCH_BYTES` | var | `8388608` | Reported by `/v1/capabilities`, and the largest body this server will read |
| `MAX_PAGE_RECORDS` | var | `500` | Reported by `/v1/capabilities` |
| `ACCOUNT_QUOTA_BYTES` | var | `20971520` | Reported by `/v1/capabilities` |
| `TOMBSTONE_RETENTION_DAYS` | var | `90` | Reported by `/v1/capabilities` |
| `REGISTRATIONS_PER_HOUR` | var | `10` | How many accounts one source can create in an hour |
| `RESETS_PER_HOUR` | var | `10` | How often one source can request a reset email |
| `LOGINS_PER_WINDOW` | var | `20` | Sign-in attempts on one account in fifteen minutes, right or wrong |
| `VERIFY_ATTEMPTS_PER_WINDOW` | var | `10` | Codes tried against one account in fifteen minutes |
| `PARAMS_PER_HOUR` | var | `200` | How often one source can look up an address's salt. Set high on purpose: a company behind one IP address might set up fifty machines in a morning |
| `AUTH_PER_HOUR` | var | `300` | How often one source can try to sign in or use a code, across all accounts. The per-account limits can't see someone working through a list of addresses |
| `LETTERS_PER_ACCOUNT_PER_HOUR` | var | `3` | How many emails **one address** can receive. The limits above cap what one network sends, not what one mailbox receives |
| `RESET_TICKET_SECONDS` | var | `600` | How long the ticket from a recovery-key reset stays valid (D6). It's a lifetime, not a rate, so it isn't counted among the rate limits below |
| `CLOSING_ON` | var | none | The date this server will be shut down, such as `2027-03-01`. Reported by `/v1/capabilities` so people have time to move their account elsewhere (D4b). **Advisory only**: requests aren't refused after that date |
| `ACCESS_TOKEN` | secret | none (open) | A shared token that closes this deployment to anyone who doesn't have it, for example when you run it for your own company. **The hosted instances never set one** |
| `TEST_OUTBOX` | var | off | `"1"` serves `/__test__/outbox` and sends no email. **Never set this on a real deployment** |

**Required** means that without the value, every request gets a `503` listing what is missing. That
way a misconfigured deploy fails right away, instead of seeming fine until the first email doesn't
arrive. A Worker has no startup step where it could refuse to run, so the check happens on each
request. `server/native/` refuses to start instead.

Unlike every other number here, the seven rate limits are **not** reported by `/v1/capabilities`:
publishing the number that stops abuse only helps the abuser. The first two are counted per source,
not per account, because the abuse they prevent is creating many accounts, which a counter inside a
single account can't see. `src/ratelimit.ts` explains this in more detail.

**A source here means `CF-Connecting-IP`.** Cloudflare sets this header, and every request to the
Worker passes through Cloudflare. `server/native/` has to work harder for the same thing, because a
self-hosted server may be reachable directly.

**The email limit is counted in the source-limit namespace, not in the account object.**
Registering again over an unverified account replaces that object, and registering again is one of
the two ways to request an email. If the count lived in the account, the person being limited could
reset it.

Every limit is reported to the client rather than assumed, so changing a limit never needs a new
release: a server raises the number in its configuration and clients read it (D4a, D9).

**Workers can't speak SMTP**, so you need an email provider with an HTTP API. Two pieces of outdated
advice still circulate: Cloudflare Email Routing only receives mail and can't send it, and
MailChannels' free sending for Workers ended in 2024.
