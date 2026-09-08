import { useEffect, useState } from "react";
import { useTranslation } from "../../../../i18n";
import { previewClose, previewOpen } from "../../api";
import { previewDocument } from "../../previewDocument";
import styles from "./HtmlPreview.module.css";

interface Props {
  html: string;
  /** Where the response ended up, which is what external resources would be resolved against. */
  finalUrl: string;
}

/**
 * A rendered HTML response, behind the tightest sandbox there is.
 *
 * `sandbox` is present and starts **empty**: no scripts, no same-origin, no forms and no top-level
 * navigation. Two switches loosen it, both off every time this pane is drawn, and both deliberately
 * here rather than in Settings — a decision about a response belongs beside that response, not in a
 * dialog where it was made three weeks ago about something else.
 *
 * Neither switch ever adds `allow-same-origin`. That flag next to `allow-scripts` is not a looser
 * sandbox, it is no sandbox: the frame would share the app's origin and from there reach Tauri's
 * IPC. Nothing here offers it.
 *
 * *Load external resources* adds a `<base href>`, so images, stylesheets and tracking pixels reach
 * the server again. *Run scripts* adds `allow-scripts`, so the page's own script runs — on the app's
 * main thread, which is the honest reason it stays a per-response decision: a response that loops
 * forever takes the window with it, and the way out is not a checkbox you can still click.
 *
 * The document is **served**, not handed over as `srcdoc`. A `srcdoc` frame inherits the app's CSP
 * and neither switch can lift it, so in a packaged build both did nothing at all; `preview.rs`
 * carries the whole reason. What that costs here is a round trip before the frame has anything to
 * point at, and one parked document to drop when the pane goes.
 */
function HtmlPreview({ html, finalUrl }: Props) {
  const { t } = useTranslation();
  const [external, setExternal] = useState(false);
  const [scripts, setScripts] = useState(false);
  const [src, setSrc] = useState("");

  useEffect(() => {
    let live = true;
    let opened: string | null = null;
    setSrc("");

    previewOpen(previewDocument(html, finalUrl, external), external, scripts)
      .then((doc) => {
        opened = doc.id;
        // The pane was closed, or a switch flipped, while the document was being parked. Nothing
        // will ever load it, so it goes straight back rather than waiting on the cap in `preview.rs`.
        if (live) setSrc(doc.url);
        else void previewClose(doc.id);
      })
      .catch(() => {
        // The one call that cannot fail on its own terms: it hands a string to the backend and
        // gets an id. If it did, an empty frame is what is left to show.
      });

    return () => {
      live = false;
      if (opened !== null) void previewClose(opened);
    };
  }, [html, finalUrl, external, scripts]);

  return (
    <div className={styles.preview}>
      <div className={styles.toolbar}>
        <label className={styles.switch} title={t("rest.loadExternalHint")}>
          <input
            type="checkbox"
            checked={external}
            onChange={(e) => setExternal(e.target.checked)}
          />
          {t("rest.loadExternal")}
        </label>
        <label className={styles.switch} title={t("rest.runScriptsHint")}>
          <input type="checkbox" checked={scripts} onChange={(e) => setScripts(e.target.checked)} />
          {t("rest.runScripts")}
        </label>
      </div>
      {src !== "" && (
        <iframe
          // Remounted when either switch is flipped: a sandbox is read once at load, and the
          // document behind `src` is a different one — served under a different policy.
          key={`${external ? "external" : "isolated"}-${scripts ? "scripts" : "inert"}`}
          className={styles.frame}
          sandbox={scripts ? "allow-scripts" : ""}
          src={src}
          title={t("rest.previewTab")}
        />
      )}
    </div>
  );
}

export default HtmlPreview;
