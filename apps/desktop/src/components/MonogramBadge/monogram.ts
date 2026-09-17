/**
 * The two letters and the hue of a name's badge, derived from the name alone.
 *
 * Derived rather than looked up, on purpose: a table mapping package names to colours or labels is
 * a client deciding what a package *is*, which ADR 0026 keeps with the daemon. A hash says nothing
 * about the thing — it only keeps one name the same colour everywhere it appears.
 */

export const CATEGORICAL_HUES = ["teal", "sand", "sky", "periwinkle", "coral", "blue", "purple", "green"] as const;

export type CategoricalHue = (typeof CATEGORICAL_HUES)[number];

function drawable(name: string): string[] {
  return [...name].filter((ch) => /[\p{L}\p{N}]/u.test(ch));
}

/** First letter upper-cased, second lower-cased; `··` when the name has nothing to draw. */
export function monogramLetters(name: string): string {
  const chars = drawable(name);
  if (chars.length === 0) return "··";
  const first = chars[0].toUpperCase();
  return chars.length === 1 ? first : first + chars[1].toLowerCase();
}

/** One of the eight categorical hues, by FNV-1a of the whole name; `null` for a name with nothing
 *  to draw, which is shown on the neutral tint. */
export function monogramHue(name: string): CategoricalHue | null {
  if (drawable(name).length === 0) return null;
  let hash = 0x811c9dc5;
  for (let i = 0; i < name.length; i++) {
    hash ^= name.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return CATEGORICAL_HUES[(hash >>> 0) % CATEGORICAL_HUES.length];
}
