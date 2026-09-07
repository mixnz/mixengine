# T98 — opt-in per-site HTTP→HTTPS redirect

**Roadmap task:** T98, phase 5. **Depends on:** T51 (web server TLS wiring).

T51's D9 decided **no redirect**, for a reason that is still correct: `http://blog.test` keeps
serving the site rather than answering 308, because a local webhook or an old client pointed at
plaintext keeps working, and a POST that follows a redirect only sometimes is a bug nobody would
attribute to their web server's configuration. That stays the default for every site that does not
ask for anything else.

What changed is that a user can ask for something else. A site behind this home that is reached from
the outside — a webhook target, a payment callback, a QA environment a teammate opens from their own
machine — sometimes has to answer plaintext requests with a redirect, because whatever is upstream of
it assumes one. T98 is that override: **opt-in, per site, off by default**, so T51's reasoning still
describes every site that has not turned it on.

---

## D1 — a column with its own invariant, enforced by SQLite rather than by every caller

`sites` gains `https_redirect INTEGER NOT NULL DEFAULT 0`, beside `https_enabled` exactly as that
one was declared in `0001_initial.sql`. The question is how "redirect requires HTTPS" is enforced,
and the answer is **not** a trigger.

`0012_site_sharing.sql`'s own comment says "SQLite cannot add a table-level CHECK to an existing
table" — true, and it is why that migration reaches for a trigger for a three-column invariant. This
one is two columns, and SQLite's restriction is on **table-level** CHECKs added after the fact, not
on a **column-level** one added by the same `ALTER TABLE ADD COLUMN` referencing a column already in
the row. Measured directly before writing the migration, rather than assumed from the trigger
comment next to it:

```sql
CREATE TABLE t (id INTEGER PRIMARY KEY, https_enabled INTEGER NOT NULL DEFAULT 1 CHECK (https_enabled IN (0,1)));
ALTER TABLE t ADD COLUMN https_redirect INTEGER NOT NULL DEFAULT 0 CHECK (https_redirect = 0 OR https_enabled = 1);
INSERT INTO t (https_enabled, https_redirect) VALUES (0, 1);
-- Runtime error: CHECK constraint failed: https_redirect = 0 OR https_enabled = 1
```

It is refused. So `0018_site_https_redirect.sql` is one line:

```sql
ALTER TABLE sites ADD COLUMN https_redirect INTEGER NOT NULL DEFAULT 0
    CHECK (https_redirect = 0 OR https_enabled = 1);
```

The invariant — *a site cannot carry `https_redirect = 1` while `https_enabled = 0`* — is now a
property of the row itself, in the one place SQLite will hold it, rather than a rule every future
caller of `sqlx::query!` has to remember to repeat. `crate::sites::create` and `::update` still
refuse the combination before they reach the database (D2), because the message a CHECK violation
produces is `CHECK constraint failed: https_redirect = 0 OR https_enabled = 1` and the one this
module owes a caller is `https_redirect needs https enabled first` — but the column does not depend
on either of them getting it right.

## D2 — two different things happen when HTTPS is turned off, and the difference is whether the caller said so

`Change.https_redirect` is `Option<bool>`, on `Change.https_enabled`'s own pattern: `None` means
"leave it". That is not enough on its own, because `https_enabled` and `https_redirect` are not
independent — turning the first off while the second stays `Some`-untouched-and-`true` would ask
`sites::update` to write a row the CHECK in D1 refuses, and the caller asked for neither the refusal
nor the silence that would have to follow it.

So `update` resolves them together rather than column by column:

1. **The caller explicitly asks for `https_redirect: true`, and the HTTPS this update leaves the
   site with is `false`.** Refused — `Error::HttpsRedirectNeedsHttps` — whether that `false` comes
   from this same call turning HTTPS off or from the site already being plaintext-only. The caller
   asked for the one combination D1 makes unrepresentable, and is told so in the row's own words
   rather than the CHECK's.
