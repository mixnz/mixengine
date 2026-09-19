# MixLab's redesign: one token set, two themes, two densities, no glass

2026-09-17. Design: [2026-09-17-t157-mixlab-redesign-design.md](../../specs/2026-09-17-t157-mixlab-redesign-design.md).

A design canvas redrew MixLab dark, in Geist, with content in bordered cards and roomier controls.
Taking it meant replacing several things `shell/App.css` had stated as rules. This records what
replaced them.

## What was decided

- **Two themes, both written out.** The dark theme takes the canvas's values and the light theme
  the accepted light draft's; every colour token appears once in `:root` and once in
  `:root[data-theme="dark"]`, and neither is derived from the other at runtime.
- **`data-theme` always names a theme.** `theme-preload.js` and `theme.ts` resolve *system* through
  `matchMedia` and follow it while it is chosen, so no stylesheet restates its dark rules under
  `@media (prefers-color-scheme: dark)`.
- **Mint is the default accent, and an accent has four handles**: fill, text, ink on the fill, and
  channels for washes. Every hue's text and ink clear 4.5:1 in both themes (`contrast.test.ts`).
- **Liquid glass is gone.** It was an opt-in look with hooks in ten components and four `db`
  stylesheets; the redesign's surfaces are opaque.
- **Geist and Geist Mono**, bundled through Fontsource, replace the system sans and Fira Code. The
  sans/mono role boundary is unchanged. Geist Mono has no ligatures, so `->` is two characters
  again.
- **New scales.** Type 11.5, 12, 12.5, 13.5, 15, 18, 28px; radius 6, 8, 10, 12, 16, 18, pill. These
  replace the four-step type scale and three radii; a value outside the new sets is still a
  mistake.
- **Two densities, chosen by region.** Components read `--control-h*`, `--row-h`, `--list-row-h`
  and `--text-body`; a region that holds rows sets `data-density="compact"`.
- **Focus stays inside the border**, now a solid `--accent-text` ring, for the clipping reason
  `App.css` already recorded.
- **Colour lives in `App.css`.** `colourLiterals.test.ts` pins every other file's count of literals
  and only lets it fall.

## What was not

- A user-selectable density — the region decides.
- Deriving a light theme from the dark one at runtime — every value is chosen and measured.
- `color-mix()` — WebKitGTK builds MixLab ships on do not all support it.
