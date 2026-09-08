# AGENT.md

Short orientation for agents working on MixDB. Details live in [.agent/](.agent/) — read the
relevant file there before changing anything in that area.

## What this is

MixDB is a desktop app built with **Tauri 2 + React 19 + TypeScript** (frontend) and **Rust**
(backend). It is a **shell** — a tab bar, keyboard shortcuts and a Settings dialog — plus one
**module** per kind of thing a tab can hold. There are three:

- **`db`** — MySQL, PostgreSQL, SQLite, MongoDB, Redis and ClickHouse (read-only) connections,
  optionally through an SSH tunnel, with saved connections remembered.
- **`rest`** — an HTTP client: saved requests, environments, history, and a response pane.
- **`terminal`** — a shell on this machine or on a server over SSH, with saved hosts.

The shell knows nothing about any of them. Adding a fourth is a folder under `src/modules/` and
a line in `src/shell/registry.ts` — see
[.agent/conventions/adding-a-module.md](.agent/conventions/adding-a-module.md).

## Commands

| Command | What it does |
| --- | --- |
| `npm install` | Install frontend dependencies |
| `npm run dev:app` | Run the full desktop app (Vite + Rust, hot reload) — the normal dev loop |
| `npm run dev` | Frontend only in a browser; every `invoke` fails, UI-only work |
| `npm run build` | Typecheck + build frontend (`tsc && vite build`) — the fastest check |
| `npm test` | Run the vitest suite (`vitest run`) |
| `npm run lint` | eslint: hook dependencies, and the rule that nothing outside `src/modules/` imports a module |
| `npm run build:app` | Full production bundle into `src-tauri/target/release/bundle/` |
| `npm run notes` | Commits since the last tag, grouped — a draft for `## [Unreleased]` |
| `npm run set-version <v>` | Bump the six files that carry the version and cut the changelog |
| `npm run icons` | Rebuild `src-tauri/icons/` from the two SVGs in `public/`; macOS gets the padded one |

Releasing is [docs/RELEASING.md](docs/RELEASING.md); the steps are the first section of it. The
app icon, and why there are two logo files, is [docs/ICONS.md](docs/ICONS.md).

There is no linter config. `npm run build` is the fastest verification step; TypeScript runs
`strict`, `noUnusedLocals` and `noUnusedParameters`, so it catches most mistakes. `npm test` runs
vitest over the pure-logic modules (virtual rows, SQL statement splitting and guards, column
parsing, request building, tab badges). None of them say anything about CSS or about whether a
Tauri command is registered — only `npm run dev:app` and a click do.

[.github/workflows/ci.yml](.github/workflows/ci.yml) runs all of it on every push and every
pull request — `build`, `test` and `lint` in one job, `cargo clippy -D warnings` and
`cargo test` in another. Linux only, and it bundles nothing; `release.yml` is still what proves
all three platforms package.

## Layout

```
src/                 React frontend
  main.tsx           Entry point
  shell/             Tab bar, [+] menu, shortcuts, Settings — knows no module
    module.ts        ModuleDefinition, ModuleTabProps, TabBadge — what a module is
    registry.ts      MODULES, DEFAULT_MODULE_ID — the only file outside modules/ that names one
    launch.ts        Tabs the backend asks for — the only other way a tab opens
    App.css          Tokens + chrome + the classes any module may use
  core/              Helpers no module owns and any module may use
  components/        Shared primitives only, one folder each
  icons/  i18n/      Shared icons; the shared dictionaries and dicts.ts, which merges them
  modules/db/        The database module
    DbTab.tsx        Connection form -> connects -> renders one workspace
    sql/             The workspace every SQL engine shares, and the SqlApi/SqlDialect behind it
    mysql/ postgres/ What each SQL engine says for itself: api.ts, dialect.ts, columns.ts
    sqlite/          The third, and the only one with no server behind it
    mongo/ redis/    The two with a workspace of their own: <Kind>Workspace.tsx, api.ts
    components/      This module's own components
    i18n/            This module's own strings
    db.css  types.ts Its global styles; the types mirroring the Rust models
  modules/rest/      The REST client
    RestTab.tsx      Sidebar of saved requests + the request being edited
    api.ts           The only invoke calls here: rest_send, rest_cancel, secrets_*
    *.ts  *.test.ts  The pure halves — building a request, interpolating, parsing a paste
    components/  i18n/  rest.css
  modules/terminal/  The terminal
    TerminalTab.tsx  Target form -> a session -> xterm
    api.ts           terminal_open/write/resize/close, the shell list, and the events Channel
    components/  i18n/  terminal.css
src-tauri/src/       Rust backend
  lib.rs             Tauri builder; reads the opening URL first; each module registers its own state
  error.rs  secrets.rs  ssh/    Shared by every module (the tunnel and open_shell both live in ssh/)
  launch.rs  instance.rs  A connection handed over on the command line, and the channel to a running copy
  modules/
    mod.rs           handler() — every command of every module, one block each
    db/              commands/, drivers/, handoff.rs, models.rs, state.rs
    rest/            commands.rs, models.rs, state.rs
    terminal/        commands.rs, local.rs, remote.rs, stream.rs, models.rs, state.rs
```

