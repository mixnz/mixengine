import { useCallback, useEffect, useMemo, useState } from "react";
import Button from "../../../../components/Button";
import Input from "../../../../components/Input";
import Select, { type SelectOption } from "../../../../components/Select";
import { errorMessage } from "../../../../core/errors";
import { useTranslation } from "../../../../i18n";
import CopyField from "../../components/CopyField";
import { listeningPorts, type ListeningPort } from "./api";
import { matchesFilter } from "./filter";
import { hostOs, killByPid, killByPort, type KillOs } from "./kill";
import styles from "./Panel.module.css";

/** Nhãn là tên hệ điều hành, nên không dịch. */
const OSES: SelectOption<KillOs>[] = [
  { value: "macos", label: "macOS" },
  { value: "linux", label: "Linux" },
  { value: "windows", label: "Windows" },
];

function PortsPanel() {
  const { t } = useTranslation();
  const [ports, setPorts] = useState<ListeningPort[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<ListeningPort | null>(null);
  /* Số cổng của khối lệnh kill, tách khỏi bảng. Bấm một hàng thì điền vào đây, nhưng gõ tay cũng
     được — nhu cầu thật là giết một cổng trên **máy khác**, máy mà bảng này không thấy. */
  const [killPort, setKillPort] = useState("");
  // Mặc định theo máy đang chạy, nhưng đổi tay được: người ngồi Windows vẫn hay cần lệnh Linux.
  const [os, setOs] = useState<KillOs>(hostOs);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setBusy(true);
    setError(null);
    void listeningPorts()
      .then((rows) => {
        setPorts(rows);
        // Cổng đang chọn có thể đã đóng giữa hai lần tải.
        setSelected((current) =>
          current && rows.some((row) => row.pid === current.pid && row.port === current.port)
            ? current
            : null,
        );
      })
      .catch((e: unknown) => {
        setError(errorMessage(t, e));
        setPorts([]);
      })
      .finally(() => setBusy(false));
    // `t` không nằm trong deps: nó đổi khi người dùng đổi ngôn ngữ, và một lần quét lại vì
    // chuyện đó là quét thừa.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(load, [load]);

  const shown = useMemo(
    () => (ports ?? []).filter((row) => matchesFilter(row, filter)),
    [ports, filter],
  );

  return (
    <div className={styles.panel}>
      <div className={styles.controls}>
        <Button variant="primary" onClick={load} disabled={busy}>
          {busy ? t("common.loading") : t("toolbox.ports.refresh")}
        </Button>
        <Input
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder={t("toolbox.ports.filter")}
          aria-label={t("toolbox.ports.filter")}
          className={styles.filter}
        />
      </div>

      {error ? <p className={styles.error}>{error}</p> : null}

      {ports !== null && ports.length === 0 && !error ? (
        <p className={styles.note}>{t("toolbox.ports.empty")}</p>
      ) : null}

      {shown.length === 0 && (ports?.length ?? 0) > 0 ? (
        <p className={styles.note}>{t("toolbox.ports.noMatch")}</p>
      ) : null}

      {shown.length > 0 ? (
        <div className={styles.table}>
          <div className={`${styles.row} ${styles.head}`}>
            <span>{t("toolbox.ports.colPort")}</span>
            <span>{t("toolbox.ports.colAddress")}</span>
            <span>{t("toolbox.ports.colPid")}</span>
            <span>{t("toolbox.ports.colProcess")}</span>
          </div>
          {shown.map((row) => {
            const isSelected = selected?.pid === row.pid && selected?.port === row.port;
            return (
              <button
                key={`${row.address}:${row.port}:${row.pid}`}
                type="button"
                className={isSelected ? `${styles.row} ${styles.selected}` : styles.row}
                aria-current={isSelected ? "true" : undefined}
                onClick={() => {
                  setSelected(row);
                  setKillPort(String(row.port));
                }}
              >
                <span title={String(row.port)}>{row.port}</span>
                <span title={row.address}>{row.address}</span>
                <span title={String(row.pid)}>{row.pid}</span>
                <span
                  className={row.process ? undefined : styles.dim}
                  title={row.process ?? undefined}
                >
                  {row.process ?? t("toolbox.ports.unknownProcess")}
                </span>
              </button>
            );
          })}
        </div>
      ) : null}

      {/* Khối này **không phụ thuộc vào bảng ở trên**: nhu cầu thật hay gặp là giết một cổng trên
          một máy khác, có thể khác hệ điều hành, mà bảng của máy này không thấy. Chọn OS, gõ số
          cổng, chép lệnh. */}
      <section className={styles.kill}>
        <h3 className={styles.killTitle}>{t("toolbox.ports.killTitle")}</h3>
        <div className={styles.controls}>
          <Select
            value={os}
            options={OSES}
            onChange={setOs}
            ariaLabel={t("toolbox.ports.os")}
            className={styles.os}
          />
          <Input
            value={killPort}
            onChange={(event) => setKillPort(event.target.value.replace(/[^\d]/g, ""))}
            placeholder={t("toolbox.ports.portInput")}
            aria-label={t("toolbox.ports.portInput")}
            className={styles.port}
            inputMode="numeric"
          />
        </div>

        {killPort !== "" ? (
          <CopyField
            label={`${t("toolbox.ports.byPort")} · ${killPort}`}
            value={killByPort(os, Number(killPort))}
          />
        ) : null}

        {/* Lệnh theo PID chỉ có nghĩa với một hàng của **máy này**: PID của máy khác thì bảng
            không biết. */}
        {selected ? (
          <CopyField
            label={`${t("toolbox.ports.byPid")} · ${selected.pid}`}
            value={killByPid(os, selected.pid)}
          />
        ) : null}

        <p className={styles.note}>{t("toolbox.ports.note")}</p>
      </section>
    </div>
  );
}

export default PortsPanel;
