import { useState } from "react";
import ContextMenu from "../../../../components/ContextMenu";
import { copyText } from "../../../../core/clipboard";
import { ChevronDownIcon, ChevronRightIcon } from "../../../../icons";
import { useTranslation } from "../../../../i18n";
import type { TreeNode } from "../../jsonTree";
import styles from "./TreeView.module.css";

interface Props {
  root: TreeNode;
}

interface MenuState {
  node: TreeNode;
  x: number;
  y: number;
}

/**
 * How deep the tree opens on arrival.
 *
 * Everything closed is a wall, and everything open is the Raw tab with more indentation.
 */
const OPEN_DEPTH = 2;

/**
 * The Source tab: a body as a tree that folds.
 *
 * Written here rather than borrowed from the database module's `DocumentNode`, which does a
 * similar job — that one lives behind the module boundary and may not be imported across it, and
 * it is an editor besides. This one only reads.
 */
function TreeView({ root }: Props) {
  const { t } = useTranslation();
  // What the user has toggled, whichever way. Read against the depth default rather than as an
  // open/closed flag, so nothing has to be seeded when a new body arrives.
  const [toggled, setToggled] = useState<Set<string>>(new Set());
  const [menu, setMenu] = useState<MenuState | null>(null);

  function toggle(path: string) {
    setToggled((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  function draw(node: TreeNode, depth: number) {
    const branch = node.children !== null && node.children.length > 0;
    const openByDefault = depth < OPEN_DEPTH;
    const open = branch && (toggled.has(node.path) ? !openByDefault : openByDefault);

    return (
      <div key={node.path} className={styles.node}>
        <div
          className={styles.line}
          onContextMenu={(e) => {
            e.preventDefault();
            setMenu({ node, x: e.clientX, y: e.clientY });
          }}
        >
          {branch ? (
            <button
              type="button"
              className={styles.toggle}
              aria-expanded={open}
              aria-label={open ? t("rest.collapseAll") : t("rest.expandAll")}
              onClick={() => toggle(node.path)}
            >
              {open ? <ChevronDownIcon size="0.85em" /> : <ChevronRightIcon size="0.85em" />}
            </button>
          ) : (
            <span className={styles.toggle} />
          )}
          <span className={styles.label}>{node.label}</span>
          {node.value !== null && <span className={styles.value}>{node.value}</span>}
          {node.summary !== null && !open && <span className={styles.summary}>{node.summary}</span>}
        </div>
        {open && node.children?.map((child) => draw(child, depth + 1))}
      </div>
    );
  }

  return (
    <div className={styles.tree}>
      {draw(root, 0)}
      {menu && (
        <ContextMenu x={menu.x} y={menu.y} onClose={() => setMenu(null)}>
          <button
            type="button"
            onClick={() => {
              // A refusal is reported by `copyText`; nothing here has a banner to put it on, so
              // it is swallowed rather than left as an unhandled rejection.
              void copyText(menu.node.value ?? menu.node.summary ?? "").catch(() => {});
              setMenu(null);
            }}
          >
            {t("rest.copyValue")}
          </button>
          <button
            type="button"
            onClick={() => {
              void copyText(menu.node.path).catch(() => {});
              setMenu(null);
            }}
          >
            {t("rest.copyPath")}
          </button>
        </ContextMenu>
      )}
    </div>
  );
}

export default TreeView;
