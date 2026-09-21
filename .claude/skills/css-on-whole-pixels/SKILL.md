---
name: css-on-whole-pixels
description: Use when writing or changing CSS under apps/desktop/src — a line-height, a font size, a border, a padding — or when an element shifts a pixel, jitters or loses an edge on hover, focus or scroll, most visibly at 125% or 150% display scaling.
---

# CSS on whole pixels

A box whose height is a fraction of a CSS pixel puts everything after it on a fractional offset. At
125% scaling (`devicePixelRatio` 1.25) the browser rounds that offset when it repaints, so an element
below moves a device pixel on hover, or clips its own edge. Layout never changes, so nothing in
`scrollTop` or a scroll listener shows it.

The type scale makes this easy to hit: `--text-2xs` 11.5px, `--text-sm` 12.5px, `--text-md` 13.5px.

## Rules

A line height belongs to its font size, so it lives beside it as a token in `App.css`, in whole
pixels, and the two change together.

| Instead of | Write |
| --- | --- |
| `font-size: var(--text-sm); line-height: 1.5` (18.75px) | `line-height: var(--leading-sm)` |
| `line-height: 20px` beside a token font size | the matching `--leading-*` token |
| a size with no `--leading-*` yet | add one next to its `--text-*`, whole pixels |
| `border: 1.5px` | `1px` or `2px` |

A unitless ratio is fine only when size × ratio is whole: `12px × 1.5 = 18`, not `13.5 × 1.4`.
The fractional line heights already in the tree are debt; fix the ones you touch.

## Finding the culprit

Symptom: a row moves 1–2px on hover, only after scrolling to the bottom. In DevTools, on that pane:

```js
[...document.querySelectorAll("#settings-panel-sync *")]
  .map((e) => [e.tagName, String(e.className).slice(0, 40), e.getBoundingClientRect().height])
  .filter(([, , h]) => h % 1 !== 0);
```

Fix the first fractional box **above** the element that moves, in that box's own style. Nudging the
element that moves hides the symptom and leaves the offset for the next one.
