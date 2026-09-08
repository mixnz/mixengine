import { useState } from "react";
import { IS_MAC, IS_WINDOWS } from "../core/platform";

export type ThemeMode = "light" | "dark" | "system";

/** The accent a user can pick; the palette each one resolves to lives in App.css. */
export type AccentColor =
  | "blue"
  | "indigo"
  | "violet"
  | "magenta"
  | "orange"
  | "amber"
  | "green"
  | "teal"
  | "cyan"
  | "slate";

export const ACCENT_COLORS: AccentColor[] = [
  "blue",
  "indigo",
  "violet",
  "magenta",
  "orange",
  "amber",
  "green",
  "teal",
  "cyan",
  "slate",
];

const DEFAULT_ACCENT: AccentColor = "blue";

const STORAGE_KEY = "mixdb-theme";
const ACCENT_STORAGE_KEY = "mixdb-accent";
const GLASS_STORAGE_KEY = "mixdb-glass";

function readStoredTheme(): ThemeMode {
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored === "light" || stored === "dark" ? stored : "system";
}

function readStoredAccent(): AccentColor {
  const stored = localStorage.getItem(ACCENT_STORAGE_KEY);
  return ACCENT_COLORS.includes(stored as AccentColor) ? (stored as AccentColor) : DEFAULT_ACCENT;
}

/* Off unless the user has turned it on. It is a look rather than a fix — the plain pill is the one
   that has to work everywhere — so the stored value is only ever the opt-in. */
function readStoredGlass(): boolean {
  return localStorage.getItem(GLASS_STORAGE_KEY) === "on";
}

function applyTheme(theme: ThemeMode): void {
  const root = document.documentElement;
  if (theme === "system") {
    root.removeAttribute("data-theme");
    localStorage.removeItem(STORAGE_KEY);
  } else {
    root.setAttribute("data-theme", theme);
    localStorage.setItem(STORAGE_KEY, theme);
  }
}

/* The default is what `:root` already carries, so the attribute is left off for it rather than
   written out — same shape as the theme above, and it keeps the DOM clean for the common case. */
function applyAccent(accent: AccentColor): void {
  const root = document.documentElement;
  if (accent === DEFAULT_ACCENT) {
    root.removeAttribute("data-accent");
    localStorage.removeItem(ACCENT_STORAGE_KEY);
  } else {
    root.setAttribute("data-accent", accent);
    localStorage.setItem(ACCENT_STORAGE_KEY, accent);
  }
}

/* Which webview is drawing the window, as an attribute CSS can select on.
 *
 * Not a preference and not stored anywhere: it is written every load from the user agent, and it
 * exists for the one question `glass.css` has that neither a media query nor `@supports` can ask —
 * whether this engine *draws* a reference filter on a backdrop, which WebKit says it takes and then
 * ignores. Every platform is named rather than just the one that needs it, so the next rule that
 * has to split does not have to add the other half of the answer first.
 *
 * Written out in full, unlike the three above, because there is no default to be the absence of:
 * a root with no `data-platform` is a root the script has not run on yet. */
function applyPlatform(): void {
  document.documentElement.setAttribute(
    "data-platform",
    IS_MAC ? "mac" : IS_WINDOWS ? "windows" : "linux",
  );
}

/* Same shape again — the default is the bare `:root`, so "off" is the absence of the attribute
   rather than a value of its own. */
function applyGlass(on: boolean): void {
  const root = document.documentElement;
  if (on) {
    root.setAttribute("data-glass", "on");
    localStorage.setItem(GLASS_STORAGE_KEY, "on");
  } else {
    root.removeAttribute("data-glass");
    localStorage.removeItem(GLASS_STORAGE_KEY);
  }
}

/* Read before React mounts: the stored choice has to be on the root element for the very first
   paint, otherwise the window flashes the default accent on every launch.

   The theme is here too, and it is the one of the four that is applied twice: `theme-preload.js`
   sets it earlier still, before the bundle has even been fetched, which is what stops a dark app
   flashing white while it loads. That file is the optimisation and this is the guarantee — a
   preload that 404s, is blocked, or is dropped by a future change to `index.html` would otherwise
   leave the theme unset for the whole session, and nothing would look wrong enough at build time
   to notice. Applying it again costs one attribute write against a value that is already there. */
applyPlatform();
applyTheme(readStoredTheme());
applyAccent(readStoredAccent());
applyGlass(readStoredGlass());

export function useTheme(): [ThemeMode, (theme: ThemeMode) => void] {
  const [theme, setTheme] = useState<ThemeMode>(readStoredTheme);

  function updateTheme(next: ThemeMode) {
    applyTheme(next);
    setTheme(next);
  }

  return [theme, updateTheme];
}

export function useAccent(): [AccentColor, (accent: AccentColor) => void] {
  const [accent, setAccent] = useState<AccentColor>(readStoredAccent);

  function updateAccent(next: AccentColor) {
    applyAccent(next);
    setAccent(next);
  }

  return [accent, updateAccent];
}

export function useGlass(): [boolean, (on: boolean) => void] {
  const [glass, setGlass] = useState<boolean>(readStoredGlass);

  function updateGlass(next: boolean) {
    applyGlass(next);
    setGlass(next);
  }

  return [glass, updateGlass];
}
