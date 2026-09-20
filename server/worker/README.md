# The Worker

MixLab's sync server on Cloudflare Workers, with **one Durable Object per account**. This is the
default instance — the one MixLab points at when nobody has changed the setting — and it is also
what somebody self-hosting on their own Cloudflare account deploys.

It speaks **`/v1`**, frozen at D2–D4a of
[the sync design](../../docs/specs/2026-09-20-t177-a-copy-only-you-can-read-design.md). The design
is normative; this is one of two implementations of it, and `../conformance/` is written against
the document rather than against either.

**It cannot read what it holds.** Every value arrives sealed under a key derived on the machine
that sent it, and nothing here decrypts, parses or inspects a ciphertext. What it necessarily sees
is listed in full in D1 of the design.

## Running it locally

```bash
npm ci
npm run dev
```

`npm run dev` starts the ordinary configuration, which refuses to serve until it has a pepper and
an email provider — see below. To run it the way CI does, with no mail and small limits:

```bash
npx wrangler dev --env conformance
```

**A running `wrangler dev` does not pick up a new Durable Object binding.** It reloads source
happily, so adding a handler is free, but adding a class or a migration needs the process stopped
and started again — and the symptom of not doing it is a request that hangs rather than one that
fails, which costs more to diagnose than it should. CI never meets this: it starts fresh.

## Deploying it to your own Cloudflare account

1. Fork this repository.
2. In the Cloudflare dashboard, create a Worker from that fork with **`server/worker/` as the root
   directory**. Nothing outside that directory is any of the build's business.
3. Set the two secrets. They are never in `wrangler.toml`, and a deployment without them refuses
   every request and names what is missing:

   ```bash
   wrangler secret put PEPPER          # 32 random bytes, base64; keyed into the stored verifier
   wrangler secret put EMAIL_API_KEY   # your provider's key
   ```

4. Change `EMAIL_FROM` in `wrangler.toml` to an address your provider will send from.
5. Point MixLab at it: the server is a setting, and changing it signs the person out — records
   written under one account's master key are not readable under another's.

**Durable Objects are on the free plan with the SQLite storage backend**, which is what
`new_sqlite_classes` in the migration selects. Everything here is sized for that: see the design's
D8 for what the free tier holds and the four rules that keep a deployment inside it.

## Configuration

| Name | Kind | Default | What it is |
| --- | --- | --- | --- |
| `PEPPER` | secret | **required** | Keyed into the stored password verifier, so a stolen database is not a list of verifiers. **Changing it locks out every existing account** |
| `EMAIL_API_KEY` | secret | **required** | The email provider's key. **Which provider is a deployment decision**, and it sits behind one interface in `src/email/` for exactly that reason |
| `EMAIL_FROM` | var | **required** | The address the two letters are sent from |
| `EMAIL_PROVIDER` | var | **required** | `brevo`, `mailgun`, `mailtrap`, `postmark`, `resend` or `sendgrid`, with **no default** — a key on its own does not say where to send it. They differ in body shape, in the header that carries the key and in what they call the sender — which is why this is a name and not just a URL. **`smtp` is refused by name**: Workers cannot open a socket to port 587, and `server/native/` is the implementation that speaks it |
| `EMAIL_ENDPOINT` | var | the provider's own | Where to post. **Required for `mailtrap`** (its URL carries an inbox id) and **`mailgun`** (a sending domain) |
| `MAX_RECORD_BYTES` | var | `1048576` | Reported by `/v1/capabilities` |
| `MAX_BATCH_OPERATIONS` | var | `100` | Reported by `/v1/capabilities` |
| `MAX_BATCH_BYTES` | var | `8388608` | Reported by `/v1/capabilities`, and the largest body this server will read |
| `MAX_PAGE_RECORDS` | var | `500` | Reported by `/v1/capabilities` |
| `ACCOUNT_QUOTA_BYTES` | var | `20971520` | Reported by `/v1/capabilities` |
| `TOMBSTONE_RETENTION_DAYS` | var | `90` | Reported by `/v1/capabilities` |
| `REGISTRATIONS_PER_HOUR` | var | `10` | How many accounts one source may open in an hour |
| `RESETS_PER_HOUR` | var | `10` | How often one source may ask for a reset letter |
| `LOGINS_PER_WINDOW` | var | `20` | Attempts on one account in fifteen minutes, right or wrong |
| `VERIFY_ATTEMPTS_PER_WINDOW` | var | `10` | Codes tried against one account in fifteen minutes |
| `PARAMS_PER_HOUR` | var | `200` | How often one source may ask where an address's salt is. Generous: a company behind one address may install on fifty machines in a morning |
| `AUTH_PER_HOUR` | var | `300` | How often one source may try to sign in or spend a code, across every account. The per-account counters cannot see somebody working through a list of addresses |
| `LETTERS_PER_ACCOUNT_PER_HOUR` | var | `3` | How many letters **one address** may receive. The counters above bound what one network sends and nothing about what one mailbox receives |
| `CLOSING_ON` | var | none | A date this server will be switched off, such as `2027-03-01`. Reported by `/v1/capabilities` so a person has warning enough to copy their account elsewhere (D4b). **Advisory**: nothing refuses a request after it |
| `ACCESS_TOKEN` | secret | none, so open | A shared token that closes this deployment to everybody who has not been given it, for somebody running it for their own company. **The hosted instances never set one** |
| `TEST_OUTBOX` | var | off | `"1"` serves `/__test__/outbox` and sends no mail. **Never on a real deployment** |

**Required** means every request answers `503` carrying the missing names, rather than the deploy
succeeding and the first letter being the thing that fails. A Worker has no startup to refuse at,
which is why the check runs per request here and `server/native/` refuses to start instead.

The seven rate limits are **not** reported by `/v1/capabilities`, unlike every other number here:
publishing the figure that stops abuse helps only the abuser. The first two are counted per source
rather than per account — the abuse they answer is opening many accounts, which a counter inside
one account cannot see — and `src/ratelimit.ts` carries that argument.

**A source here is `CF-Connecting-IP`**, which Cloudflare sets and a request cannot reach this
Worker without passing through. `server/native/` has to work harder for the same thing, because
a server somebody runs themselves may be reachable directly.

**The letter allowance is counted in the source-limit namespace, not in the account object**,
because registering over an unverified account replaces that object — and re-registering is one
of the two ways to ask for a letter. A counter the counted party can clear is not a counter.

Every limit is reported rather than assumed, which is what stops a limit from becoming a release:
a server raises a number in its own configuration and a client reads it (D4a, D9).

**Workers cannot speak SMTP**, so an SMTP account is the wrong thing to hold here — the provider
needs an HTTP API. Two pieces of stale advice are worth knowing about: Cloudflare's own Email
Routing receives and does not send, and MailChannels' free offering for Workers ended in 2024.
