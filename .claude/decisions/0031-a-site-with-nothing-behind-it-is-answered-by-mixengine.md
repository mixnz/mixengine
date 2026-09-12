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
- **The condition is asked of the disk, never of the ordering.** The route matches one exact path
  and only while the disk holds none of the index files the site would have served — a `not file`
  matcher on Caddy, the index module's own failure on nginx. An application's own 404
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
- **The two front ends ask the disk with different primitives, and only one of them is safe to
  write the obvious way.** Caddy has a `not file` matcher, which asks without serving. nginx does
  not, and its `try_files` serves the first file it finds *in the current context* — so the obvious
  `location = /` naming `/index.php` ahead of a fallback answers a php-fpm site's home page with
  that site's own source, as text. **T124 shipped exactly that and T124a took it back.** What nginx
  uses instead is the index module, which makes an *internal redirect* when it finds a file, so
  `/index.php` is re-matched by `location ~ \.php$` and runs as PHP; `error_page 403 404` in that
  exact-match location is reached only when the index module found nothing at all. Two tests hold
  the line: one that no `try_files` in the rendering names a `.php` file before its last element,
  and one that a site's home page is never its own source.
- **`alias` may not appear in a named location**, and nginx refuses the whole configuration over it
  — so one page's mistake would take every site on the machine down. The welcome location uses
  `root` with `try_files`.
- What is measured rather than argued is in `crates/mixengine-cli/tests/welcome.rs`, one sequence
  driven through both front ends — Caddy 2.11.4, nginx 1.31.3, PHP 8.4.24: 200 and the page at `/`,
  404 at `/missing` and `/api/anything`, the site's own index answering the moment it is written
  with no reload and no re-render, and its source never served.

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
