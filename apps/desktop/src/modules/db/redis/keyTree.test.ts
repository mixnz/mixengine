import { describe, expect, it } from "vitest";
import type { RedisKeyInfo } from "./api";
import {
  ancestorPaths,
  buildKeyTree,
  flatRows,
  resolveTreeKey,
  visibleRows,
  type RedisKeyNode,
} from "./keyTree";

const keys = (...names: string[]): RedisKeyInfo[] =>
  names.map((name) => ({ name, type: "string" }));

/** A node by path, for asserting about one branch without writing the whole tree out. */
function at(nodes: RedisKeyNode[], path: string): RedisKeyNode | undefined {
  for (const node of nodes) {
    if (node.path === path) return node;
    const found = at(node.children, path);
    if (found) return found;
  }
  return undefined;
}

describe("buildKeyTree", () => {
  it("hangs keys off the prefixes they share", () => {
    const tree = buildKeyTree(keys("user:1:name", "user:1:age", "user:2:name"), ":");
    expect(tree).toHaveLength(1);
    expect(tree[0].label).toBe("user");
    expect(tree[0].children.map((child) => child.label)).toEqual(["1", "2"]);
    expect(at(tree, "user:1")?.children.map((child) => child.label)).toEqual(["age", "name"]);
  });

  it("counts every key at or under a node", () => {
    const tree = buildKeyTree(keys("user:1:name", "user:1:age", "user:2:name", "session:a"), ":");
    expect(at(tree, "user")?.count).toBe(3);
    expect(at(tree, "user:1")?.count).toBe(2);
    expect(at(tree, "session")?.count).toBe(1);
  });

  it("lets a node be a key and a folder at once", () => {
    // `user` and `user:1` can both exist, and the first is then a real key with the second under
    // it. Nothing in Redis makes one a child of the other; the tree is a reading of the names.
    const tree = buildKeyTree(keys("user", "user:1"), ":");
    expect(tree[0].key?.name).toBe("user");
    expect(tree[0].children).toHaveLength(1);

    // A bare prefix is neither: no key of its own, but something underneath.
    const bare = buildKeyTree(keys("user:1"), ":");
    expect(bare[0].key).toBeUndefined();
    expect(bare[0].children).toHaveLength(1);
  });

  it("puts folders above plain keys and sorts digits as numbers", () => {
    // `SCAN` order is no order at all, and a tree drawn in it looks broken.
    const tree = buildKeyTree(keys("user:10", "user:2", "user:1:name", "b", "a:x"), ":");
    // Roots: the two folders first, then nothing else at this level.
    expect(tree.map((node) => node.label)).toEqual(["a", "user", "b"]);
    // `user:1` is a folder, so it comes before the two plain keys — which are then in numeric
    // order rather than the lexical one that would put `10` before `2`.
    expect(at(tree, "user")?.children.map((node) => node.label)).toEqual(["1", "2", "10"]);
  });

  it("reads the same keys as a different tree under a different separator", () => {
    const flat = buildKeyTree(keys("user:1:name"), ".");
    expect(flat).toHaveLength(1);
    expect(flat[0].label).toBe("user:1:name");
    expect(flat[0].children).toEqual([]);
  });

  it("has no tree to give without a separator", () => {
    expect(buildKeyTree(keys("user:1"), "")).toEqual([]);
  });
});

describe("ancestorPaths", () => {
  it("names every folder that has to be open for a key to be on screen", () => {
    expect(ancestorPaths("user:1:name", ":")).toEqual(new Set(["user", "user:1"]));
  });

  it("leaves the key itself out, being a row rather than a folder", () => {
    expect(ancestorPaths("user", ":")).toEqual(new Set());
  });

  it("answers nothing for nothing", () => {
    expect(ancestorPaths(null, ":")).toEqual(new Set());
    expect(ancestorPaths(undefined, ":")).toEqual(new Set());
    expect(ancestorPaths("user:1", "")).toEqual(new Set());
  });
});

describe("visibleRows", () => {
  const tree = buildKeyTree(keys("user:1:name", "user:2"), ":");

  it("stops at a closed node", () => {
    const rows = visibleRows(tree, new Set());
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ depth: 0, open: false });
  });

  it("walks depth-first, so the row after a folder is its first child", () => {
    const rows = visibleRows(tree, new Set(["user"]));
    expect(rows.map((row) => [row.node.path, row.depth])).toEqual([
      ["user", 0],
      ["user:1", 1],
      ["user:2", 1],
    ]);
  });

  it("opens a whole branch when every folder in it is open", () => {
    const rows = visibleRows(tree, new Set(["user", "user:1"]));
    expect(rows.map((row) => row.node.path)).toEqual(["user", "user:1", "user:1:name", "user:2"]);
  });
});

describe("resolveTreeKey", () => {
  const tree = buildKeyTree(keys("user:1:name", "user:2"), ":");
  const closed = visibleRows(tree, new Set());
  const open = visibleRows(tree, new Set(["user"]));

  it("walks the visible rows with up and down", () => {
    expect(resolveTreeKey("ArrowDown", open, 0)).toEqual({ kind: "move", index: 1 });
    expect(resolveTreeKey("ArrowUp", open, 1)).toEqual({ kind: "move", index: 0 });
    expect(resolveTreeKey("Home", open, 2)).toEqual({ kind: "move", index: 0 });
    expect(resolveTreeKey("End", open, 0)).toEqual({ kind: "move", index: 2 });
  });

  it("has nowhere to go past either end", () => {
    expect(resolveTreeKey("ArrowUp", open, 0)).toBeNull();
    expect(resolveTreeKey("ArrowDown", open, open.length - 1)).toBeNull();
  });

  it("opens a closed folder and goes no further", () => {
    // The child row does not exist until the open has been rendered, so a single press that did
    // both would be reaching for a row that isn't there yet.
    expect(resolveTreeKey("ArrowRight", closed, 0)).toEqual({ kind: "expand", path: "user" });
    // A second press steps in, which the rows are depth-first for.
    expect(resolveTreeKey("ArrowRight", open, 0)).toEqual({ kind: "move", index: 1 });
  });

  it("closes an open folder and otherwise steps out to the parent", () => {
    expect(resolveTreeKey("ArrowLeft", open, 0)).toEqual({ kind: "collapse", path: "user" });
    // On a child, out to the nearest row above it at a lower depth.
    expect(resolveTreeKey("ArrowLeft", open, 2)).toEqual({ kind: "move", index: 0 });
  });

  it("does nothing for a leaf's Right or a root's Left", () => {
    expect(resolveTreeKey("ArrowRight", open, 2)).toBeNull();
    expect(resolveTreeKey("ArrowLeft", closed, 0)).toBeNull();
  });

  it("leaves everything else to the browser", () => {
    expect(resolveTreeKey("a", open, 0)).toBeNull();
    expect(resolveTreeKey("Enter", open, 0)).toBeNull();
    // And answers nothing at all for a row that is not there.
    expect(resolveTreeKey("ArrowDown", open, 99)).toBeNull();
  });
});

describe("flatRows", () => {
  it("gives the same row shape at one depth, in scan order", () => {
    // One shape for both, so the rendering and the keyboard don't each need a second case.
    const rows = flatRows(keys("user:10", "user:2"));
    expect(rows.map((row) => [row.node.path, row.depth, row.open])).toEqual([
      ["user:10", 0, false],
      ["user:2", 0, false],
    ]);
    expect(rows.every((row) => row.node.children.length === 0)).toBe(true);
  });
});
