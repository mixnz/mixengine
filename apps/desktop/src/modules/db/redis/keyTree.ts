import type { RedisKeyInfo } from "./api";

/** One level of the key tree.
 *
 * A node can be both a key and a folder at once — `user` and `user:1` can both exist, and the
 * first is then a real key with the second underneath it. `key` and `children` are therefore
 * independent: either, neither in the case of a bare prefix, or both. */
export interface RedisKeyNode {
  /** The segment this node stands for, i.e. what the row shows. */
  label: string;
  /** The full key prefix down to here — the node's identity, and what expansion is tracked by. */
  path: string;
  /** The key of exactly this name, when one exists. */
  key?: RedisKeyInfo;
  children: RedisKeyNode[];
  /** How many keys sit at or under this node. */
  count: number;
}

interface Building {
  label: string;
  path: string;
  key?: RedisKeyInfo;
  children: Map<string, Building>;
  count: number;
}

/** Siblings in the order they read best: folders above plain keys, and each group by name with
 * runs of digits compared as numbers, so `user:2` sorts before `user:10`. The keys themselves
 * arrive in `SCAN` order, which is no order at all — a tree drawn in it looks broken. */
function compareNodes(a: RedisKeyNode, b: RedisKeyNode): number {
  const aFolder = a.children.length > 0;
  const bFolder = b.children.length > 0;
  if (aFolder !== bFolder) return aFolder ? -1 : 1;
  return a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: "base" });
}

function finish(level: Map<string, Building>): RedisKeyNode[] {
  return Array.from(level.values(), (node) => ({
    label: node.label,
    path: node.path,
    key: node.key,
    count: node.count,
    children: finish(node.children),
  })).sort(compareNodes);
}

/**
 * Reads a flat list of key names as a tree, splitting each one on `separator` and hanging it off
 * the prefixes it shares with the others.
 *
 * Nothing in Redis makes `user:1:name` a child of anything: the keyspace is flat, and the
 * separator is a convention in how names are written rather than a feature of the database. So
 * this is a reading of the names and nothing more — the same keys under a different separator
 * are a different tree, and no round trip to the server is involved in changing it.
 */
export function buildKeyTree(keys: RedisKeyInfo[], separator: string): RedisKeyNode[] {
  if (!separator) return [];
  const roots = new Map<string, Building>();
  for (const key of keys) {
    const segments = key.name.split(separator);
    let level = roots;
    let path = "";
    segments.forEach((segment, i) => {
      path = i === 0 ? segment : `${path}${separator}${segment}`;
      let node = level.get(segment);
      if (!node) {
        node = { label: segment, path, children: new Map(), count: 0 };
        level.set(segment, node);
      }
      node.count += 1;
      if (i === segments.length - 1) node.key = key;
      level = node.children;
    });
  }
  return finish(roots);
}

/** Every prefix of `key` that is a folder above it — what has to be open for it to be on screen. */
export function ancestorPaths(key: string | null | undefined, separator: string): Set<string> {
  const open = new Set<string>();
  if (!key || !separator) return open;
  const segments = key.split(separator);
  let path = "";
  // The last segment is the key itself, not a folder above it.
  for (let i = 0; i < segments.length - 1; i += 1) {
    path = i === 0 ? segments[i] : `${path}${separator}${segments[i]}`;
    open.add(path);
  }
  return open;
}

export interface RedisKeyRow {
  node: RedisKeyNode;
  depth: number;
  open: boolean;
}

/** The tree as the rows currently on screen: a closed node contributes itself and nothing under it.
 *
 * Depth-first and in order, which is what lets the keyboard treat the rows as a plain list: the
 * row after an open folder is its first child, and the parent of a row is the nearest row above
 * it at a lower depth. */
export function visibleRows(
  nodes: RedisKeyNode[],
  expanded: Set<string>,
  depth = 0,
): RedisKeyRow[] {
  const rows: RedisKeyRow[] = [];
  for (const node of nodes) {
    const open = expanded.has(node.path);
    rows.push({ node, depth, open });
    if (open && node.children.length > 0) {
      rows.push(...visibleRows(node.children, expanded, depth + 1));
    }
  }
  return rows;
}

/** What one arrow key does to the row list: step the focus, or work the folder it is on. */
export type TreeNavAction =
  | { kind: "move"; index: number }
  | { kind: "expand"; path: string }
  | { kind: "collapse"; path: string };

/** The keys this resolves; anything else the list leaves to the browser. */
export const TREE_NAV_KEYS = new Set(["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "Home", "End"]);

/**
 * Reads one keystroke against the rows on screen, the way a tree is normally driven: up and down
 * walk the visible rows, right opens a folder and then steps into it, left closes it and then
 * steps back out to its parent.
 *
 * Right on a closed folder opens it and goes no further — stepping in takes a second press. That
 * is deliberate: the child row does not exist until the open has been rendered, so a single
 * press that did both would be reaching for a row that isn't there yet.
 *
 * Returns `null` when the keystroke has nowhere to go — the first row's Up, a leaf's Right, a
 * root's Left. `move` may name an index past either end; moving is the caller's to bound.
 */
export function resolveTreeKey(
  key: string,
  rows: RedisKeyRow[],
  index: number,
): TreeNavAction | null {
  const row = rows[index];
  if (!row) return null;
  const isFolder = row.node.children.length > 0;

  switch (key) {
    case "ArrowDown":
      return index + 1 < rows.length ? { kind: "move", index: index + 1 } : null;
    case "ArrowUp":
      return index > 0 ? { kind: "move", index: index - 1 } : null;
    case "Home":
      return { kind: "move", index: 0 };
    case "End":
      return { kind: "move", index: rows.length - 1 };
    case "ArrowRight":
      if (!isFolder) return null;
      // The row after an open folder is its first child — the rows are depth-first.
      return row.open ? { kind: "move", index: index + 1 } : { kind: "expand", path: row.node.path };
    case "ArrowLeft": {
      if (isFolder && row.open) return { kind: "collapse", path: row.node.path };
      // Out to the parent: the nearest row above this one that sits at a lower depth.
      for (let i = index - 1; i >= 0; i -= 1) {
        if (rows[i].depth < row.depth) return { kind: "move", index: i };
      }
      return null;
    }
    default:
      return null;
  }
}

/** The same rows without a tree over them: every key at depth 0, in the order it was scanned.
 * What the list is when no separator groups it — one shape for both, so the rendering and the
 * keyboard don't each need a second case. */
export function flatRows(keys: RedisKeyInfo[]): RedisKeyRow[] {
  return keys.map((key) => ({
    node: { label: key.name, path: key.name, key, children: [], count: 1 },
    depth: 0,
    open: false,
  }));
}
