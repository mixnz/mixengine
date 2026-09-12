# 0031. A site with nothing behind it is answered by MixEngine, not by the web server's default page

**Status**: Accepted
**Date**: 2026-09-13

## Context

The most likely moment for this product to be judged is the first time a browser is pointed at a new
site, and until now that moment was a web server's default error page.

It is the ordinary outcome rather than an edge case. `blueprint.apply` creates the project's root
directory and writes nothing into it — of the ten `PlanAction` variants only `RunScaffold` puts a
byte inside a project, and `projects.create` writes no manifest because pins live in SQLite. Three of
the six shipped blueprints carry no `[scaffold]` **on purpose**: a gallery command may not write into
a shared runtime, which is the rule that removed Django's. So for half the gallery, "a configured
site over an empty directory" is the designed result.

It is not a blueprint problem either. `mix site create` against a directory nobody has written to
reaches the same 404, and a `node-app` site on a machine that has just booted reaches a 502 every
single time — `SiteKind::NodeApp` is documented as *"A declaration and no more. Nothing in this build
starts `npm run dev`"*, so that 502 cannot be removed by starting something. What can be removed is
the silence around it.

Design: [docs/superpowers/specs/2026-09-13-t124-a-site-with-nothing-behind-it-says-so-design.md](../../docs/superpowers/specs/2026-09-13-t124-a-site-with-nothing-behind-it-says-so-design.md).

## Decision

**A site with nothing to serve answers with a page MixEngine renders, for every site on every home,
and the page is served rather than written.**

- One document per site, `welcome/<primary>.html`, rendered beside that site's configuration by
  whichever front end is running and swept with it. Nothing is ever written into a project directory:
  a rollback keeps that directory, `project.delete` keeps it, and the apply ledger records it as
  `Kept::Directory` on the standing rule that *the files were never ours*.
- **The condition is a matcher's, never an ordering's.** The route matches one exact path and only
  while the disk holds none of the index files the site would have served. An application's own 404
  is an answer, and replacing it would be MixEngine lying about somebody else's program.
- **A dead upstream is answered at every path**, on 502 and 504 only. There a gateway error means
  nothing was listening, so there is no application answer being overwritten — but an upstream's
  *own* 502 passes through untouched, which is why nginx renders `error_page` and never
  `proxy_intercept_errors`.
- The page names no absolute path, no database name and no account name. A shared site binds its
  interface address (T74) and answers to an mDNS name (T75), so a phone on the local network can
  fetch it.
- One home-wide switch, `[sites] welcome_page` in `config.toml`, default on. There is no per-site
  field: the page cannot appear on a site that serves anything, so the population that wants it off
  is a machine's owner rather than a site.

## Consequences

- **Every generated site configuration changes, on homes that already exist.** That is what makes
  this a decision record rather than a template edit — the next start re-renders every site, and a
  drift check must see the same rendering an install writes, which is why the switch reaches the
  generator rather than being read inside a recipe.
- A browser is told `no-store`, so the page cannot outlive the index that replaces it.
- **The php-fpm kind is not covered on nginx**, and that is recorded here rather than left to be
  discovered. nginx's `try_files` serves the first file it finds *in the current context*, so a
  `location = /` naming `/index.php` ahead of the fallback would serve that file with no
  `fastcgi_pass` behind it — the site's own source, as text, on its home page. Caddy's `not file`
  matcher asks the disk without serving anything and nginx has no equivalent; `error_page 404` is
  what the decision above refuses. A static site and a proxied one get the page on both front ends;
  a php-fpm site gets it on Caddy and waits, on nginx, for a mechanism that cannot leak.
  `a_php_site_renders_no_welcome_route_until_one_cannot_leak_its_source` is what stops the obvious
  rendering coming back.
- What is measured rather than argued is in `crates/mixengine-cli/tests/welcome.rs`, against Caddy
  2.11.4 and PHP 8.4.24: 200 and the page at `/`, 404 at `/missing` and `/api/anything`, and the
  site's own index answering the moment it is written, with no reload and no re-render.

## Alternatives rejected

- **Writing an `index.html` into the document root after an apply.** Cheaper, and it leaves a file
  the user finds in `git status` and cannot explain, which something then has to clean up — the same
  rule the decision rests on, from the other side. It also does nothing for `reverse-proxy` and
  `node-app`, where no file in any directory changes what a dead upstream answers.
- **A catch-all error handler.** It passes the empty-site test and fails the one that matters: an
  API mounting nothing at `/` and everything under `/api` would have its own 404 replaced.
- **Giving every gallery blueprint a `[scaffold]`.** There is no scaffold for plain PHP, `gem install
  rails` writes into a shared runtime, and `needs_empty_dir` would block the case where somebody
  clones a repository and then applies a blueprint over it.
- **A per-site switch.** A migration, a wire field, a CLI flag, a desktop control and a capture
  question, for a distinction nobody has asked for. It can be added later; it cannot be taken away.
