# The app icon

The icon you see in the taskbar, the Dock, the window title and the browser tab all come from two
SVG files in `public/`, and one command turns them into every size and format the platforms want.

## The short version

```bash
# 1. Edit the drawing in public/logo.svg.
# 2. Copy the same drawing into public/logo-macos.svg, keeping that file's viewBox.
# 3. Rebuild the icon set.
npm run icons
# 4. Commit public/ and src-tauri/icons/ together.
```

That is all a routine icon change needs. The rest of this page explains why there are two files
and what the script does with them, for when something looks wrong.

## The two files

| File | What it is | What it feeds |
|------|------------|---------------|
| `public/logo.svg` | The drawing, filling its canvas edge to edge | The favicon (Vite serves it as `/logo.svg`) and every icon in `src-tauri/icons/` except `icon.icns` |
| `public/logo-macos.svg` | The same drawing on a canvas with a margin | `src-tauri/icons/icon.icns`, the macOS app icon, and nothing else |

The two are identical except for the `viewBox` on the root element and the comments. In
`logo.svg` it is `0 0 64 64`: a 64-unit tile on a 64-unit canvas. In `logo-macos.svg` it is
`-7.75 -7.75 79.5 79.5`: the same 64-unit tile centred on a 79.5-unit canvas, which leaves a margin
of a little under 10% on every side. No coordinate inside the file changes; only the canvas grows.

### Why macOS gets its own file

Every platform but macOS draws an app icon edge to edge. The Windows taskbar, Start menu and
Explorer, Linux launchers, and the browser tab all give the file the whole cell, so an icon with a
built-in margin simply looks smaller than its neighbours.

macOS is the exception. It lays its own app icons on a 1024-point grid where the rounded square
fills 824 of it, and it does not shrink third-party icons to match. An edge-to-edge tile in the
Dock therefore sits visibly larger than everything around it. The 79.5 canvas is exactly that
824/1024 ratio, so the padded file lands on Apple's grid.

One file cannot satisfy both. The project once shipped a single padded file and the Windows icon
was about a fifth smaller than every other app on the taskbar, which is what led to the split.

## What `npm run icons` does

The script is `scripts/make-icons.mjs`. It runs Tauri's own icon generator twice:

1. It checks that both files declare the viewBox they are supposed to, and that their drawings
   match once comments and the viewBox are ignored. If they do not, it stops and says which file
   to copy from. This is the guard against editing one file and forgetting the other.
2. It runs `tauri icon public/logo.svg`, which renders the vector at every size into
   `src-tauri/icons/`: the PNGs, the Windows `icon.ico`, the Windows Store `Square*Logo.png`
   tiles, and a first `icon.icns`.
3. It runs `tauri icon public/logo-macos.svg` into a temporary directory and copies only that
   run's `icon.icns` over the first one. The temporary directory is then deleted.

The generator renders from the vector at each target size rather than scaling one bitmap, which is
why the 32-pixel icon still reads as three platters instead of a blur.

`tauri icon` also writes `src-tauri/icons/android/` and `src-tauri/icons/ios/`. The app is
desktop-only, so those are dead weight kept only against a later mobile target; do not spend time
on them.

## Checking the result

Open a few of the generated files and look:

- `src-tauri/icons/128x128@2x.png` should fill its square edge to edge.
- `src-tauri/icons/32x32.png` should still be recognisable as the mark, not a smudge.
- `icon.icns` is a container, so an image viewer may show only its largest image. That image
  should have a clear margin around the tile.

Running the app with `npm run dev:app` shows the Windows or Linux icon in the taskbar straight
away. The macOS Dock icon only appears in a macOS build.

## Rules the drawing has to keep

These are the constraints that make the split work and the small sizes hold up. They are written
in the comments at the top of `public/logo.svg` too.

- **Keep it in the tile's own 0–64 space.** The macOS margin comes from the viewBox alone, so
  the drawing must never depend on the canvas size.
- **No blur, no filter.** The `.ico` goes down to 16 pixels. Gradients on flat shapes survive
  that; filters do not, and some renderers drop them entirely.
- **Draw a tile, not a bare mark.** A shape on a transparent ground has no presence in a taskbar.
  The rounded square is part of the icon.
- **Leave the corners alone.** The mark should clear the tile's rounded corners; anything drawn
  into them is cut off on platforms that mask icons.

## When the script refuses to run

| Message | What happened | Fix |
|---------|---------------|-----|
| `public/logo.svg must declare viewBox="0 0 64 64"` | The edge-to-edge file lost its viewBox or was given the padded one | Set the root `viewBox` back to `0 0 64 64` |
| `public/logo-macos.svg must declare viewBox="-7.75 -7.75 79.5 79.5"` | The macOS file lost its margin | Set the root `viewBox` back to `-7.75 -7.75 79.5 79.5` |
| `… draw different things` | One file was edited and the other was not | Copy everything below the comment from the file you edited into the other, keeping that file's viewBox |
