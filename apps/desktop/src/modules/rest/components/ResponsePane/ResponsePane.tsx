import { useEffect, useMemo, useState } from "react";
import ErrorBanner from "../../../../components/ErrorBanner";
import JsonView from "../../../../components/JsonView";
import { Tab, TabStrip, tabKeyDown } from "../../../../components/TabStrip";
import { useTranslation } from "../../../../i18n";
import {
  SOURCE_MAX_BYTES,
  availableModes,
  pickMode,
  type DetectedBody,
  type ViewMode,
} from "../../contentType";
import { buildDomTree } from "../../domTree";
import { formatBytes } from "../../format";
import { buildJsonTree, type TreeNode } from "../../jsonTree";
import type { RestResponse } from "../../types";
import HexView from "../HexView";
import HtmlPreview from "../HtmlPreview";
import ResponseStatusBar from "../ResponseStatusBar";
import TreeView from "../TreeView";
import styles from "./ResponsePane.module.css";

/** How much of a text body is put on screen. Past this the webview spends its time laying out
 *  characters nobody is reading. */
const MAX_TEXT = 5 * 1024 * 1024;

/**
 * The modes that exist so far.
 *
 * `availableModes` answers what a body *could* be shown as; this is what has been built. Task 14
 * adds `source` and Task 15 adds `preview`, one word each, and until then neither is ever offered
 * — which is what keeps every task in this plan something you can ship.
 */
const IMPLEMENTED: ViewMode[] = ["preview", "source", "raw"];

export interface SendState {
  phase: "idle" | "sending" | "done" | "cancelled" | "failed";
  /** The id `rest_cancel` names, while a send is in flight. */
  sendId: string | null;
  /** The URL that was actually sent, which is how a redirect is spotted. */
  sentUrl: string;
  response: RestResponse | null;
  bytes: Uint8Array | null;
  detected: DetectedBody | null;
  /** Already translated. A failed send keeps the previous response on screen underneath it. */
  error: string | null;
}

export const IDLE_SEND: SendState = {
  phase: "idle",
  sendId: null,
  sentUrl: "",
  response: null,
  bytes: null,
  detected: null,
  error: null,
};

interface Props {
  state: SendState;
  /** The viewer the user last chose, kept even while this body cannot be shown in it. */
  preferred: ViewMode;
  onPreferredChange: (mode: ViewMode) => void;
  headersOpen: boolean;
  onHeadersOpenChange: (open: boolean) => void;
  onDismissError: () => void;
}

