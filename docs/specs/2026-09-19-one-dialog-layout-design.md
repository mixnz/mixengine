---
status: implemented
date: 2026-09-19
---

# One dialog layout for every modal in MixLab

**Scope:** `apps/desktop/src` only. No daemon, no contract, no Rust.

## Problem

`Modal` (`components/Modal/Modal.tsx`) shares a dialog's *behaviour* — overlay, portal, Escape,
focus trap — and `components/Modal/surface.module.css` shares its *skin* — centred, surface colour,
border, shadow, motion. Everything else is written again by each of the 26 callers:

- the width — 19 different values, from 420px to 1100px;
- the height cap — `calc(100vh - 3rem)`, `80vh`, `min(32rem, …)`, or none at all (ConfirmDialog,
  DumpDialog, AddDomain, Share, Cleanup, Credential, Uninstall, AfterApply grow until they touch the
  top and bottom of the window);
- padding (`22px 24px`, `20px 22px`, `1rem`, `0`) and gap (`12px`, `16px`);
- the title, the header ✕ (6 dialogs, each its own button), the body, the error block (the same
  15 lines copied into ~18 sheets) and the action row (`.actions` or `.buttons`);
- who scrolls: in ~15 dialogs the whole `.dialog` is the scroll container, so on a long form
  (SiteForm, ProjectForm, ApplyDialog, IndexDialog…) **Save and Cancel are only reachable after
  scrolling to the bottom**. Two forms work around it with `actionsRef.scrollIntoView`.

So dialogs drift, and a change meant for all of them has to be made 26 times — and is not.

## Goal

- Every dialog is built from the same parts and laid out by one stylesheet: **a change made once in
  `components/Modal/` reaches every dialog.**
- **Title, errors and buttons are always on screen; only the body scrolls.**
- **No dialog ever touches the top or bottom edge of the window.**
- Width is one of three sizes, not a number each caller picks.
- Every dialog has a ✕.
- The buttons at the foot of a dialog are **data, not markup**: one `actions` prop, one button size,
  and `Modal` decides which side each button sits on.
- A test stops a new dialog from laying itself out by hand again.

## Design

### `Modal` owns the frame

`Modal` stops taking `overlayClassName` and `className`. It draws the overlay and the panel with the
shared surface classes itself, and takes instead:

| Prop | Values | Meaning |
| --- | --- | --- |
| `size` | `"small"` \| `"normal"` \| `"large"` — default `"normal"` | The width, see *Sizes*. |
| `title` | `ReactNode` | Drawn by `Modal` in the header, beside the ✕. Replaces every caller's own `<h3>`. `label` (the accessible name) defaults to it when it is a string. |
| `fixedHeight` | `boolean` | The panel is always as tall as its cap instead of fitting its contents — for dialogs whose body is a list or a split pane that scrolls on its own. |
| `layer` | `number` | The z-index layer, for the one dialog that must sit above another (CellDialog, 82). Replaces `--dialog-layer` in a caller's CSS. |
| `actions` | `ModalAction[]` | The buttons at the foot of the dialog — see *Actions*. Omitted: no action row (Settings, the history and environment lists). |
| `footerNote` | `ReactNode` | A short live status drawn at the left of the action row: ElevationDialog's "Waiting for the system prompt…", CredentialDialog's "Copied". |
| `closable` | `boolean` — default `true` | `false` removes the ✕ **and** Escape and the overlay click: a dialog the user must answer. No dialog uses it today; it exists so that choice is made in one visible place. |

`locked` keeps its meaning and now covers the ✕ too: while a request is in flight the ✕ is disabled,
exactly as Escape and the overlay already go quiet.

### The ✕ — on every dialog

Drawn by `Modal` in the header's right corner (`CloseIcon`, `aria-label` = `common.close`), closing
through the same `close(onClose)` path — and the same exit animation — as Escape. Every dialog gets
it without a line of its own; the six hand-made ✕ buttons (CellDialog, Settings, Query history,
Query snippets, REST history, REST environments) are deleted.

### Sizes

