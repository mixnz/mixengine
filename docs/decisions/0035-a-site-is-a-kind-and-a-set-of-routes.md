# 0035. A site is a kind and a set of path routes, and the kind answers whatever no route matched

**Status**: Accepted
**Date**: 2026-09-15

## Context

A site was one handler. `SiteKind` is a value on a row, the two front-end templates render exactly
one handler rooted at `/`, and there was nowhere a second address could go — so the ordinary shape
of a modern application, a JavaScript dev server at `/` with an API on another port under `/api`,
could not be described at all.

The complaint that produced this was two sentences, and the second is not a refinement of the first:

> 1 site cần có thể proxy vào nhiều port (hoặc cả fpm) trên nhiều location khác nhau
>
> ngoài ra cũng cần cho chỉnh proxy theo dạng /abc vào http://127.0.0.1:3003/xyz

A single-backend site already wants the second, and a multi-backend site is unusable without it:
two applications mounted at `/` cannot both keep their own idea of where they are.

**Reading for it found the same question already answered two different ways.**
`upstream_is_an_address` accepts a path on purpose — its own test lists `http://127.0.0.1:3000/api`
among the good ones — and the two front ends disagree about what that URL means. nginx reads it as a
prefix replacement. Caddy refuses it outright:

```
parsing upstream 'http://127.0.0.1:3003/xyz': for now, URLs for proxy upstreams only support
scheme, host, and port components
```

The whole rendering is judged by one `caddy validate` where it is staged, so that site did not fail
alone: **every site on the machine kept its old configuration**, because one person typed a URL with
a path.

Design: [docs/superpowers/specs/2026-09-15-t135-one-site-many-backends-design.md](../../docs/superpowers/specs/2026-09-15-t135-one-site-many-backends-design.md).

## Decision

**A site is a kind plus an ordered set of path routes. The kind keeps its meaning and gains one
sentence: it is what answers everything no route matched.**

- **Routes live beside `SiteKind`, not inside it.** A site with no routes renders what it rendered
  before, byte for byte, and the twenty-three files that name `SiteKind::` are untouched. The
  consequence worth stating is that **`/` is not a path a route may take**: what answers `/` is the
  kind, and a second answer to a question that has one is a state nothing should be able to spell.
- **Three targets**: a proxy, a php-fpm pool, a directory. `node-app` is not a fourth — a port is an
  address, and a second way to write one is a second thing to keep in step.
- **One rewriting rule, and it is the upstream's own path.** The matched prefix is replaced by the
  upstream's path with any trailing slash removed; an upstream with no path replaces nothing. One
  field carries it, which is the point: every alternative state is already spellable in the URL a
  person was going to type, and two fields is two things that can disagree.
- **Overlap is resolved by specificity where the configuration is rendered** — longest prefix first,
  duplicate paths refused. Caddy takes its handlers in order and nginx has location precedence of
  its own; sorting once, in `core::sites::by_specificity`, is what means neither front end is ever
  asked to decide, and therefore that neither can decide differently.
- **A path and an upstream are both configuration, and both are validated as a whitelist.** A path
  is an absolute prefix whose segments are drawn from `A-Za-z0-9-_.~%`; an upstream may hold no
  control character, no whitespace and none of `` ` `` `"` `'` `{` `}` `\` `;` `<` `>` `|`. At most
  32 routes per site, at most 255 bytes per path. Refused, never escaped.

## Consequences

- **A path in a proxy upstream is a rewrite on both front ends**, and the configuration-injection
  hole beside it is closed. `http://h\n}\nadmin 0.0.0.0:2019 {` was a valid string, a valid JSON
  member and a second server on Caddy's admin port; it is now four words of refusal.
- **`.` is a regex metacharacter and a path segment may hold one.** Both renderings escape it where
  it reaches a regex, and both are tested for it: without that, `/v1.0` would also take `/v1X0`.
- **nginx renders a file-serving route as a pair of prefix locations with its PHP handler nested
  inside.** `^~` stops the sibling regex search, so a handler written beside it would never be
  reached and `try_files $uri` would answer `/admin/x.php` with its own source, as text — T124a's
  leak, in a new place.
- **A route whose pool has gone loses the route, not the site.** The opposite of the site-level rule,
  on purpose: a site with no pool has nothing left to serve, while a route is one prefix of a site
  that still has a root, a kind and possibly four other routes.
- **A dead upstream is still answered at every path**, which is what
  [ADR 0031](0031-a-site-with-nothing-behind-it-is-answered-by-mixengine.md) already claimed before a
  site had more than one upstream to be dead. nginx's proxy routes carry the same
  `error_page 502 504` the site-wide one does — `error_page`, never `proxy_intercept_errors`, so an
  upstream's *own* 502 passes through untouched.
- **Routes travel.** `[[site.routes]]` is written by `project.export` and by `blueprint.capture`, read
  by the import, and carried through a plan so an applied blueprint creates the site with them. No
  shipped gallery manifest gains one, so `mixengine-packages` needs no re-publish.
- What is measured rather than argued is `crates/mixengine-cli/tests/routes.rs`, one sequence driven
  through both front ends — Caddy 2.11.4 and nginx 1.31.3: `/` from the site's own files, `/api/x`
  forwarded unchanged, `/abc/foo` arriving as `/xyz/foo`, `/api/deep/thing` taken by the longer
  prefix whatever order it was typed in, `/assets/app.css` off disk, `/abcdef` never reaching
  `/abc`, and a route removed ceasing to answer.

## Alternatives rejected

- **A fifth `SiteKind` variant, `Routed { routes }`.** Every exhaustive match over `SiteKind` would
  have to decide what a routed site's *fallback* is, "add a route" would become a change of kind so a
  php-fpm site would stop being one, and the welcome page — which renders a different sentence per
  kind — would have no kind to describe.
- **A separate `strip` / `keep` / `replace_with` field beside the upstream.** Two fields that can
  disagree, for states the URL already spells.
- **Resolving overlaps with each front end's native rules.** Caddy's handler order and nginx's
  location precedence are two different answers to one question, and a site would then behave
  differently depending on which server a home happens to run.
- **A document root of its own for a php-fpm route.** `alias` beneath `fastcgi_pass` is the nginx
  footgun that leaves `SCRIPT_FILENAME` pointing at nothing and a blank page rather than an error,
  and a flag carrying a path, a pool *and* a root is a grammar nobody can remember. A tree that
  genuinely lives elsewhere is a second site, which costs one command.
