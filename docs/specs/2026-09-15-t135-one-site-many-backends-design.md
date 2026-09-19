# T135 — one site, many backends (design)

Proposed roadmap task **T135**, phase 16: *"A site forwards different path prefixes to different
backends — several ports, a php-fpm pool, a directory on disk — and a prefix may be rewritten on the
way out, `/abc` reaching `http://127.0.0.1:3003/xyz`."*

## What was asked

> user có nhu cầu, 1 site cần có thể proxy vào nhiều port (hoặc cả fpm) trên nhiều location khác
> nhau, hiện tại 1 site chỉ đang có thể proxy vào 1 kênh duy nhất
>
> ngoài ra cũng cần cho chỉnh proxy theo dạng /abc vào http://127.0.0.1:3003/xyz

Two sentences, two separate things: *more than one backend per site*, and *the prefix is not the
same on both sides of the proxy*. The second is not a refinement of the first — a single-backend
site already wants it, and a multi-backend site is unusable without it, because two applications
mounted at `/` cannot both keep their own idea of where they are.

## What was observed, and how

Read out of the three site tables, the two front-end templates and the daemon's validator; the one
claim that could be measured here was measured, against the Caddy this machine already has installed
(`packages/caddy/2.11.4`).

**A site is one handler.** [`SiteKind`](../../../crates/mixengine-proto/src/site_api.rs) is an
internally tagged enum with four variants, `sites.config_json` holds its payload, and each of the two
templates renders exactly one handler rooted at `/`:

| Kind | Caddy | nginx |
| --- | --- | --- |
| `php-fpm` | `php_fastcgi <pool>` + `file_server` | `location /` + `location ~ \.php$` |
| `static` | `file_server` | `location /` with `try_files` |
| `reverse-proxy` | `reverse_proxy <upstream>` | `location /` with `proxy_pass` |
| `node-app` | the same, at `127.0.0.1:<port>` | the same |

There is no second address anywhere in that shape, and no place a second one could go: the kind is
one value on one row.

**And a path in an upstream breaks Caddy today.** `upstream_is_an_address`
(`crates/mixengine-daemon/src/sites.rs:1090`) accepts a path on purpose — its own test lists
`http://127.0.0.1:3000/api` among the good ones — and Caddy refuses it outright:

```
$ caddy validate --adapter caddyfile --config probe1.caddy
Error: adapting config using caddyfile: parsing caddyfile tokens for 'reverse_proxy':
parsing upstream 'http://127.0.0.1:3003/xyz': for now, URLs for proxy upstreams only support
scheme, host, and port components
```

The whole rendering is judged by one `caddy validate` where it is staged, so that site does not fail
alone: **every site on the machine keeps its old configuration**, and a person who typed one URL with
a path has broken the front end for all of them. It is the same mechanism this task has to build
anyway — a proxy that changes the path on the way out — so it is fixed here rather than filed.

nginx accepts the same upstream and does something different with it (its own prefix-replacement
rule). So the two front ends disagree about what that URL means, which is the other half of the
reason it cannot be left alone.

## Goal

One site answers different path prefixes with different backends — a port, a php-fpm pool, or a
directory — and a prefix may be rewritten on the way out. The same site behaves identically on Caddy
and on nginx, is fully reachable from `mix`, is drawn and edited in MixLab, and survives an export
and an import.

## Scope

**In:**

- `SiteRoute` on the wire, in the database, in `mixengine.toml` and in a blueprint manifest.
- Three targets: a proxy, a php-fpm pool, a directory.
- Prefix rewriting, one rule, measured on both front ends.
- Both front ends, measured separately — `frontend.rs`' standing rule.
- `mix site create` / `mix site update`, and the MixLab site form.
- The Caddy path-in-upstream bug above, and the injection hole beside it (D10).

**Out:**

- A `mix doctor` check for a route whose pool has gone. The render skips that route with a warning
  and serves the rest of the site; a check is a proto variant, a CLI rendering and a repair, and it
  is a separate task. See D8.
- A document root of its own for a php-fpm route. See D6.
- Routing on anything but a path prefix — a header, a method, a host.
- Per-route headers, timeouts, websocket settings, or load balancing across several upstreams.
- Any change to the blueprint gallery. The manifest *reader* learns `[[site.routes]]`; no shipped
  manifest gains one, so `mixengine-packages` does not need re-publishing.

## Decisions

### D1. A route is a list beside `SiteKind`, not a fifth variant

`SiteKind` keeps its meaning and gains one sentence: **it is what answers everything no route
matched.** A site is `kind` plus an ordered set of routes, and a site with no routes renders exactly
what it renders today, byte for byte.

