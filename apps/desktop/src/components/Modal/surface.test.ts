import { describe, expect, it } from "vitest";

/**
 * Every dialog is drawn on the shared surface, and this is what says so.
 *
 * `Modal` shares a dialog's *behaviour* and takes its two classes as props, which leaves the
 * geometry and the skin to each caller — twenty-two copies of the same nine lines. Four of them
 * had drifted before anyone looked: no `z-index`, no motion, and `var(--surface, #fff)` naming a
 * token this app has never defined, so those dialogs came up white in the dark theme.
 *
 * A stylesheet has no unit to test, so the invariant is tested where it can be: on the source. A
 * new dialog that writes its own `position`/`background` instead of composing the surface fails
 * here, at the moment it is written, rather than in a screenshot of the dark theme months later.
 *
 * Sources are read through `import.meta.glob` rather than through `node:fs`: this project ships no
 * Node types to its app tsconfig, and one test is not a reason to add a dependency to it.
 */
const SURFACE = "components/Modal/surface.module.css";

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

/** `../../modules/x/A.tsx` + `./A.module.css` → `../../modules/x/A.module.css`. */
function resolveFrom(file: string, rel: string): string {
  const parts = file.split("/").slice(0, -1);
  for (const step of rel.split("/")) {
    if (step === ".") continue;
    else if (step === "..") parts.pop();
    else parts.push(step);
  }
  return parts.join("/");
}

/** The two classes a file hands to `Modal`, and the stylesheet they come from. */
interface Caller {
  file: string;
  css: string;
  classes: string[];
}

const callers: Caller[] = Object.entries(SOURCES).flatMap(([file, source]) => {
  if (!/from "[^"]*components\/Modal"/.test(source)) return [];

  const sheet = /import styles from "([^"]+\.module\.css)"/.exec(source);
  const overlay = /overlayClassName=\{styles\.(\w+)\}/.exec(source);
  if (sheet === null || overlay === null) return [];

  // The dialog's own class is the next `styles.` className after the overlay's — the prop order
  // `Modal` is called with everywhere, and the count below is what keeps that true.
  const dialog = /className=\{styles\.(\w+)\}/.exec(source.slice(overlay.index + overlay[0].length));
  if (dialog === null) return [];

  return [{ file, css: resolveFrom(file, sheet[1]), classes: [overlay[1], dialog[1]] }];
});

/** The body of one rule, so a match cannot come from a neighbouring one. */
function rule(css: string, className: string): string {
  const body = new RegExp(`^\\.${className}\\s*\\{([^}]*)\\}`, "m").exec(css);
  return body === null ? "" : body[1];
}

describe("every Modal caller composes the shared surface", () => {
  it("finds the callers at all, so a rename cannot turn this suite into a no-op", () => {
    expect(callers.length).toBeGreaterThanOrEqual(22);
  });

  it.each(callers)("$file", ({ css, classes }) => {
    const sheet = SHEETS[css];
    expect(sheet, `no stylesheet at ${css}`).toBeDefined();
    for (const className of classes) {
      expect(rule(sheet, className)).toContain(SURFACE);
    }
  });

  /* The four that had drifted all named a token nothing defines, so they fell back to a hardcoded
     white and stayed white in the dark theme. Nothing should name it again. */
  it.each(Object.entries(SHEETS))("%s names no undefined surface token", (_file, sheet) => {
    // Declarations only: the shared sheet quotes the broken token in its own comment, explaining
    // what it is there to stop.
    expect(sheet.replace(/\/\*[\s\S]*?\*\//g, "")).not.toMatch(/var\(--surface(-muted)?[,)]/);
  });
});
