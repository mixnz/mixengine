# T124 — a site with nothing behind it says so (design)

Proposed roadmap task **T124**, phase 14, following T123: *"A site whose front end has nothing to
serve answers with a page that says which site this is and what is missing, instead of a bare 404 or
a bare 502 — for every site, not only the ones a blueprint made."*

## What was observed, and how

Read out of `core::blueprints::plan`, `api/apply.rs` and the two front-end templates rather than
measured in a browser — measuring it is this task's first step, and the Testing section says so.

An apply of a blueprint with no `[scaffold]` ends with an empty directory, by construction:

- `PlanAction::RegisterProject` calls `paths::create_dir` on a root that does not exist yet
  (`crates/mixengine-daemon/src/api/apply.rs:270`) and then `projects.create`. **The root is made by
  this step and nothing else writes into it** — of the ten `PlanAction` variants, only `RunScaffold`
  puts a byte inside the project.
- `projects.create` writes no `mixengine.toml`. Pins live in SQLite, so there is not even that.

Three of the six shipped blueprints carry no scaffold on purpose — `wordpress`, `django`, `static`
— and the reasoning in [blueprints.md](../../../.claude/features/blueprints.md) says why: a gallery
command may not write into a shared runtime, which is what removed Django's. So *the empty directory
is the designed outcome for half the gallery*, not an accident to be scaffolded away.

What the front end then answers, per kind, read from the templates:

| Kind | What is rendered | With nothing there |
| --- | --- | --- |
| `php-fpm` | `try_files $uri $uri/ /index.php?$query_string` → the pool; `php_fastcgi` + `file_server` | 404 |
| `static` | `try_files $uri $uri/ =404` / `file_server` | 404 |
| `reverse-proxy` | `proxy_pass` / `reverse_proxy` to the upstream | 502 |
| `node-app` | the same | 502 |

**And this is not a blueprint problem.** `mix site create` against an empty directory reaches the
same 404, and a `node-app` site on a machine that has just booted reaches the same 502 every single
time — the dev server is not running yet, which is the most ordinary state that site has. The
product has one moment where it is most likely to be judged, and today that moment is a web server's
default error page.

`SiteKind::NodeApp` is documented as *"A declaration and no more. Nothing in this build starts
`npm run dev`"*, so the 502 cannot be removed by starting something. What can be removed is the
*silence* around it.

## Goal

A site whose front end has nothing to serve answers with a MixEngine page naming the site, its kind,
and the one thing that is missing. It appears only where there is genuinely nothing, it stops
appearing the moment there is something, and it never writes a file into anybody's project.

## Scope

**In:**

- One welcome document per site, rendered beside that site's configuration by whichever front end
  is running, and swept with it.
- The four site kinds, in two shapes: the root path for `php-fpm` and `static`, the upstream failure
  for `reverse-proxy` and `node-app`.
- Both front ends. Caddy and nginx are two renderings of one behaviour, measured separately.
- Every site, whatever made it — `blueprint.apply`, `site.create`, or an import.
- One home-wide setting to turn it off.

**Out:**

- `[blueprint] next_steps`, or any change to the manifest. The page derives its sentence from the
  site's *kind*, which every site has; a blueprint's own words are an addition and a separate task.
- Any change to the blueprint gallery, to `blueprint.apply`, or to the `[scaffold]` rules. This task
  is what makes a scaffold-free blueprint a good experience; it does not make one run a command.
- Writing anything into a project directory. See D1 — this is the decision the task turns on.
- A per-site switch. See D6.
- Translating the page. One language, and the reason is in D7.
- Serving a welcome page for a site that is `disabled`. A disabled site renders no server block at
  all, and giving it one would be this feature inventing traffic for a site somebody turned off.

## Decisions

### D1 — It is served, never written

The page is a document the front end serves. Nothing is written into the project directory, ever.

The alternative — an `index.html` dropped into the docroot after an apply — is cheaper and wrong
here. This workspace has one standing rule about a user's files and it is repeated in three places:
a rollback keeps the project's directory, `project.delete` keeps it, and the apply ledger records it
as `Kept::Directory` on the grounds that *the files were never ours*. A file MixEngine put there
would be a file the user finds in `git status` and cannot explain, and it would have to be cleaned
up by something later — which is the same rule again, from the other side.

Serving it also gets two properties for free that writing cannot have: it **disappears by itself**
the moment the user's own index exists, and it works for `reverse-proxy` and `node-app`, where no
file in any directory would change what a dead upstream answers.