The alternative — `SiteKind::Routed { routes }` — was rejected three times over. It would reach the
twenty-three files that name `SiteKind::` today, each of which would have to decide what a routed
site's *fallback* is; it would make "add a route to this site" a change of kind, so a php-fpm site
would stop being one; and it would leave the welcome page with no kind to describe (`welcome::page`
renders a different sentence per kind).

The consequence worth stating: **`/` cannot be a route path.** What answers `/` is the kind, and a
route that claimed it would be a second answer to a question that has one. A site whose root serves
nothing is spelled `kind = static` over a directory that is empty, which is already a supported state
and already answers with the welcome page ([ADR 0031](../../../.claude/decisions/0031-a-site-with-nothing-behind-it-is-answered-by-mixengine.md)).

### D2. One rewriting rule, and it is the upstream's own path

> **The matched prefix is replaced by the upstream's path, with any trailing slash removed. An
> upstream with no path replaces nothing.**

| `upstream` | `/abc` | `/abc/foo?q=1` |
| --- | --- | --- |
| `http://127.0.0.1:3003` | `/abc` | `/abc/foo?q=1` |
| `http://127.0.0.1:3003/xyz` | `/xyz` | `/xyz/foo?q=1` |
| `http://127.0.0.1:3003/` | `/` | `/foo?q=1` |

One field carries it, which is the point. The obvious alternative is a second field — `strip`,
`keep`, `replace_with` — and it buys nothing: every one of those states is already spellable in the
URL a person was going to type anyway, and two fields is two things that can disagree. It is also
nginx's own `proxy_pass` rule, so the one front end that has an opinion already agrees with us.

**Measured on Caddy 2.11.4**, with the rendering D4 describes, against an upstream echoing `{uri}`:

```
/abc          ->  UPSTREAM /xyz
/abc/foo      ->  UPSTREAM /xyz/foo
/abc/foo?q=1  ->  UPSTREAM /xyz/foo?q=1
/api/x        ->  UPSTREAM /api/x        (a route whose upstream has no path)
/other        ->  FALLBACK /other
/abcdef       ->  FALLBACK /abcdef       (the prefix matches at a segment boundary, not as text)
```

The last line is the one a reader should not skip: `/abcdef` is **not** under `/abc`. A prefix match
that ignored segment boundaries is nginx's default for `location /abc`, and it is a trap — a route
at `/api` would swallow `/apidocs`. Both renderings in D4 match on boundaries.

### D3. Three targets, and no fourth

```rust
pub struct SiteRoute {
    pub path: String,
    #[serde(flatten)]
    pub target: RouteTarget,
}

#[serde(tag = "target", rename_all = "kebab-case")]
pub enum RouteTarget {
    Proxy  { upstream: String },
    PhpFpm { pool: Option<ServiceId> },
    Static { root: String },
}
```

**Flattened, which is `SiteKind`'s own trick and is here for `SiteKind`'s own reason**: one
definition reads a JSON-RPC member and a flat `[[site.routes]]` table in TOML with no conversion
between them. A route is `{"path": "/api", "target": "proxy", "upstream": "…"}` on the wire, not a
`target` inside a `target`.

- **`Proxy`** is `SiteKind::ReverseProxy`'s field, validated by the same function, so there is one
  answer to "what is a proxy target" on this machine. `SiteKind::NodeApp`'s port is not a fourth
  variant: it is `http://127.0.0.1:<port>`, and a second way to write an address is a second thing
  to keep in step.
- **`PhpFpm`** carries `Option<ServiceId>` for exactly the reason `SiteKind::PhpFpm` does, in both
  directions: `None` on the way in means *decide it* (`core::resolve` against the project root, the
  same call `site.create` makes), and `None` on the way out means *the pool this route named has been
  deleted*, which is a row `ON DELETE SET NULL` can produce.
- **`Static`** takes a required root, relative to the owner's root like `sites.doc_root`, and **the
  matched prefix is stripped**: `/assets` → `dist` answers `/assets/app.css` out of
  `<root>/dist/app.css`. That is the only reading that is worth anything — a `/assets` that resolved
  to `dist/assets/app.css` is what the site's own document root already does, so the target would
  have no job.

**And a php-fpm route strips nothing**, which is the asymmetry in this list and is deliberate. The
two targets do different jobs: `Static` *mounts a directory at a URL*, `PhpFpm` says *this subtree of
my site is answered by that pool*. Stripping under a PHP handler is `alias`, and `alias` beneath
`fastcgi_pass` is the nginx footgun that leaves `SCRIPT_FILENAME` pointing at nothing and a blank
page rather than an error. D6 is the rest of that argument.

