# Icons

Icons are inline SVG in `src/icons`, never emoji or an icon font. A glyph is rendered by whatever
font the OS resolves it to — colour emoji on macOS, a different design at a different size on
Windows, ignoring `color` entirely. Inline SVG paints identically everywhere and inherits
`currentColor`, so a control can tint it for states like "marked for deletion".

## Adding one

1. Draw it on the 24×24 grid inside `src/icons/icons.tsx`, as a component wrapping `<Icon>`:

   ```tsx
   export function PlusIcon(props: IconProps) {
     return (
       <Icon {...props}>
         <path d="M12 5v14M5 12h14" />
       </Icon>
     );
   }
   ```

2. Export it from `src/icons/index.ts` (the list is alphabetical).

`Icon` supplies the frame: `viewBox="0 0 24 24"`, `fill="none"`, `stroke="currentColor"`,
`strokeWidth={2}`, round caps and joins. Draw strokes, not fills, so the weight stays uniform.

## Sizing and accessibility

- `size` defaults to `1em`, so an icon tracks the font size of whatever it sits in. Pass an explicit
  size only when the surrounding text size is wrong for it.
- Every icon is `aria-hidden` and `focusable="false"`. They decorate a control that already carries
  its own name via `title` / `aria-label` — an icon-only button still needs one.
