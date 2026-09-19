# Demo screenshots

`npm run screenshots` renders MixLab's promotional images from sample data: the real frontend in
Chromium, every IPC call answered by `apps/desktop/demo/fixtures/`. The design is
[the spec](../../../docs/superpowers/specs/2026-09-17-marketing-screenshots-design.md).

```bash
npm run screenshots                                   # every scene, dark and light, macOS frame
npm run screenshots -- --scene database --theme dark  # one image
npm run screenshots -- --platform windows             # Windows title bar and Ctrl shortcuts
npm run screenshots -- --check                        # verify every scene, write nothing
```

The first run on a machine needs `npx playwright install chromium`. Images land in
`apps/desktop/screenshots/out/{raw,framed}/`, which is gitignored; a full run empties it first.

## Reading a failure

Each failed scene lists why:

| Line | Meaning | What to do |
| --- | --- | --- |
| `unmocked   <cmd> <args>` | The screen called a command no fixture answers | Add a handler for `<cmd>` — below |
| `app error  …` | The app logged an error: usually it crashed on a fixture's shape | Fix the fixture, not the app |
| `pageerror  …` | An exception escaped the page — an unanswered command rejects this way too | Read it; it is almost always a fixture |
| `failed     not ready after 20000 ms (…)` | An IPC call or a request never settled, or something redraws on a timer | Answer the listed command; stop the timer through its setting |
| `failed     locator…: Timeout` | A scene's `act` did not find its element | Update the `act` in `demo/scenes.mjs` |

`console` lines are printed for context and never fail a scene.

A scene is ready when the app has mounted into `demo.html`'s `#root` and IPC calls, network
requests and DOM mutations have all gone quiet. Network requests count because a cold Vite server
can spend seconds transforming a lazily imported screen while the page does nothing else.

## Adding a fixture for a new command

1. Find the call: `rg -n '"<cmd>"' apps/desktop/src`. The `invoke<T>` there names the type.
2. Add `"<cmd>": returns<T>(value)` to the module's file in `demo/fixtures/` — MixEngine types
   come from `@mixengine/api`, the others from `src/modules/<id>/types.ts`. A handler that needs
   its arguments is `(args): T => …`. A command that streams through a `Channel` gets it as an
   argument and calls its `onmessage` after returning.
3. A file a module reads through `@tauri-apps/plugin-store` is seeded in that fixture's
   `…Files` export, keyed by file name and then by store key.
4. Derive every time from `NOW` in `fixtures/time.ts`, never `Date.now()`, and never use
   `Math.random` — the same run must give the same image.

`npm run build` type-checks the fixtures against the contracts, so a reshaped type fails there.

## Adding or changing a scene

A scene in `demo/scenes.mjs` is a module id, the session slot that module restores, an optional
`act`, and the copy the frame prints. `demo/scenes.test.mjs` runs each slot through its module's
parser, so a change to how a tab restores fails `npm test` first. The MixEngine tab restores no
screen — it always opens on Dashboard — so its scenes carry no slot and reach another screen in
`act`, through the sidebar button's `data-screen`, which is the screen's id.

An `act` may press a shortcut the module registers, find text the fixtures own, or take the only
element of its kind. Never interface copy and never a CSS class: those are what a redesign changes.