### D4. What each front end is told

Routes are rendered **longest path first** and duplicate paths are refused, so the order a person
typed them in cannot change what the site does — and the two front ends, which resolve overlaps by
different native rules, resolve them the same way here because neither is asked to.

**Caddy** — one `handle` per route, inside the same block as the fallback, before it:

```
@route_0 path /abc /abc/*
handle @route_0 {
	uri path_regexp ^/abc(/.*)?$ /xyz$1
	reverse_proxy 127.0.0.1:3003
}
```

`uri path_regexp` and **not** the readable-looking pair `uri strip_prefix /abc` + `rewrite *
/xyz{uri}`: Caddy sorts directives into its own standard order inside a block, and `rewrite` comes
*before* `uri` in it, so that pair runs backwards and produces `/xyz/abc/foo`. One directive has no
order to get wrong. A route whose upstream carries no path renders no `uri` line at all.

The rewrite's regex has two shapes, because the strip-to-root case cannot share the other's:

| Upstream path | regex | replacement | `/abc` | `/abc/foo` |
| --- | --- | --- | --- | --- |
| `/xyz` | `^/abc(/.*)?$` | `/xyz$1` | `/xyz` | `/xyz/foo` |
| `/` | `^/abc/?(.*)$` | `/$1` | `/` | `/foo` |

Both measured on Caddy 2.11.4. With one shape, `$1` for `/abc` is empty and the request would leave
with **no path at all**.

**A route `handle` nests inside the `handle` the authority route already wraps a shared site in, and
a block-level `root *` reaches into it** — measured, because the template's shape depends on both:
`/__mixengine/ca.crt` still answered, the fallback still saw the site's root, and the route between
them took its own. A `Static` route sets `root *` and `uri strip_prefix` inside its own `handle`,
which overrides the block's for that prefix and nothing else.

**nginx** — a regex `location` per proxy route, rendered before `location ~ \.php$` because nginx
takes regex locations in the order it read them:

```
location ~ ^/abc(/.*)?$ {
    rewrite ^/abc(/.*)?$ /xyz$1 break;
    proxy_pass http://127.0.0.1:3003;
}
```

`proxy_pass` with no URI part, because nginx refuses a URI part inside a regex location outright, and
because the `rewrite … break` above has already done the work. A route with no rewrite renders the
`proxy_pass` alone.

A `php-fpm` or `static` route is a pair of prefix locations rather than a regex one, because it has
to serve files and to nest a PHP handler under itself:

```
location = /admin { return 301 /admin/; }
location ^~ /admin/ {
    try_files $uri $uri/ /admin/index.php?$query_string;

    location ~ \.php$ {
        include "<fastcgi_params>";
        fastcgi_param SCRIPT_FILENAME $document_root$fastcgi_script_name;
        …
        fastcgi_pass <pool>;
    }
}
```

`^~` is what makes the route beat the site's own `location ~ \.php$`; `= /admin` is the boundary —
without it `^~ /admin` would also take `/admindir`, and the redirect it returns is what nginx and
Caddy's `file_server` both do for a directory anyway. **The PHP handler is nested rather than written
beside it**, and that is not tidiness: `^~` stops the sibling regex search, so a handler at the top
level would never be reached and `try_files $uri` would serve `/admin/x.php` as text out of the
current context — T124a's source leak, in a new place. There is no `root` here because a php-fpm
route has none (D6); it inherits the server block's, which is the site's document root.

A `static` route is the same pair with `alias` in place of `root` and no nested location, which is
how nginx spells the prefix strip D3 gives that target.

### D5. `.` is a regex metacharacter and a path may contain one

A route at `/v1.0` renders `^/v1.0(/.*)?$`, which matches `/v1X0`. Every path is regex-escaped where
it is rendered into a regex, on both front ends, and a test asserts the escape rather than the
rendering — the whitelist in D10 leaves `.` as the only metacharacter that can reach one, and a test
that only checked today's whitelist would go green if the whitelist grew.

### D6. A php-fpm route has no root of its own

It serves the site's document root, and the prefix is not stripped: `/admin/x.php` is
`<doc_root>/admin/x.php`. What the route changes is **which pool** answers under that prefix.