/** The right-hand pane: the status line, four tabs, and whichever of them is open. */
function ResponsePane({
  state,
  preferred,
  onPreferredChange,
  headersOpen,
  onHeadersOpenChange,
  onDismissError,
}: Props) {
  const { t } = useTranslation();
  const [wrap, setWrap] = useState(false);

  const { response, bytes, detected } = state;
  const size = bytes?.length ?? 0;
  const possible = detected === null ? [] : availableModes(detected.kind, size);
  const offered = possible.filter((mode) => IMPLEMENTED.includes(mode));
  const mode = offered.length === 0 ? null : pickMode(preferred, offered);

  const tabs: { key: ViewMode | "headers"; label: string }[] = [
    ...offered.map((m) => ({
      key: m,
      label:
        m === "preview"
          ? t("rest.previewTab")
          : m === "source"
            ? t("rest.sourceTab")
            : t("rest.rawTab"),
    })),
    ...(response === null
      ? []
      : [
          {
            key: "headers" as const,
            label: t("rest.responseHeadersTab", { n: response.headers.length }),
          },
        ]),
  ];

  /** The tree for this body, or null when it will not parse — which drops the viewer to Raw. */
  const tree = useMemo<TreeNode | null>(() => {
    if (detected === null || detected.text === null) return null;
    if (detected.kind === "json") {
      try {
        return buildJsonTree(JSON.parse(detected.text));
      } catch {
        return null;
      }
    }
    if (detected.kind === "html" || detected.kind === "xml") {
      return buildDomTree(detected.text, detected.kind);
    }
    return null;
  }, [detected]);

  /** A blob URL for an image body, revoked when the body changes. Left as the empty string for
   *  anything that is not an image — creating one for a 12 MB PDF nobody will look at is waste. */
  const [imageUrl, setImageUrl] = useState("");
  useEffect(() => {
    if (detected?.kind !== "image" || bytes === null) {
      setImageUrl("");
      return;
    }
    const url = URL.createObjectURL(new Blob([bytes], { type: detected.mime || "image/png" }));
    setImageUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [detected, bytes]);

  function view() {
    if (headersOpen && response !== null) {
      return (
        <div className={styles.headers}>
          {response.headers.map(([name, value], i) => (
            // Keyed on the position: a header may appear twice with the same name and value, and
            // the order they arrived in is part of what the tab is for.
            <div key={`${name}-${i}`} style={{ display: "contents" }}>
              <span className={styles.headerName}>{name}</span>
              <span className={styles.headerValue}>{value}</span>
            </div>
          ))}
        </div>
      );
    }
    if (bytes === null || detected === null || mode === null) {
      return <p className="rest-empty muted">{t("rest.responseEmpty")}</p>;
    }
    if (mode === "preview") {
      if (detected.kind === "json" && detected.text !== null) {
        try {
          return <JsonView value={JSON.parse(detected.text)} />;
        } catch {
          // Called JSON, is not. The text as it came is more use than an error.
          return <pre className={styles.raw}>{detected.text}</pre>;
        }
      }
      if (detected.kind === "html" && detected.text !== null) {
        return <HtmlPreview html={detected.text} finalUrl={response?.final_url ?? ""} />;
      }
      if (detected.kind === "image") {
        return imageUrl === "" ? null : (
          <img className={styles.image} src={imageUrl} alt={t("rest.previewTab")} />
        );
      }
      // PDF and anything else binary: what it is and how big, which is all that can honestly be
      // said without a viewer. Saving a response to a file is out of scope for this phase.
      return (
        <div className={styles.card}>
          <p>
            {t("rest.binaryBody", {
              mime: detected.mime || t("rest.binaryHint"),
              size: formatBytes(response?.body_size ?? bytes.length),
            })}
          </p>
          <p className="muted">{t("rest.binaryHint")}</p>
        </div>
      );
    }
    if (mode === "source") {
      // A body that would not parse has no tree, so Raw is what is left — the same fallback the
      // tab strip applies, arrived at one step later.
      if (tree === null) return <p className="rest-empty muted">{t("rest.responseEmpty")}</p>;
      return <TreeView root={tree} />;
    }
    if (mode === "raw") {
      if (detected.text === null) {
        return <HexView bytes={bytes} totalSize={response?.body_size ?? bytes.length} />;
      }
      const shown = detected.text.slice(0, MAX_TEXT);
      return (
        <>
          <label className={styles.toolbar}>
            <input type="checkbox" checked={wrap} onChange={(e) => setWrap(e.target.checked)} />
            {t("rest.wrapLines")}
          </label>
          {shown.length < detected.text.length && (
            <p className={`${styles.notice} muted`}>
              {t("rest.truncatedNotice", {
                shown: formatBytes(MAX_TEXT),
                total: formatBytes(response?.body_size ?? bytes.length),
              })}
            </p>
          )}
          <pre className={`${styles.raw}${wrap ? ` ${styles.rawWrapped}` : ""}`}>{shown}</pre>
        </>
      );
    }
    // Unreachable: `mode` is one of the three above, and `IMPLEMENTED` now holds all of them.
    return null;
  }

  return (
    <div className={styles.pane}>
      <ResponseStatusBar state={state} />
      {state.error !== null && <ErrorBanner message={state.error} onDismiss={onDismissError} />}
      {tabs.length > 0 && (
        <TabStrip size="small" role="tablist">
          {tabs.map((tab) => {
            const selected = tab.key === "headers" ? headersOpen : !headersOpen && tab.key === mode;
            const pick = () => {
              if (tab.key === "headers") {
                onHeadersOpenChange(true);
                return;
              }
              onHeadersOpenChange(false);
              onPreferredChange(tab.key);
            };
            return (
              <Tab
                key={tab.key}
                active={selected}
                role="tab"
                aria-selected={selected}
                tabIndex={0}
                onClick={pick}
                onKeyDown={tabKeyDown(pick)}
              >
                {tab.label}
              </Tab>
            );
          })}
        </TabStrip>
      )}
      {detected !== null && size > SOURCE_MAX_BYTES && !headersOpen && (
        <p className={`${styles.notice} muted`}>
          {t("rest.sourceTooBig", { limit: formatBytes(SOURCE_MAX_BYTES) })}
        </p>
      )}
      <div className={styles.body}>{view()}</div>
    </div>
  );
}

export default ResponsePane;
