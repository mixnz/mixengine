import { useEffect, useState } from "react";

import Button from "../../../../components/Button";
import Card from "../../../../components/Card";
import EmptyState from "../../../../components/EmptyState";
import ErrorBanner from "../../../../components/ErrorBanner";
import PageHeader from "../../../../components/PageHeader";
import SegmentedControl from "../../../../components/SegmentedControl";
import Select from "../../../../components/Select";
import { HistoryIcon } from "../../../../icons";
import { errorMessage } from "../../../../core/errors";
import { useTailScroll } from "../../../../core/tailScroll";
import { useTranslation } from "../../../../i18n";
import * as api from "../../api";
import { applyLogFrame, type LogEntry } from "../../logState";
import { takePendingLogsService } from "../../logsNavigation";
import styles from "./Logs.module.css";

const MAX_ENTRIES = 2000;
const INITIAL_TAIL = 200;

type StreamFilter = "all" | "stdout" | "stderr";

export default function Logs({ active }: { active: boolean }) {
  const [ids, setIds] = useState<string[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [tail, setTail] = useState(INITIAL_TAIL);
  const [filter, setFilter] = useState<StreamFilter>("all");
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [error, setError] = useState("");
  const { t } = useTranslation();

  // Read the service list again on mount and on every return to this screen — the same reason
  // `Dashboard.tsx` and `ServicesDetail.tsx` have.
  useEffect(() => {
    if (!active) return;
    // A row menu elsewhere may have asked for one service — see `logsNavigation.ts`.
    const requested = takePendingLogsService();
    if (requested !== null) {
      setSelected(requested);
      setTail(INITIAL_TAIL);
    }
    api
      .services()
      .then((list) => setIds(list.services.map((s) => s.id)))
      .catch((e: unknown) => setError(errorMessage(t, e)));
  }, [active, t]);

  useEffect(() => {
    if (selected === null) return;
    setEntries([]);
    api
      .logsWatch(selected, tail, true, (raw) => {
        setEntries((current) => applyLogFrame(current, raw, MAX_ENTRIES));
      })
      .catch((e: unknown) => setError(errorMessage(t, e)));
    return () => {
      void api.logsUnwatch();
    };
  }, [selected, tail, t]);

  const visible = entries.filter((entry) => {
    if (filter === "all") return true;
    if (entry.kind !== "line") return true; // gap/historic always shown — filter is stream-only
    return entry.stream === filter;
  });

  const linePane = useTailScroll<HTMLDivElement>(visible);

  return (
    <div className={`mixengine-page ${styles.screen}`}>
      {error !== "" && <ErrorBanner message={error} onDismiss={() => setError("")} />}

      <PageHeader
        title={t("mixengine.sidebar.logs")}
        description={t("mixengine.logs.about")}
        actions={
          <>
            <Select
              className={styles.service}
              value={selected ?? ""}
              onChange={(id) => {
                setSelected(id);
                setTail(INITIAL_TAIL);
              }}
              searchable
              placeholder={t("mixengine.logs.pickService")}
              ariaLabel={t("mixengine.logs.service")}
              options={ids.map((id) => ({ value: id, label: id }))}
            />
            <SegmentedControl
              aria-label={t("mixengine.logs.stream")}
              value={filter}
              onChange={setFilter}
              segments={[
                { value: "all", label: t("mixengine.logs.streamAll") },
                { value: "stdout", label: t("mixengine.logs.streamStdout") },
                { value: "stderr", label: t("mixengine.logs.streamStderr") },
              ]}
            />
          </>
        }
      />

      <Card
        flush
        className={styles.card}
        title={selected ?? t("mixengine.logs.pickService")}
        actions={
          selected !== null && (
            <Button size="small" onClick={() => setTail((current) => current * 2)}>
              <HistoryIcon size={14} />
              {t("mixengine.logs.loadMore")}
            </Button>
          )
        }
      >
        {selected === null ? (
          <EmptyState title={t("mixengine.logs.pickService")} />
        ) : (
          <div className={styles.lines} data-density="compact" {...linePane}>
            {visible.length === 0 && <p className={styles.empty}>{t("mixengine.logs.empty")}</p>}
            {visible.map((entry, i) => {
              if (entry.kind === "gap") {
                return (
                  <div key={i} className={styles.gap}>
                    {t("mixengine.logs.gap", { count: entry.missed })}
                  </div>
                );
              }
              return (
                <div
                  key={i}
                  className={entry.kind === "line" && entry.stream === "stderr" ? styles.stderr : styles.line}
                >
                  {entry.text}
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}