Two reasons, and the second is the one that decides it. `alias` under a php-fpm handler is the
classic nginx footgun — `SCRIPT_FILENAME $document_root$fastcgi_script_name` is wrong under `alias`
and produces a blank page rather than an error. And the CLI has to be able to spell every field
(`client-surface.md`'s rule, read the other way round): a flag carrying a path, a pool *and* a root
is a grammar nobody can remember. A tree that genuinely lives elsewhere is a second site, which costs
one command.

`Static` keeps its root because a root is the entirety of what it says.

### D7. Routes are their own table, and replace as a whole

`site_routes(id, site_id, position, path, target, php_service_id, config_json)`, `site_id`
`ON DELETE CASCADE`, `php_service_id` `ON DELETE SET NULL` and `UNIQUE (site_id, path)`. Not
`sites.config_json`: that column is the *kind's* payload, and `read_kind` is the one reader of it.

`SiteCreate.routes` and `SiteUpdate.routes` are `Option<Vec<SiteRoute>>` and **replace** the list
rather than merging into it — [`SiteUpdate`](../../../crates/mixengine-proto/src/site_api.rs)'s
standing rule, for its stated reason: with a merge there is no way to remove one. `None` leaves the
list alone; `Some(vec![])` empties it.

`SiteSummary.routes` is optional on the wire —
[ADR 0019](../../../.claude/decisions/0019-an-added-response-member-is-optional.md) — so a `mix` from
this build can still read an older daemon's answer.

**On the summary rather than on the detail**, which is where this landed and not where it started.
The first draft put it on `SiteDetail` alone, and that would have made a listing unable to say
whether a site has anything behind it without a call per row — the exact argument `SiteSharing` is on
the summary for. `mix site list` shows a count; `mix site show` shows the list.

`records` reads them with one query per site, beside the two it already makes for domains and
services. A batch read would be the better shape for all three and is not this task's to introduce
for one of them.

### D8. A route whose pool has gone loses the route, not the site

`served` skips that one route with a `tracing::warn!` naming the site and the pool, and renders
everything else. The precedent is the opposite one on purpose: a *site* whose pool has gone is
dropped entirely, because there is nothing left of it to serve. A route is one prefix of a site that
still has a root, a kind and possibly four other routes, and taking the site down over it would turn
one `service.delete --force` into an outage.

A `static` route whose directory is missing is rendered anyway and answers 404, on the same rule
`SiteDetail.doc_root_exists` already follows: **reported, never refused** — the directory may be
built by a command nobody has run yet.

### D9. A shared site shares its routes

Sharing binds one more address on the same block
([lan-sharing.md](../../../.claude/features/lan-sharing.md)), and every route in that block answers
on it. That is already true of a `reverse-proxy` site and is not widened here — but it is worth
writing down, because "I shared a site" now means "I shared four backends", and the person who typed
`mix site share` should be able to read that somewhere.

### D10. A path and an upstream are both config, and both are validated as such

`upstream_is_an_address` checks a scheme, a host and the absence of `?` and `#`. It does not check
for a newline, and an upstream is rendered verbatim into a Caddyfile and into `nginx.conf` — so
`http://h\n}\nadmin 0.0.0.0:2019 {` is a configuration-injection hole that exists today, reachable
through one JSON-RPC field. It is closed here, with a character whitelist, because this task
multiplies the number of places that field is rendered into.

- **Upstream**: printable ASCII, no whitespace, no control characters, and none of `` ` `` `"` `'`
  `{` `}` `\` `;` `#` `?` — on top of the four checks already there. Refused, never escaped: a URL
  that needs escaping to be written into a config file is a URL somebody mistyped.
- **Path**: begins with `/`, does not end with one, at least one segment, each segment non-empty and
  drawn from `A-Za-z0-9`, `-`, `_`, `.`, `~`, `%`; no segment is `.` or `..`. Refused: `/`, `*`, a
  query, a fragment, a space.
- **Limits**: at most 32 routes per site, at most 255 bytes per path. Refused rather than truncated.

### D11. A route survives an export, an import and a capture

`[[site.routes]]` in `mixengine.toml` under the `[site]` table, written by `project.export` and read
by the import, and the same in a blueprint manifest, written by `blueprint.capture`. A round trip
that silently dropped half of what a site is would be worse than one that refused.

```toml
[site]
kind = "node-app"
port = 3000

  [[site.routes]]
  path = "/api"
  target = "proxy"
  upstream = "http://127.0.0.1:3003/xyz"

  [[site.routes]]
  path = "/admin"
  target = "php-fpm"
  pool = "php-fpm@8.3.33"
```

### D12. What `mix` types

Three repeatable flags on `site create` and `site update`, one per target, plus one that empties the
list. They build the whole list in one request — there is no read-modify-write in the client, and
therefore no race and no business logic there.

```bash
mix site update blog.test \
  --proxy /api=http://127.0.0.1:3003/xyz \
  --php   /admin=php-fpm@8.3.33 \
  --files /assets=dist

mix site update blog.test --no-routes
```

`--php /admin` with no `=` is a pool the daemon resolves. `--no-routes` beside any of the three is
refused rather than ordered. `mix site show` prints the routes, longest first, as they will be
matched.

### D13. What MixLab draws

`SiteForm` gains a **Routes** section under the kind: one row per route — path, a target select, the
one field that target needs, a remove button — and an add button. It is the whole of the API surface
and nothing more; the form already sends `kind` as a whole object, and it sends `routes` the same
way. `Sites` shows a route count on a site that has any, so the list answers "does this site have
more behind it" without a second click.

Both dictionaries (`vi`, `en`) gain the keys. The client validates nothing the daemon validates: a
bad path comes back as the daemon's own sentence, which is already how this form reports everything
else.

## Testing

What is measured, rather than asserted about a template:

1. **`crates/mixengine-cli/tests/routes.rs`**, one sequence driven through both front ends —
   `frontend.rs`' rule, and the arrangement `welcome.rs` established. A site with a fallback and
   three routes; two upstreams on two ports; assert `/` reaches the fallback, `/api/x` reaches the
   first upstream unchanged, `/abc/foo` reaches the second as `/xyz/foo`, `/abcdef` reaches the
   fallback, and `/assets/f.txt` is served off disk. `#[ignore]`d like its neighbours, run by the
   suite that downloads the servers.
2. **Rendering tests** in `recipes/caddy.rs` and `recipes/nginx.rs`: routes appear longest-first;
   a proxy route with no upstream path renders no rewrite; a `.` in a path is escaped; nginx renders
   every route location before `location ~ \.php$`.
3. **`caddy validate` on a site whose upstream carries a path** — the bug above, red before the fix.
4. **Daemon validation**: every refusal in D10, each with the input that produces it, including the
   newline injection.
5. **Store**: routes round-trip, replace semantics, the cascade on `site.delete`, and the
   `SET NULL` on a deleted pool.
6. **Manifest**: export → import → export is a fixed point with routes present; capture carries them.
7. **Desktop**: `SiteForm` renders an existing site's routes, adds and removes one, and sends the
   whole list.

## What moved during implementation

- **`routes` is on `SiteSummary`**, not on `SiteDetail` — D7, above.
- **A whole-site proxy's rewrite is built against the empty prefix, not against `/`.** `"/"` would
  produce `^/(/.*)?$`, an expression matching `/` and no path beneath it; the empty prefix produces
  `^(/.*)?$`, which is what `/foo` → `/xyz/foo` needs. Measured on Caddy 2.11.4 before it was
  written.
- **The two front-end templates repeat the route loop rather than sharing a macro.** minijinja's
  `macros` feature is deliberately absent from this workspace's dependency, with the reason written
  into `Cargo.toml`; the repetition is the same one `site.caddy` already makes for its whole handler,
  for the reason stated there.
- **A php-fpm route carries its activator through an `upstream` group of its own on nginx**, named
  after the site *and the route's position* — nginx refuses a configuration declaring one upstream
  name twice, and two routes naming one pool is ordinary. Without it, T70's measured lesson would
  have been silently dropped for routes.
- **A `static` route's root is made relative against the owner's root** by the same call a doc root
  goes through, so a root outside the project is refused in the same words.
- **`PlanAction::CreateSite` carries the routes**, so an applied blueprint creates the site with
  them. There is no `AddRoute` step and there should not be: a route is a column of the site rather
  than a name the hosts file has to learn.

## Risks

- **The nginx renderings in D4 were reasoned, not measured, when this was written** — this machine
  had no nginx installed. They have since been measured: `crates/mixengine-cli/tests/routes.rs`
  drives the same sequence through nginx 1.31.3 and Caddy 2.11.4, both green.
- **One rendering is still asserted rather than served**: the nginx php-fpm route's nested
  `location ~ \.php$`. That suite drives no PHP, so nothing reads that text but `recipes::nginx`. It
  is the shape T124a's leak came from.
- **Two front ends, one claim.** Every behavioural difference found late is a template change in two
  places; the integration suite driving one sequence twice is what keeps that honest.
- **A site is now more than one thing to reason about.** `mix site show` printing routes in match
  order, rather than in the order somebody typed them, is the mitigation that costs nothing.