### D2 — Rendered into `welcome/`, not into `public/`

Each site's page is rendered as `welcome/<primary>.html` under the front end's own configuration
directory, on `SITES`' pattern: one document per site, named by the primary domain, swept by the
pass that removes what the recipe stopped rendering.

**Not into `public/`**, which is where T75 renders the public certificate authority. That directory
is asserted to hold exactly one file — `the_front_end_renders_the_public_authority_and_nothing_beside_it`
in `generate/recipes/caddy.rs` — and the reason is that the front end is pointed at the *directory*,
so what else is in it is what else is published. The assertion is about the authority and should
stay about the authority; a second feature moving in weakens it to nothing, and the next person
reading it cannot tell which file the rule was for.

### D3 — For `php-fpm` and `static`: the root path only, and only after the site's own index

The welcome page is reachable at exactly `/`, after the site's own index files have been looked for
and not found. Every other path answers what it answers today.

**An application's 404 is an answer, and replacing it would be MixEngine lying about somebody else's
program.** A catch-all error handler is the obvious implementation and it is the one that breaks an
API that mounts nothing at `/` but everything under `/api` — a shape this product's own users have,
since a `php-fpm` site serving a JSON API is ordinary. `location = /` in nginx and an exact-path
matcher in Caddy cost one block each and cannot reach a path the application owns.

**The condition is asked of the disk and never of the ordering** — which is what T124 got wrong and
T124a corrected, twice over. In Caddy, `php_fastcgi` and `file_server` are not in the mutually
exclusive group `handle` blocks form, so a route placed after them is not reliably reached; the whole
question moves into a `not file` matcher. In nginx there is no such matcher, and the obvious
`try_files /index.php … @welcome` is worse than wrong: `try_files` serves what it finds *in the
current context*, and that location has no `fastcgi_pass`, so a site with an `index.php` answers its
home page with its own source. What nginx uses instead is the index module, whose internal redirect
sends `/index.php` back through `location ~ \.php$` — and whose failure, 403 for a document root
that exists and 404 for one that does not, is what `error_page` picks up.

### D4 — For `reverse-proxy` and `node-app`: 502 and 504, at any path, and never an upstream's own

A request the front end could not deliver to the upstream — connection refused, no route, timeout —
answers with the welcome page, whatever the path.

Wide is safe here in a way it is not in D3: a 502 the front end generated means **nothing was
listening**, so there is no application whose answer is being overwritten. There is no shape of
application that relies on MixEngine failing to reach it.

**But an upstream's own 502 must pass through untouched.** In nginx that is the difference between
`error_page 502 504 = @welcome;`, which handles the errors nginx itself produced, and
`proxy_intercept_errors on`, which additionally captures a 502 the application *sent* — a gateway of
the user's own, behind this one, reporting its own upstream. This task sets the first and
deliberately does not set the second. Caddy's `handle_errors` has the same split and the same
answer.

### D5 — The page names no absolute path and no database identifier

It carries: the site's primary domain, its kind in words, the docroot **relative to the project
root** (`public`, `web`, `dist`, or "the project root" when it is the root), the upstream address for
a proxy kind, and one sentence saying what to do next.

It carries no absolute filesystem path, no database name, no account name, no service id.

**Because a shared site's welcome page is on the LAN.** T74 appends the interface address to a shared
site's `bind`, and T75 advertises `<slug>-mixengine.local`; a phone on that network can fetch this
page. `C:\Users\haiqu\Developer\blog` and a database account named after the project are facts about
the machine, and a page that hands them to anybody who can reach port 80 is an information leak this
feature was never asked to introduce. The relative docroot is the one detail that is both useful and
already implied by the site itself.

The detailed view of a site is `mix site show`, on a transport that is a local socket.

### D6 — One setting for the home, none for the site

`[sites] welcome_page` in `config.toml`, default on. There is no per-site field, no column on
`sites`, and no flag on `site.create` — and no `mix config set` either, because `config.toml` is a
file the user edits by hand, which `core::config` states as the whole point of its existing: *"the
user's preferences, read once at boot… a small, commented TOML file rather than a hidden database
row"*.

D3 and D4 are what make this enough. The page cannot appear on a site that serves anything at `/`
or has anything listening, so the population that wants it off is not "this site" but "this
machine's owner does not want it" — someone whose tests assert a bare 404, or who finds it
patronising. A per-site answer would be a migration, a wire field, a CLI flag, a desktop control and
a capture/apply question in `blueprints`, for a distinction nobody has asked for yet. It can be
added later without changing anything decided here; it cannot be taken away once shipped.

