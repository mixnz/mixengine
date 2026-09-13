---
name: using-shared-components
description: Use when writing or changing any UI under apps/desktop/src — a form field, a dropdown, a checkbox, a textarea, a dialog, a list row, a tab header, a clickable icon — or when a screen needs a control that src/components/ may not have yet.
---

# Using shared components

MixLab's library is `apps/desktop/src/components/`, one folder each. **A raw HTML control in a
module is a decision, and a decision needs a reason written down.** The raw elements already in the
tree are debt, not precedent.

The primitives are not styling wrappers — each carries behaviour a raw element silently lacks:

| Primitive | What raw loses |
| --- | --- |
| `Input` | `autoComplete`/`autoCorrect`/`spellCheck` off, `allowClear` |
| `Select` | portal dropdown, search box, `keepOpen`, ellipsised trigger |
| `Checkbox` | `indeterminate` — a DOM property, re-set every render |
| `Textarea` | grows to fit content up to `maxRows` |
| `Modal` | overlay, portal, Escape — **and the focus trap** |

That last row is the argument: thirteen dialogs once hand-rolled the first three and none had the
fourth. A duplicated primitive is a copy missing something, and nobody notices which.

## The rules

- **Form controls → always the primitive.** `<Input type="number">`, never `<input type="number">`.
  A prop it does not forward is a reason to add the prop, not to drop to raw.
- **Every clickable → a shared component.** `Button` (action), `ItemList` (row), `TabStrip` (tab),
  `ContextMenu` (menu entry), `ActionBar` (icon actions). "My case behaves differently" is not an
  exemption: what is shared is the drawing, not the behaviour.
- Run `ls apps/desktop/src/components/` before concluding something is missing. There is no barrel —
  `import Button from "../../../../components/Button";`

## When nothing fits

1. **Count call sites, including the one you are writing.** Two or more → make it shared now.
   Standing example: `type="radio"` is open-coded in two screens and there is still no `Radio`.
2. **One call site, generic shape → still make it shared.** The bias is toward creating: a control a
   second screen would plausibly want is cheaper as a primitive today than as two divergent copies
   later. Ask what the *thing* is — "a segmented control", not "the idle-timeout picker".
3. **One call site, genuinely singular** (a colour picker in one panel) → raw, with the comment below.

A new primitive is a folder: `Thing.tsx`, `Thing.module.css`, `index.ts`. Pure logic beside it gets
a `.test.ts` (`Select/scroll.ts`, `TabStrip/reorder.ts`).

## The escape hatch

Going raw requires the comment saying why, as `BodyEditor.tsx` does:

```tsx
// A plain `<textarea>` rather than the shared one, which grows to fit its text: this pane has a
// height of its own and the box should fill it, not push the layout about.
```

Name the component, say what it would do, say why that is wrong here. A raw element with no reason
written down is the defect. This binds callers, not the library — inside `src/components/`, raw
elements are the implementation.

## Red flags

- A raw `<input>`, `<select>`, `<textarea>` or `<button>` in `src/modules/` or `src/shell/` with no comment.
- A local `Field()` or `styles.btn` re-implementing a primitive inside one module.
- A second screen open-coding what the first one open-coded.

| Excuse | Reality |
| --- | --- |
| "The tree is full of raw `<button>`" | It is debt. The count argues for the rule, not against it. |
| "It's just styling, mine looks the same" | Styling is what you can see. The focus trap and `indeterminate` are what you cannot. |
| "Only one screen needs it" | Then ask what the *thing* is. A generic shape still becomes a primitive. |
| "I'll extract it later" | Later is the second divergent copy. Extract at the second call site. |
| "The primitive lacks the prop I need" | Add the prop. |
| "Adding a component is out of scope here" | Then say so in the comment. Silence turns a decision into a defect. |