2. **The caller turns HTTPS off and says nothing about the redirect, and the redirect was on.**
   Turned off with it, in the same `UPDATE`. Nobody asked for this outcome in so many words, but
   leaving `https_redirect = 1` on a plaintext-only site is not "leave it" — it is a stale flag
   describing a behaviour the site no longer has, on a row the CHECK would refuse to hold, which
   would turn every *other*, unrelated field on this `update` into a transaction that aborts for a
   reason the caller's own request never mentioned.
3. **Every other case** — HTTPS staying on or being turned on, the redirect being set explicitly to
   whatever is still representable — resolves exactly the way `Change`'s doc comment already
   promises: `None` leaves it, `Some` replaces it.

`create` takes the simpler half of the same rule: `https_redirect` defaults to `false`, and
`NewSite { https_redirect: true, https_enabled: false, .. }` is refused by the same error before a
row is written, rather than written and immediately contradicted by the CHECK.

## D3 — the one route that must never redirect

**Found by reading `site.caddy` and `site.conf` before writing either change, not discovered after
shipping one.** A shared site's plaintext block carries a route nothing else does:

```caddyfile
handle /__mixengine/ca.crt {
	root * `…/public`
	rewrite * /ca.crt
	header Content-Type application/x-x509-ca-cert
	file_server
}
```

T75 put it there because a phone does not trust this home's authority until it has installed the
certificate this route serves — and it can only be fetched before that trust exists over plaintext, since
every HTTPS listener on this home presents a leaf signed by the authority the phone has not yet
agreed to trust.

A redirect that applies to "every request on the plaintext block" would catch this one too, and the
failure it produces is the worst kind: **silent and circular**. The phone is redirected to
`https://blog-mixengine.local/__mixengine/ca.crt`, TLS refuses it for presenting a certificate from
an authority nothing on the phone trusts, and the one document that would fix that is the one the
redirect just made unreachable. Nothing in either server's log says "the CA route was redirected" —
it says a handshake failed, on a phone a teammate is holding, away from a terminal.

So the redirect this task adds is **everything except that one route**, on both front ends, and it
is the reason D4 and D5 below are each a change to the block that already exists around the route
rather than a block that ignores it.

## D4 — Caddy: the plaintext handler becomes a `redir`, the CA route does not move

`site.caddy`'s plaintext block already wraps its handler in `handle { … }` whenever an `authority` is
present, specifically so the CA route above can sit beside it as a second, earlier `handle` — Caddy
matches `handle` blocks in order and takes the first that matches, so the CA route is already
unreachable from the generic handler and vice versa. `https_redirect` needs nothing new there: the
generic handler's *contents* change, not its position.

```caddyfile
http://blog.test {
	bind 127.0.0.1 ::1
	handle /__mixengine/ca.crt {
		root * `…/public`
		rewrite * /ca.crt
		header Content-Type application/x-x509-ca-cert
		file_server
	}
	handle {
		redir https://{host}{uri} permanent
	}
}
```

`{host}` and `{uri}` are Caddy's own request placeholders, not this site's `domains` list — which
matters for a site with aliases (`blog.test` and `www.blog.test` both match one block) and for a
shared site answering to its LAN address and its mDNS name as well. A placeholder answers with
whatever the request actually named; naming `domains[0]` instead would send every alias's visitor to
the primary domain's TLS listener; a name SAN does not cover, for a certificate whose SANs are
`record.domains` in the site's own order.

The condition this is written under is **`https_redirect` and a usable `certificate`**, not
`https_redirect` alone: T51's D4 already renders plaintext-only for a site that declares HTTPS but
has no usable certificate on disk, and a redirect to a TLS listener nothing is bound to would turn a
missing-certificate site (which `mix doctor` already reports and repairs without a prompt) into one
that answers every request with a 301 into nowhere instead of the page it has always been able to
serve.

A site with no certificate or with the redirect off renders exactly the block it rendered before this
task — the generic handler's existing four-branch `kind` dispatch (`php_fastcgi`, `file_server`,
`reverse_proxy`, and the activator trio) is the `else` half of one new `{% if %}`, not something
moved or rewritten.