## Rules that matter most

- **Frontend never touches a network or a disk.** No driver, no HTTP request, no shell: it calls
  `invoke(...)` through its module's `api.ts` and renders what comes back.
- **Nothing outside `src/modules/<id>/` knows that module's concepts.** No file in `shell/`,
  `core/`, `components/`, `icons/` or `i18n/` may import from `modules/`, with exactly two
  exceptions — `shell/registry.ts` and `i18n/dicts.ts`, the two places a module is joined to the
  app. `tsc` compiles a broken boundary happily, so `npm run lint` is what says no,
  in CI and locally — see [adding-a-module](.agent/conventions/adding-a-module.md).
- **Every user-visible string goes through `t("...")`**, added to both `en.ts` and `vi.ts`.
- **Components use CSS Modules** and live in their own folder — see
  [.agent/conventions/component-structure.md](.agent/conventions/component-structure.md).
- **The root element of a workspace needs `width: 100%`**, not just `height` — `.tab-panel` is a
  row-direction flex container, so a root without it is only as wide as its content and hugs the
  left edge. It comes as a block of five properties, `box-sizing` and the `min-*` pair included:
  [.agent/conventions/workspace-root.md](.agent/conventions/workspace-root.md).
- **A new backend command touches five places.** Follow
  [.agent/conventions/adding-a-command.md](.agent/conventions/adding-a-command.md).
- **Every `std::process::Command` goes through `crate::platform::hide_console`.** Without it
  Windows opens a black console window for the child, which flashes over the app and reads as
  malware to the user. See
  [.agent/conventions/spawning-processes.md](.agent/conventions/spawning-processes.md).
- Commit messages need a `type(scope): message` prefix (see the global rules).
- **Never link to a file under `docs/superpowers/plans/`.** Those are local-only implementation
  plans, gitignored and absent on every other machine. Link to `docs/superpowers/specs/` instead —
  see [.agent/conventions/plans-and-specs.md](.agent/conventions/plans-and-specs.md).
- **`PG_VERSION` in `src-tauri/src/modules/db/drivers/tools.rs` expires every September.** `pg_dump` will not dump a
  server newer than itself, and nothing in the build says so. Bumping it, or any other pinned
  download, follows
  [.agent/conventions/bumping-tool-downloads.md](.agent/conventions/bumping-tool-downloads.md).
- **A change a user would notice gets a line in `## [Unreleased]`** in
  [CHANGELOG.md](CHANGELOG.md), under `### Added`, `### Changed` or `### Fixed`, written as part of
  the work rather than at release time. Follow
  [.agent/conventions/changelog.md](.agent/conventions/changelog.md) — one short line each, and a
  fix to something still unreleased is not a `Fixed` entry. That section becomes the release notes,
  see [docs/RELEASING.md](docs/RELEASING.md).

## Where to read more

- [.agent/architecture/overview.md](.agent/architecture/overview.md) — process model, connection lifecycle
- [.agent/architecture/frontend.md](.agent/architecture/frontend.md) — React structure and patterns
- [.agent/architecture/backend.md](.agent/architecture/backend.md) — Rust structure and patterns
- [.agent/conventions/](.agent/conventions/) — code conventions, and how changelog entries are written
