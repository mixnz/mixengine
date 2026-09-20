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

| Name | Kind | What it is |
| --- | --- | --- |
| `PEPPER` | secret | Keyed into the stored password verifier, so a stolen database is not a list of verifiers |
| `EMAIL_API_KEY` | secret | The email provider's key. **Which provider is a deployment decision**, and it sits behind one interface in `src/email/` for exactly that reason |
| `EMAIL_FROM` | var | The address the two letters are sent from |
| `EMAIL_PROVIDER` | var | `resend` or `mailtrap`. They differ in body shape and in the header that carries the key, which is why this is a name and not just a URL |
| `EMAIL_ENDPOINT` | var | The provider's HTTP endpoint |
| `MAX_RECORD_BYTES` | var | Reported by `/v1/capabilities` |
| `MAX_BATCH_OPERATIONS` | var | Reported by `/v1/capabilities` |
| `MAX_PAGE_RECORDS` | var | Reported by `/v1/capabilities` |
| `ACCOUNT_QUOTA_BYTES` | var | Reported by `/v1/capabilities` |
| `TOMBSTONE_RETENTION_DAYS` | var | Reported by `/v1/capabilities` |
| `REGISTRATIONS_PER_HOUR` | var | How many accounts one source may open in an hour |
| `RESETS_PER_HOUR` | var | How often one source may ask for a reset letter |
| `LOGINS_PER_WINDOW` | var | Attempts on one account in fifteen minutes, right or wrong |
| `VERIFY_ATTEMPTS_PER_WINDOW` | var | Codes tried against one account in fifteen minutes |
| `RELOCATE_TO` | var | Which endpoint a retired account is sent to (D4b). A **symbolic id**, never a URL: a server that could name an address could send people to one that collects their verifier. Unset means this server will not let go of an account |
| `RELOCATION_LEASE_SECONDS` | var | How long a freeze lasts before it lapses. 900 by default |
| `TEST_OUTBOX` | var | `"1"` serves `/__test__/outbox` and sends no mail. **Never on a real deployment** |

The four rate limits are **not** reported by `/v1/capabilities`, unlike every other number here:
publishing the figure that stops abuse helps only the abuser. The first two are counted per source
rather than per account — the abuse they answer is opening many accounts, which a counter inside
one account cannot see — and `src/ratelimit.ts` carries that argument.

Every limit is reported rather than assumed, which is what stops a limit from becoming a release:
a server raises a number in its own configuration and a client reads it (D4a, D9).

**Workers cannot speak SMTP**, so an SMTP account is the wrong thing to hold here — the provider
needs an HTTP API. Two pieces of stale advice are worth knowing about: Cloudflare's own Email
Routing receives and does not send, and MailChannels' free offering for Workers ended in 2024.
