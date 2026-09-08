/** A parsed body as a tree of nodes the Source tab can draw. One shape for JSON and for a
 *  document, so `TreeView` knows nothing about either. */
export interface TreeNode {
  /** How this node is reached — `$.data.items[3].id`. Unique within a tree, so it is also the
   *  React key, and it is what "Copy path" copies. */
  path: string;
  label: string;
  /** The scalar as text, for a leaf. Null on a branch. */
  value: string | null;
  /** What a collapsed branch shows: `{3}`, `[2]`. Null on a leaf. */
  summary: string | null;
  children: TreeNode[] | null;
}

/** Whether a key can be written after a dot, or has to go in brackets. */
function isPlainKey(key: string): boolean {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key);
}

function childPath(parent: string, key: string): string {
  return isPlainKey(key) ? `${parent}.${key}` : `${parent}[${JSON.stringify(key)}]`;
}

/** The tree for a parsed JSON value. `label` and `path` are what the root is called — the
 *  defaults are what a response body gets, and the recursion supplies its own. */
export function buildJsonTree(value: unknown, label = "$", path = "$"): TreeNode {
  if (Array.isArray(value)) {
    return {
      path,
      label,
      value: null,
      summary: `[${value.length}]`,
      children: value.map((item, i) => buildJsonTree(item, String(i), `${path}[${i}]`)),
    };
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    return {
      path,
      label,
      value: null,
      summary: `{${entries.length}}`,
      children: entries.map(([key, item]) => buildJsonTree(item, key, childPath(path, key))),
    };
  }
  return {
    path,
    label,
    // Quoted, so `"42"` and `42` are not the same thing on screen — which is half of what anyone
    // opens a response tree to find out.
    value: typeof value === "string" ? JSON.stringify(value) : String(value),
    summary: null,
    children: null,
  };
}