### D7 — One self-contained HTML file, compiled in, one language

The page is a compiled-in template in `mixengine-core` — `blueprints::gallery`'s D1, for its reason:
what this build ships is a constant of this build, not a document it fetches or a file the user is
invited to edit and then owns forever.

It is **one file with no external reference**: inline CSS, no font, no image, no script. A machine
that has just installed MixEngine may have no connection, the page is served over a private CA that
a browser may be complaining about already, and every asset that fails to load is a broken page at
the exact moment this feature exists to make a good impression. `prefers-color-scheme` is two rules
and is worth having.

**English only.** The product's documentation is written in two languages (`docs/guide/en`,
`docs/guide/vi`) and this page is not documentation — it is six lines of interface. Translating it
means deciding what picks the language, on a request from a browser whose `Accept-Language` is not a
statement about the person who installed MixEngine. That is its own task if it is ever wanted.

### D8 — `Cache-Control: no-store`

The response is uncacheable, explicitly.

This is the bug this feature would otherwise ship with: a browser that cached the welcome page at
`https://blog.test/` keeps showing it after the user writes their `index.php`, the site looks broken
in exactly the way the page exists to prevent, and the reflex — hard refresh — is one most people
reaching this page do not have. It costs one header in each template.

### D9 — No new lifecycle

The welcome document is rendered by the front-end recipe from the same `SiteRendering` the site's
configuration is rendered from, in the same pass, and is compared and installed by `document::install`
like every other generated file. A site that changes re-renders it; a site that goes takes it with
it; `etc/` stays disposable.

Nothing new watches the docroot. The page's appearance is decided per request by the front end, not
per render by the daemon — which is what makes D3's "disappears the moment there is something" true
without anything having to notice that it happened.

## Testing

The two front ends are two implementations, so each assertion below is made twice.

**Rendered, in the recipe's own tests:**

- All four kinds render the block their kind gets and not the other one's.
- A `php-fpm` site's welcome block is an exact-path match, and the site's own index files are named
  before the fallback in it.
- A `reverse-proxy` site's block names 502 and 504, and **`proxy_intercept_errors` is absent** — a
  negative assertion, because the failure it guards against is a directive somebody adds later
  believing it belongs.
- `Cache-Control: no-store` is on the response the welcome block produces.
- The rendering contains no absolute path and no database identifier (D5), asserted against a
  fixture whose project name and docroot would both show up if it did.
- `welcome/` and `public/` are separate directories, and the T75 assertion that `public/` holds one
  file still passes unchanged.
- With the setting off, no welcome block and no welcome document are rendered at all.

**Served, with a real front end — the measurement this spec owes:**

- A `php-fpm` site with an empty docroot answers 200 with the welcome page at `/`, and **404 at
  `/missing`** and at `/api/anything`.
- The same site, after an `index.php` is written into the docroot, answers the application at `/`
  with no re-render and no reload.
- A `static` site behaves the same way with `index.html`.
- A `node-app` site with nothing on its port answers 200 with the welcome page at `/` and at
  `/deep/path`; with a server listening, it answers the server at both.
- A `reverse-proxy` site whose upstream **is** listening and itself returns 502 passes that 502
  through — the D4 negative case, and the one a wide handler gets wrong.

**End to end:** `blueprint.apply static` on a fresh home, then open the domain — a page, not a 404.
This is the acceptance criterion the whole task is for and it belongs beside the blueprint
end-to-end tests already in `crates/mixengine-core/tests/blueprint_gallery.rs`.

## What this closes, and where it is written

- Roadmap task **T124** in
  [.claude/roadmap/phase-14-a-window-a-new-user-can-start-from.md](../../../.claude/roadmap/phase-14-a-window-a-new-user-can-start-from.md),
  where milestone M14 already promises *"a browser open on a working `https://<name>.test`"*. Today
  that promise holds only for a site somebody has already put code into.
- An ADR in [.claude/decisions/](../../../.claude/decisions/): **a site with nothing behind it is
  answered by MixEngine, not by the web server's default page**. It is cross-cutting — it changes
  what every generated site configuration contains, for homes that already exist — so it is a
  decision record and not a template edit.
- [.claude/features/blueprints.md](../../../.claude/features/blueprints.md) gains one sentence under
  *Apply*: an apply that writes no source code still ends at a page, and a blueprint with no
  `[scaffold]` is a complete blueprint rather than half of one.
