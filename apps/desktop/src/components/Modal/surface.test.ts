import { describe, expect, it } from "vitest";

/**
 * Every dialog is laid out by `Modal` alone, and this is what says so.
 *
 * `Modal` once shared only a dialog's *behaviour* and took its classes as props, which left the
 * frame to each caller — 26 copies of a title, an error block, an action row, a width, a height cap
 * and a padding. They drifted: nineteen widths, dialogs that grew until they touched the window's
 * edges, and Save buttons that scrolled away with the form. Now `Modal` draws the whole frame from
 * `surface.module.css` and a caller hands over a body and a list of `actions`
 * (spec `2026-09-19-one-dialog-layout-design.md`).
 *
 * A stylesheet has no unit to test, so the invariant is tested where it can be: on the source. A
 * new dialog that draws its own title, errors or buttons fails here, at the moment it is written.
 *
 * Sources are read through `import.meta.glob` rather than through `node:fs`: this project ships no
 * Node types to its app tsconfig, and one test is not a reason to add a dependency to it.
 */
const SOURCES = import.meta.glob("../../**/*.tsx", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const SHEETS = import.meta.glob("../../**/*.module.css", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

/** Every file that renders a `Modal`. */
const callers = Object.entries(SOURCES).filter(
  ([file, source]) => !file.includes("/components/Modal/") && /from "[^"]*(components\/Modal|\.\.\/Modal)"/.test(source),
);

/** What a caller must leave to `Modal`, and the part that draws it instead. */
const FORBIDDEN: [RegExp, string][] = [
  [/overlayClassName=|className=\{styles\.dialog\}/, "Modal draws the overlay and the panel — pass `size`"],
  [/<h[1-3][\s>]/, "Modal draws the title — pass `title`"],
  [/className=\{styles\.(title|header|headerClose)\}/, "Modal draws the header and its ✕"],
  [/className=\{styles\.errors\}/, "use `ModalErrors`"],
  [/className=\{styles\.(actions|buttons|footer)\}/, "pass `actions` — Modal draws the action row"],
  [/<Button\b[^>]*size="large"/, "a button at the foot of a dialog is a `ModalAction`"],
];

describe("every Modal caller leaves the frame to Modal", () => {
  it("finds the callers at all, so a rename cannot turn this suite into a no-op", () => {
    expect(callers.length).toBeGreaterThanOrEqual(26);
  });

  it.each(callers)("%s", (_file, source) => {
    for (const [pattern, instead] of FORBIDDEN) {
      expect(pattern.test(source), instead).toBe(false);
    }
  });

  /* No sheet may re-declare the surface either: four once named a token nothing defines, fell back
     to a hardcoded white, and stayed white in the dark theme. */
  it.each(Object.entries(SHEETS))("%s names no undefined surface token", (_file, sheet) => {
    // Declarations only: the shared sheet quotes the broken token in its own comment.
    expect(sheet.replace(/\/\*[\s\S]*?\*\//g, "")).not.toMatch(/var\(--surface(-muted)?[,)]/);
  });

  it.each(Object.entries(SHEETS).filter(([file]) => !file.includes("/components/Modal/")))(
    "%s does not compose the dialog surface",
    (_file, sheet) => {
      expect(sheet).not.toMatch(/composes: (dialog|overlay) from "[^"]*Modal\/surface/);
    },
  );
});
