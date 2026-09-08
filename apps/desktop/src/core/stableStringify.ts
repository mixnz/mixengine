/**
 * A form's contents as one string, so "has anything changed since this was saved?" is a comparison
 * rather than a walk.
 *
 * Key order isn't stable across sources — an object literal built by a form and the same object
 * after a round trip through the Tauri store's JSON do not agree on it — so a plain
 * `JSON.stringify` comparison flags identical configs as different, and a Save button that should
 * be dead stays alive. Sorting the keys recursively takes the order out of the answer.
 *
 * `undefined` properties are dropped, which is `JSON.stringify`'s own behaviour and the one that
 * matters here: a field written as absent and the same field written as `undefined` are the same
 * saved entry, and both stores in this app deliberately write absent for a default.
 *
 * Here rather than in a module because it knows nothing about one: it takes `unknown`. Two modules
 * ask it the same question about two unrelated shapes.
 */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}