| Size | Width | Dialogs (today's width) |
| --- | --- | --- |
| `small` | 460px | Cleanup (420), Confirm (440), Dump (440), AddDomain (440), Share (440), Import (460), Capture (460), ServiceForm (460), AfterApply (460), NameDialog (480), OrderBy (480), UninstallConfirm (480), PlanDialog (480) |
| `normal` | 600px | ApplyDialog (540), ProjectForm (560), ElevationDialog (560), SiteForm (580), IndexDialog (620), SkipIndexDialog (620), CellDialog (640), ColumnDialog (680), Query history & snippets (720), REST environments (736) |
| `large` | 900px | REST history (800), Settings (840), InsertDocumentsDialog (900), InsertRowsDialog (1100) |

Each size is still `min(<width>, calc(100vw - 2rem))`, so a narrow window never cuts a dialog.
Every dialog is assigned the size nearest its current width. The one that loses real width is
**InsertRowsDialog** (1100 → 900): its row grid already scrolls sideways, so it gains a scrollbar
sooner rather than breaking.

### Height — never touching the edges

One cap for every dialog: **`max-height: calc(100vh - 4rem)`** — at least 2rem (32px) clear of the
top and bottom of the window, whatever the content. `fixedHeight` dialogs take
`height: min(640px, calc(100vh - 4rem))`, so they obey the same cap (Settings keeps 640; REST
history 512 → 640; REST environments 480 → 640; Query history & snippets 544 → 640).

### Actions

Every dialog's action row is built by `Modal` from a list:

```ts
interface ModalAction {
  /** What the button is in this dialog. Decides its look and which side of the row it sits on. */
  kind: "cancel" | "confirm" | "danger" | "secondary";
  label: ReactNode;
  /** Omitted on a `cancel`: it closes the dialog through `onClose`, like the ✕ and Escape. */
  onClick?: () => void;
  /** Run `onClick` after the exit animation rather than at the click — for an answer that ends
   *  the dialog (ConfirmDialog's confirm). A `cancel` always does. */
  closes?: boolean;
  disabled?: boolean;
  /** `Button`'s busy label ("Saving…"): the button locks and shows it while a request runs. */
  busy?: string;
  icon?: ReactNode;
  autoFocus?: boolean;
}
```

| `kind` | Look | Side |
| --- | --- | --- |
| `confirm` | `primary` | right, last — the dialog's answer is always in the bottom-right corner |
| `danger` | `danger` | right, last — a destructive answer, in the same place |
| `cancel` | `default` | right, just before the answer. Label defaults to `common.cancel`; a dialog with nothing to cancel says `common.close` |
| `secondary` | `default` | **left** — a tool that does not answer the dialog (Copy, Show/Hide). When the row has no `cancel`/`confirm`/`danger`, secondaries sit on the right instead: a row with one lone Copy button is read as the dialog's answer |

So the order is fixed by `Modal`, not by the order of the array: `[secondary…] ⟷ [cancel] [confirm]`.
`footerNote` sits at the far left, before any secondary. At most one `confirm` or `danger` per row
(a second one is a sign the dialog is two dialogs); a phase-by-phase dialog like ApplyDialog passes
the list for the phase it is in.

**One button size** for every action row: `Button size="large"`, set by `Modal`. `ModalAction` has
no size or variant field, so a dialog cannot pick another. CredentialDialog, the one dialog on the
default size today, moves to it.

Before and after, SiteForm:

```tsx
// before
<div ref={actionsRef} className={styles.actions}>
  <Button size="large" onClick={() => close(onCancel)} disabled={saving}>{t("common.cancel")}</Button>
  <Button size="large" variant="primary" onClick={() => void submit()} disabled={…}>
    {saving ? t("mixengine.sites.form.saving") : t("common.save")}
  </Button>
</div>

// after — a prop of <Modal>
actions={[
  { kind: "cancel", label: t("common.cancel"), disabled: saving },
  { kind: "confirm", label: t("common.save"), onClick: () => void submit(),
    disabled: …, busy: saving ? t("mixengine.sites.form.saving") : undefined },
]}
```

### Shared parts inside the panel

Exported from `components/Modal/index.ts` beside `Modal`:

| Part | Renders | Notes |
| --- | --- | --- |
| `ModalBody` | the body | **The only part that scrolls** (`flex: 1 1 auto; min-height: 0; overflow-y: auto`). Flex column with the standard field gap. `className?` for a caller's own inner layout (ColumnDialog's grid). Under `fixedHeight` it does not scroll itself but hands its child the remaining height — the list or panes inside keep their own scroll. |
| `ModalErrors` | the error block, `role="alert"` | `messages: string[]`; renders nothing when empty. Replaces the ~18 copies. |

