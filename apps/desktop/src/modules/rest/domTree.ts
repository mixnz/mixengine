import type { TreeNode } from "./jsonTree";

/**
 * An HTML or XML body as a tree.
 *
 * Not covered by `npm test`, and it cannot be: `DOMParser` is a webview API and the test run has
 * no DOM. That is exactly why the part that *can* be tested — which kinds get a Source tab at all
 * — lives in `contentType.ts` instead of here.
 *
 * `parseFromString` with `text/html` runs no script and fetches nothing: it builds a document and
 * stops. There is no way for a response to act on the app through this.
 */

/** An element written the way it would be recognised: `div#main.card`. */
function elementLabel(element: Element): string {
  const id = element.id !== "" ? `#${element.id}` : "";
  const classes = Array.from(element.classList, (name) => `.${name}`).join("");
  return `${element.tagName.toLowerCase()}${id}${classes}`;
}

function fromNode(node: Node, path: string, index: number): TreeNode | null {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent?.trim() ?? "";
    // Whitespace between tags is not content, and a tree full of it is unreadable.
    if (text === "") return null;
    return {
      path: `${path}/text()[${index}]`,
      label: "#text",
      value: text,
      summary: null,
      children: null,
    };
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return null;

  const element = node as Element;
  const here = `${path}/${element.tagName.toLowerCase()}[${index}]`;
  const attributes: TreeNode[] = Array.from(element.attributes, (attr) => ({
    path: `${here}/@${attr.name}`,
    label: `@${attr.name}`,
    value: attr.value,
    summary: null,
    children: null,
  }));
  const children = Array.from(element.childNodes)
    .map((child, i) => fromNode(child, here, i))
    .filter((child): child is TreeNode => child !== null);
  const all = [...attributes, ...children];

  return {
    path: here,
    label: elementLabel(element),
    value: null,
    summary: `<${all.length}>`,
    children: all,
  };
}

/** The tree for a document, or null when it will not parse — which is what takes the Source tab
 *  away and drops the viewer to Raw. */
export function buildDomTree(text: string, kind: "html" | "xml"): TreeNode | null {
  const doc = new DOMParser().parseFromString(
    text,
    kind === "html" ? "text/html" : "application/xml",
  );
  // The XML parser reports a failure as a document containing one of these rather than by throwing.
  if (doc.querySelector("parsererror") !== null) return null;
  const root = doc.documentElement;
  if (!root) return null;
  return fromNode(root, "", 0);
}