**This is the expected shape, not yet measured against the real binary.** `{host}` and `{uri}` are
documented Caddyfile placeholders and `redir` is an ordinary directive, but T51's own D2 is the
standing reminder that what looks obvious in a Caddyfile and what `caddy validate` accepts are two
different claims — that task's first draft was refused outright by the program for a reason no
amount of reading the documentation surfaced first. `caddy validate` against the pinned version, and
`tests/caddy.rs`'s real-server suite extended with a redirect-enabled site, are this task's equivalent
first step, before the template above is taken as final.

## D5 — nginx: the redirect needs a second `server` block, which T51's D6 specifically avoided needing

T51's D6 found that nginx attaches `ssl` to a `listen` line rather than to the block the way Caddy's
`tls` does, which is exactly what let one `server` block carry a plaintext and a TLS listener
together with no conflict — the opposite of D2's finding for Caddy. That shape cannot also carry a
redirect, for a reason that is about nginx's request dispatch and not about TLS: a `server` block is
one set of `location` directives, matched after nginx has already picked the block by `listen`
address — there is no way to say "serve this document root on this listener, redirect on that one"
inside one block without asking each `location` to test which listener accepted the connection.

nginx has a way to do that — `if ($scheme = http) { return 301 …; }` inside the shared block — and it
is not taken. The long-standing warning against `if` in a `server` or `location` context — carried on
nginx's own wiki under the title "If is Evil" — is that it does not behave like a general-purpose
conditional there: it is rewritten into the module's own request-processing phases, and constructs
that look reasonable are the ones documented to misbehave or crash a worker. `return` inside `if` for
exactly this redirect is the one construct the same page calls safe, which makes it a plausible
second design rather than a forbidden one — but choosing it to save one block would trade a fact
demonstrated about this server (D2's own finding, the same instinct a second time) for a known sharp
edge, to avoid writing four lines twice.

So a site with `https_redirect` and a usable certificate renders **two** `server` blocks, which is
Caddy's own shape from D2 arrived at for a different program's reason:

```nginx
server {
	listen 127.0.0.1:80;
	server_name blog.test;

	location = /__mixengine/ca.crt {
		alias "…/public/ca.crt";
		default_type application/x-x509-ca-cert;
	}

	location / {
		return 301 https://$host$request_uri;
	}
}

server {
	listen 127.0.0.1:443 ssl;
	server_name blog.test;
	ssl_certificate "…/blog.test.crt";
	ssl_certificate_key "…/blog.test.key";

	root "…";
	location / {
		try_files $uri $uri/ =404;
	}
}
```

`$host` rather than `$server_name`, for D4's reason restated in nginx's own variables: `$host` is
what the client sent, which is right for an alias and for the LAN address alike; `$server_name` is
the block's first name and would send every alias to the primary domain.

The CA `location =` block is **duplicated into the plaintext block above and left out of the TLS
one**, rather than shared: it answers a phone that has not yet trusted this home's authority, so it
has no reason to exist behind a listener that phone cannot yet reach, and the two blocks are already
separate documents by the shape of this change — there is no shared file to put it in that both
`include`, on the same reasoning `caddy.rs`'s header gives for never introducing one.

A site with the redirect off, or with no usable certificate, renders the single block T51 shipped,
unchanged — the two-block shape is new territory gated behind one condition, not a rewrite of the
common path.

**Neither snippet above has been run through `nginx -t` yet**, for the same reason Caddy's has not
been run through `caddy validate`: there is no `nginx` or `caddy` binary on the machine this spec was
written on, and this codebase's own standard — T51's D6 and D8 both — is that a rendering is judged by
the program that reads it, not by how closely it resembles that program's documentation. The shape
above is the best current answer to "how does nginx's own advice against `if` translate into two
blocks", and implementation's first step is the same one D4 names: validate it, extend
`tests/nginx.rs`'s real-server suite with a redirect-enabled site and a request for
`/__mixengine/ca.crt` over plaintext, and let the real program, not this document, settle the exact
directives.

## D6 — the shape of the field, end to end

One boolean, named `https_redirect` at every layer it passes through, so that nothing along the path
has to remember a translation:

- `mixengine-core::sites`: `SiteRecord.https_redirect: bool`, `NewSite.https_redirect: bool`,
  `Change.https_redirect: Option<bool>` — `https_enabled`'s own three shapes.
- `mixengine-core::generate::served::Served.https_redirect: bool`, read straight from the record
  with no transformation; D4 and D5's `{% if %}` reads it beside `certificate`.
- `mixengine-proto::site_api`: `SiteCreate.https_redirect: Option<bool>`,
  `SiteUpdate.https_redirect: Option<bool>`, `SiteSummary.https_redirect: bool` — `https`'s own
  optionality, because "not given" and "given as false" are different requests for `update` (D2) and
  the same request for `create`.
- `mixengine-cli`: `--https-redirect <bool>` on `site create` and `site update`, `https`'s own
  `#[arg(long)] Option<bool>` shape, not a `--https-redirect`/`--no-https-redirect` pair — this
  codebase has exactly one convention for an optional boolean flag and this is not a reason to start
  a second one.
- `mix site show` / `mix site list`: the existing `https` line gains a suffix — `https     yes
  (redirect)` — rather than a line of its own, because a redirect that is never reachable without
  HTTPS already being on is not a fact worth its own row.

## D7 — what this deliberately does not do

**It does not change what any existing site serves.** `https_redirect` defaults to `false` on every
row this migration touches — `ADD COLUMN … DEFAULT 0` backfills every existing site with the exact
behaviour T51 shipped — and both templates render their pre-T98 output whenever it is `false` or the
site has no usable certificate. T51's D9 is still the description of every site that has not asked
for this.

**It does not touch the LAN listener differently from loopback.** A shared site's redirect and its
CA exemption apply to both, for Shared's own reason (T74): the developer's browser and the phone are
looking at the same site at the same time, and a redirect policy that differed between the two
addresses would be the site answering two different ways depending on which network asked.

**It adds no way to turn this on for every site at once.** There is no front-end-wide setting beside
`auto_https`/`http_port`; the whole point is that a redirect is a fact about one site's traffic, not
about this home's web server, so it lives on the row the rest of `https_enabled` already lives on
and nowhere else.

**It does not validate the target of the redirect against anything but the certificate's presence.**
Whether the certificate actually matches what a browser will accept — trust store, SAN coverage — is
every question T50 through T54 already answer or deliberately decline to; this task adds no new one.

**Nothing about `mix doctor` changes.** A site with `https_redirect = true` and no usable certificate
renders plaintext exactly as a site with `https_enabled = true` and no certificate already does, and
`SiteCertificateMissing` already reports and repairs that gap. A redirect with nowhere to send the
request is D4/D5's condition refusing to fire, not a new failure mode `doctor` has to learn.

## D8 — what has to be true, and how this is proved

**Unit, in `mixengine-core::sites`:** `create` refuses `https_redirect: true` with `https_enabled:
false`; `update` refuses the same combination however it arrives at it; `update` turning
`https_enabled` off silently carries `https_redirect` to `false` when the caller did not mention it,
and leaves it alone when HTTPS stays on. A site created or updated with both `true` round-trips both
columns through `records`.

**Unit, in `generate::served`:** `Served.https_redirect` mirrors the record; a site with the flag on
but no usable certificate carries `certificate: None` exactly as an `https_enabled`-only site does,
which is what D4/D5's renderer condition reads.

**Unit, in `recipes::caddy` and `recipes::nginx`:** a site with `https_redirect` and a certificate
renders a `redir`/`return 301` and not the site's own handler on the plaintext side; a shared such
site's `/__mixengine/ca.crt` route still answers 200 over plaintext rather than being caught by the
redirect — the assertion D3 exists for; a site with the flag off, or with no certificate, renders
byte-identical output to what it rendered before this task landed.

**Against the real programs**, in `crates/mixengine-cli/tests/caddy.rs` and `tests/nginx.rs`,
`#[ignore]`d and fetched by CI exactly as T51's are: a home with one redirect-enabled HTTPS site
accepts a plaintext request and receives a redirect response naming the `https://` form of the same
request, and a request for `/__mixengine/ca.crt` over plaintext on that same home still receives the
certificate rather than a redirect.