So every dialog is:

```tsx
<Modal
  title={…}
  size="small"
  onClose={onCancel}
  locked={saving}
  actions={[{ kind: "cancel", label: t("common.cancel") }, { kind: "confirm", label: …, onClick: submit }]}
>
  {() => (
    <>
      <ModalBody>…fields…</ModalBody>
      <ModalErrors messages={errors} />
    </>
  )}
</Modal>
```

`Modal` draws the errors above the action row, and the action row below everything, outside the
scrolling body.

### One stylesheet

`surface.module.css` holds all of it: overlay, panel, the three widths, the height cap, padding
(`22px 24px`), gap (`16px`), header and title (`--text-xl`/600), ✕, body (with a 2px inner padding so
a focused field's ring is not clipped at the scroll edge), errors, and the action row with its two
groups. Nothing about a dialog's
frame is declared anywhere else.

### Settings — the one body exception

`SettingsModal` is the app's settings *window* shown as a modal: a sidebar of tabs and a panel per
tab. It becomes `size="large" fixedHeight`, takes its title and ✕ from `Modal` like every other
dialog, and keeps its own sidebar/panel layout inside `ModalBody` with zero inner padding.

### The guard — `surface.test.ts`

The existing test finds every `Modal` caller. It changes to check that:

1. **No caller passes `overlayClassName`/`className` to `Modal`** (the props no longer exist, so
   `tsc` already refuses it — the test keeps the reason written down).
2. **No caller draws its own frame**: a `Modal` caller's source has no `<h1>`–`<h3>` title of its
   own, no `className={styles.errors|actions|buttons}`, and no `CloseIcon`.
3. **No caller draws its own action row**: its source has no `<Button size=` — a button at the
   foot of a dialog is a `ModalAction`, and the size is `Modal`'s.
4. **No stylesheet re-declares the surface** — the existing check against `var(--surface…)` stays.

A new dialog that lays itself out by hand fails at `npm test`.

### Cleanup that falls out

- `SiteForm`/`ProjectForm` drop `actionsRef` and the `scrollIntoView` effect.
- Every caller's `.overlay`, `.dialog`, `.title`, `.header`, `.close`, `.errors`, `.actions` /
  `.buttons` rules are deleted from its sheet.

## Migration

All 26 callers in one change, in groups that can each be checked by eye:

| Group | Dialogs |
| --- | --- |
| Shared components | ConfirmDialog, NameDialog, CellDialog |
| mixengine forms | SiteForm, ProjectForm, ServiceForm, AddDomainDialog, ShareDialog, CleanupDialog |
| mixengine flows | ApplyDialog, ImportDialog, CaptureDialog, PlanDialog, AfterApply, ElevationDialog, CredentialDialog, UninstallConfirmDialog |
| db | ColumnDialog, IndexDialog, SkipIndexDialog, OrderByDialog, InsertRowsDialog, InsertDocumentsDialog, DumpDialog, QueryHistoryDialog, QuerySnippetsDialog |
| rest | HistoryDialog, EnvironmentDialog |
| shell | SettingsModal |

Behaviour, callbacks and strings do not change. One changelog line under `### Changed`: every
dialog keeps its title and buttons in view, stays clear of the window's edges, and has a ✕.

## What a user will see change

- Buttons, title and errors never scroll out of view; no dialog touches the window's top or bottom.
- A ✕ on every dialog (greyed while the dialog is busy).
- Every action row in the same order: tools on the left, Cancel then the answer on the right, all
  buttons the same size. CredentialDialog's Copy and Show move left and grow to the common size.
- Widths snap to three sizes — most move by 20–60px; InsertRows narrows from 1100 to 900.
- Small spacing shifts where a dialog was off the common padding/gap (CellDialog, the Query and
  REST dialogs, ConfirmDialog).

## Verification

`npm run build`, `npm test` (the rewritten `surface.test.ts` included), `npm run lint`. Layout is
not something vitest sees, so each group is opened once in `npm run dev:app`, the long ones
(SiteForm, ProjectForm, ApplyDialog, IndexDialog, InsertRowsDialog) at a short window height.
