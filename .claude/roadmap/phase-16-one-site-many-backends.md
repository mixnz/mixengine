# Phase 16 — One site, many backends

*Goal: one site forwards different path prefixes to different backends — several ports, a php-fpm
pool, a directory on disk — and a prefix may be rewritten on the way out.*

Part of the [build plan](todo.md). Legend: `[ ]` todo · `[~]` in progress · `[x]` done · **(P)** =
has a platform-layer component and needs verification on Windows + macOS + Linux.

Design: [2026-09-15-t135-one-site-many-backends-design.md](../../docs/superpowers/specs/2026-09-15-t135-one-site-many-backends-design.md).

---

**One complaint from somebody using the finished product:**

> 1 site cần có thể proxy vào nhiều port (hoặc cả fpm) trên nhiều location khác nhau, hiện tại 1
> site chỉ đang có thể proxy vào 1 kênh duy nhất
>
> ngoài ra cũng cần cho chỉnh proxy theo dạng /abc vào http://127.0.0.1:3003/xyz

Two things, and the second is not a refinement of the first: a single-backend site already wants a
prefix that differs on the two sides of the proxy, and a multi-backend site is unusable without one,
because two applications mounted at `/` cannot both keep their own idea of where they are.

Underneath both is one shape: `SiteKind` is a value on a row, so a site is one handler rooted at `/`,
and there is nowhere a second address could go. This phase makes a site **a kind plus an ordered set
of routes**, where the kind is what answers everything no route matched — so a site with no routes
renders what it renders today, byte for byte.

**And it closes two holes found while reading for it.** A path in a `reverse-proxy` upstream is
accepted by the daemon and refused by Caddy, which fails the one `caddy validate` the whole rendering
is judged by — so one mistyped URL leaves *every* site on the machine with its old configuration. And
an upstream is rendered verbatim into a Caddyfile with no check for a newline.

## The shape

- [ ] **T135** `SiteRoute` on the wire, in the database, and in the store. `RouteTarget` flattened
      the way `SiteKind` is, so one definition reads a JSON-RPC member and a flat `[[site.routes]]`
      table; migration `0023_site_routes.sql` with `ON DELETE CASCADE` to the site and
      `ON DELETE SET NULL` to the pool; `core::sites` reads and replaces the list as a whole;
      `SiteDetail.routes` optional on the wire ([ADR 0019](../decisions/0019-an-added-response-member-is-optional.md)).

- [ ] **T136** What the daemon refuses. A path whitelist, a cap of 32 routes, duplicate paths, `/`
      as a path — and the character whitelist on an upstream, which is the injection hole above.
      A `php-fpm` route naming no pool is resolved the way `site.create` resolves one.

## What each front end serves

- [ ] **T137** Caddy. `served::ServedRoute`, routes rendered longest-first inside the site block
      ahead of the fallback, `uri path_regexp` for the rewrite — one directive, because Caddy sorts
      `rewrite` *before* `uri` and the readable-looking pair runs backwards. **And the path in an
      upstream, which is the bug**: it becomes a rewrite rather than an upstream Caddy refuses.

- [ ] **T138** nginx. A regex `location` per proxy route ahead of `location ~ \.php$`; a
      `= /x` + `^~ /x/` pair for the file-serving targets, with the PHP handler **nested** inside the
      prefix location — `^~` stops the sibling regex search, so a handler beside it would never be
      reached and `try_files` would serve the source as text.

## Saying it and typing it

- [ ] **T139** `mix site create` / `mix site update` take `--proxy`, `--php`, `--files` and
      `--no-routes`, each building the whole list in one request — no read-modify-write in the
      client. `mix site show` prints the routes in match order rather than in the order they were
      typed.

- [ ] **T140** A route survives a round trip: `[[site.routes]]` written by `project.export`, read by
      the import, and carried by `blueprint.capture`. No shipped gallery manifest gains one, so
      `mixengine-packages` needs no re-publish.

- [ ] **T141** MixLab draws it. A Routes section in the site form — path, target, the one field that
      target needs — a route count in the list, and both dictionaries.

- [ ] **T142** Measured through both front ends, and written down. One sequence driven twice
      (`frontend.rs`' rule): a fallback and three routes, two upstreams on two ports, the rewrite,
      the segment boundary, and a file off disk. Then the feature document,
      [client-surface.md](../features/client-surface.md) §2, and an ADR for the shape a site now has.

**Milestone M16** — one site answers `/` from its own document root, `/api` from a port, `/abc` from
another port as `/xyz`, and `/assets` from a directory, identically on Caddy and on nginx.
