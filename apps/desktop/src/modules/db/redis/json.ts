/**
 * Reads a Redis value as a JSON document, or says it isn't one.
 *
 * Every value Redis hands back is an opaque byte string — a JSON document stored in a key looks
 * from here exactly like any other text, and the only way to know is to parse it. Returns
 * `undefined` for anything that isn't an object or an array: a bare `42` or `"hi"` is valid JSON
 * too, but reformatting those gains nothing and would only turn a stored number into a
 * "document" it never was.
 */
export function parseJsonDocument(text: string): unknown | undefined {
  const trimmed = text.trim();
  // A cheap gate before the parse. Most values in most keyspaces are plain text, and only these
  // two characters can begin what this is looking for.
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return undefined;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    return typeof parsed === "object" && parsed !== null ? parsed : undefined;
  } catch {
    return undefined;
  }
}
