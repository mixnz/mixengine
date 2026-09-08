import { useMemo, useState } from "react";
import { Textarea } from "../../../../components/Input";
import { useTranslation, type TranslationKey } from "../../../../i18n";
import { formatJson } from "../format/json";
import {
  buildSplitRows,
  computeLineSegments,
  diffLines,
  type DiffLine,
  type DiffOptions,
  type DiffResult,
  type DiffSegment,
  type SplitCell,
} from "./diff";
import styles from "./Panel.module.css";

const MARK: Record<DiffLine["kind"], string> = { same: " ", add: "+", remove: "−" };

type ViewMode = "unified" | "split";

const VIEW_MODES: ViewMode[] = ["unified", "split"];

const VIEW_MODE_LABEL: Record<ViewMode, TranslationKey> = {
  unified: "toolbox.diff.viewUnified",
  split: "toolbox.diff.viewSplit",
};

/** Render text nguyên dòng, hoặc — khi có segment — với đúng đoạn `changed` tô đậm hơn. */
function LineText({ text, segments }: { text: string; segments: DiffSegment[] | null }) {
  if (segments === null) return <>{text}</>;
  return (
    <>
      {segments.map((segment, index) => (
        <span key={index} className={segment.changed ? styles.seg : undefined}>
          {segment.text}
        </span>
      ))}
    </>
  );
}

function DiffPanel() {
  const { t } = useTranslation();
  const [left, setLeft] = useState("");
  const [right, setRight] = useState("");
  const [ignoreWhitespace, setIgnoreWhitespace] = useState(false);
  const [ignoreCase, setIgnoreCase] = useState(false);
  const [asJson, setAsJson] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("unified");

  const options = useMemo<DiffOptions>(() => ({ ignoreWhitespace, ignoreCase }), [ignoreWhitespace, ignoreCase]);

  const outcome = useMemo<DiffResult | "notJson" | null>(() => {
    if (left === "" && right === "") return null;
    let a = left;
    let b = right;
    if (asJson) {
      // Chuẩn hoá thụt lề cả hai bên trước, nên JSON viết một dòng và viết thụt lề không còn khác
      // nhau. **Không sắp xếp khoá**: đổi thứ tự khoá là một khác biệt thật.
      const fa = formatJson(left, "  ");
      const fb = formatJson(right, "  ");
      if (!fa.ok || !fb.ok) return "notJson";
      a = fa.output;
      b = fb.output;
    }
    return diffLines(a, b, options);
  }, [left, right, options, asJson]);

  const lineSegments = useMemo(() => {
    if (outcome === null || outcome === "notJson" || !outcome.ok) return null;
    return computeLineSegments(outcome.lines, options);
  }, [outcome, options]);

  const splitRows = useMemo(() => {
    if (viewMode !== "split" || outcome === null || outcome === "notJson" || !outcome.ok) return null;
    return buildSplitRows(outcome.lines, options);
  }, [viewMode, outcome, options]);

  return (
    <div className={styles.panel}>
      <div className={styles.pair}>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>{t("toolbox.diff.left")}</span>
          <Textarea value={left} onChange={(event) => setLeft(event.target.value)} maxRows={12} />
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>{t("toolbox.diff.right")}</span>
          <Textarea value={right} onChange={(event) => setRight(event.target.value)} maxRows={12} />
        </label>
      </div>

      <div className={styles.controls}>
        <label className={styles.check}>
          <input
            type="checkbox"
            checked={ignoreWhitespace}
            onChange={(event) => setIgnoreWhitespace(event.target.checked)}
          />
          {t("toolbox.diff.ignoreWhitespace")}
        </label>
        <label className={styles.check}>
          <input
            type="checkbox"
            checked={ignoreCase}
            onChange={(event) => setIgnoreCase(event.target.checked)}
          />
          {t("toolbox.diff.ignoreCase")}
        </label>
        <label className={styles.check}>
          <input
            type="checkbox"
            checked={asJson}
            onChange={(event) => setAsJson(event.target.checked)}
          />
          {t("toolbox.diff.asJson")}
        </label>
      </div>

      {outcome === "notJson" ? <p className={styles.error}>{t("toolbox.diff.notJson")}</p> : null}
      {outcome !== null && outcome !== "notJson" && !outcome.ok ? (
        <p className={styles.error}>{t("toolbox.diff.tooLarge")}</p>
      ) : null}

      {outcome !== null && outcome !== "notJson" && outcome.ok ? (
        <>
          <div className={styles.resultHead}>
            <p className={styles.counts}>
              {outcome.added === 0 && outcome.removed === 0
                ? t("toolbox.diff.identical")
                : t("toolbox.diff.counts", { added: outcome.added, removed: outcome.removed })}
            </p>
            <div className={styles.tabs} role="tablist">
              {VIEW_MODES.map((mode) => (
                <button
                  key={mode}
                  type="button"
                  role="tab"
                  aria-selected={mode === viewMode}
                  className={mode === viewMode ? `${styles.tab} ${styles.active}` : styles.tab}
                  onClick={() => setViewMode(mode)}
                >
                  {t(VIEW_MODE_LABEL[mode])}
                </button>
              ))}
            </div>
          </div>

          {viewMode === "unified" ? (
            <div className={styles.result}>
              {outcome.lines.map((line, index) => (
                <div
                  key={`${line.kind}:${line.leftNo}:${line.rightNo}:${index}`}
                  className={`${styles.line}${line.kind === "add" ? ` ${styles.add}` : ""}${
                    line.kind === "remove" ? ` ${styles.remove}` : ""
                  }`}
                >
                  <span className={styles.no}>{line.leftNo ?? ""}</span>
                  <span className={styles.no}>{line.rightNo ?? ""}</span>
                  <span>
                    {MARK[line.kind]} <LineText text={line.text} segments={lineSegments?.get(line) ?? null} />
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className={styles.splitGrid}>
              {splitRows?.map((row, index) => (
                <div className={styles.splitRow} key={index}>
                  <SplitHalf cell={row.left} side="left" />
                  <SplitHalf cell={row.right} side="right" />
                </div>
              ))}
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}

/**
 * Hai `<span>` — số dòng và nội dung — chứ không phải một `<div>` bọc ngoài: `.splitGrid` xếp bốn
 * cột (số/nội dung x trái/phải) bằng CSS Grid trên chính các span này, để một hàng dài phải xuống
 * dòng thì Grid tự canh chiều cao hai bên bằng nhau, không cần đo bằng JS.
 */
function SplitHalf({ cell, side }: { cell: SplitCell; side: "left" | "right" }) {
  const divider = side === "right" ? styles.splitRight : "";
  const tone = cell.kind === "add" ? styles.add : cell.kind === "remove" ? styles.remove : "";
  if (cell.kind === "blank") {
    return (
      <>
        <span className={`${styles.no} ${divider} ${styles.blank}`} />
        <span className={`${styles.splitText} ${styles.blank}`} />
      </>
    );
  }
  return (
    <>
      <span className={`${styles.no} ${divider} ${tone}`}>{cell.no}</span>
      <span className={`${styles.splitText} ${tone}`}>
        <LineText text={cell.text} segments={cell.segments} />
      </span>
    </>
  );
}

export default DiffPanel;
