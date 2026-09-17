import { describe, expect, it } from "vitest";

/**
 * Colour belongs to `shell/App.css` (design D8). This was a ratchet while the screens moved onto the
 * tokens, a pin per file that only ever went down; every screen has moved, so it is now a ban — no
 * colour literal in any other stylesheet, and no hex colour in any source.
 *
 * The one exception is a colour that is data rather than theme, and each is named below with why.
 */

const sheets = import.meta.glob("../**/*.css", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const sources = import.meta.glob(["../**/*.{ts,tsx}", "!../**/*.test.{ts,tsx}"], {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const CSS_LITERAL = /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?)\(\s*\d/gi;
const TS_HEX = /["'`]#[0-9a-f]{3,8}["'`]/gi;

function withoutBlockComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "");
}

function withoutComments(text: string): string {
  return withoutBlockComments(text).replace(/^\s*\/\/.*$/gm, "");
}

function counts(
  files: Record<string, string>,
  pattern: RegExp,
  strip: (text: string) => string,
  skip: (path: string) => boolean,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [path, text] of Object.entries(files)) {
    // The glob names files beside this test `./x` and everything else `../dir/x`; key both from `src/`.
    const key = path.replace(/^\.\.\//, "").replace(/^\.\//, "shell/");
    if (skip(key)) continue;
    const n = (strip(text).match(pattern) ?? []).length;
    if (n > 0) out[key] = n;
  }
  return out;
}

/** Sources whose hex colours are values the user works with, not colours the app is drawn in. */
const DATA_COLOURS: Record<string, string> = {
  // A QR code's default ink and paper: black on white is what scanners read, whatever the theme,
  // and the colour inputs beside them take a hex value.
  "modules/tools/tools/qrcode/Panel.tsx": "default QR ink and paper",
};
describe("colour literals", () => {
  it("reads real files", () => {
    expect(Object.keys(sheets).length).toBeGreaterThan(40);
    expect(Object.keys(sources).length).toBeGreaterThan(100);
  });

  it("no stylesheet outside App.css names a colour", () => {
    expect(counts(sheets, CSS_LITERAL, withoutBlockComments, (p) => p === "shell/App.css")).toEqual({});
  });

  it("no source names a hex colour, but for data colours", () => {
    expect(counts(sources, TS_HEX, withoutComments, (p) => p in DATA_COLOURS)).toEqual({});
  });
});
