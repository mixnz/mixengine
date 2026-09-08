import type { TypedValue } from "./bsonTypes";

function isPlainContainer(v: TypedValue): v is TypedValue[] | { [key: string]: TypedValue } {
  return v !== null && typeof v === "object" && !("$type" in v && "$value" in v);
}

export function getAtPath(root: TypedValue, path: string[]): TypedValue | undefined {
  let node: TypedValue = root;
  for (const segment of path) {
    if (!isPlainContainer(node)) return undefined;
    if (Array.isArray(node)) {
      const idx = Number(segment);
      node = node[idx];
    } else {
      node = (node as Record<string, TypedValue>)[segment];
    }
    if (node === undefined) return undefined;
  }
  return node;
}

/** Returns a new tree with `value` written at `path`, sharing structure with
 * `root` outside the modified branch (plain-object/array spreads at each
 * level down the path) so React state updates see a changed reference only
 * where it matters. */
export function setAtPath(root: TypedValue, path: string[], value: TypedValue): TypedValue {
  if (path.length === 0) return value;
  const [head, ...rest] = path;
  if (Array.isArray(root)) {
    const idx = Number(head);
    const next = root.slice();
    next[idx] = setAtPath(next[idx] ?? null, rest, value);
    return next;
  }
  const obj = isPlainContainer(root) ? (root as Record<string, TypedValue>) : {};
  return { ...obj, [head]: setAtPath(obj[head] ?? null, rest, value) };
}

/** Removes the field/item at `path`. Object keys are deleted outright;
 * array items are spliced out (shrinking the array), never left as `null`
 * holes. */
export function deleteAtPath(root: TypedValue, path: string[]): TypedValue {
  if (path.length === 0) return root;
  const [head, ...rest] = path;
  if (Array.isArray(root)) {
    const idx = Number(head);
    if (rest.length === 0) {
      const next = root.slice();
      next.splice(idx, 1);
      return next;
    }
    const next = root.slice();
    next[idx] = deleteAtPath(next[idx], rest);
    return next;
  }
  if (!isPlainContainer(root)) return root;
  const obj = root as Record<string, TypedValue>;
  if (rest.length === 0) {
    const { [head]: _removed, ...remainder } = obj;
    return remainder;
  }
  return { ...obj, [head]: deleteAtPath(obj[head], rest) };
}

/** Renames the object key at `path` to `newKey`, moving it to the end of
 * the object — matching MongoDB's own `$rename` behavior of dropping the
 * field and re-inserting it under the new name. `path`'s parent must be an
 * object (array items have no key to rename). */
export function renameKeyAtPath(root: TypedValue, path: string[], newKey: string): TypedValue {
  if (path.length === 0) return root;
  const [head, ...rest] = path;
  if (Array.isArray(root)) {
    const idx = Number(head);
    const next = root.slice();
    next[idx] = renameKeyAtPath(next[idx], rest, newKey);
    return next;
  }
  if (!isPlainContainer(root)) return root;
  const obj = root as Record<string, TypedValue>;
  if (rest.length === 0) {
    const { [head]: moved, ...remainder } = obj;
    return { ...remainder, [newKey]: moved };
  }
  return { ...obj, [head]: renameKeyAtPath(obj[head], rest, newKey) };
}
