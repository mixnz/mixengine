import { useState } from "react";
import Button from "../../../../components/Button";
import { useTranslation } from "../../../../i18n";
import type { SqlDumpMode } from "../../sql/api";
import styles from "./DumpDialog.module.css";
import Modal from "../../../../components/Modal";

/** The three choices, in the order they are offered: the whole thing first, since that is what a
 * backup means, and the two halves after it. */
const MODES: { mode: SqlDumpMode; labelKey: "dump.modeAll" | "dump.modeStructure" | "dump.modeData"; hintKey: "dump.modeAllHint" | "dump.modeStructureHint" | "dump.modeDataHint" }[] = [
  { mode: "all", labelKey: "dump.modeAll", hintKey: "dump.modeAllHint" },
  { mode: "structure", labelKey: "dump.modeStructure", hintKey: "dump.modeStructureHint" },
  { mode: "data", labelKey: "dump.modeData", hintKey: "dump.modeDataHint" },
];

interface Props {
  /** The modes to offer, in the order they are shown. Defaults to all three; an engine whose dump
   *  cannot carry rows passes the one it can write, so the choice on screen is a choice that
   *  works. */
  modes?: SqlDumpMode[];
  database: string;
  onCancel: () => void;
  /** Given the chosen mode. The file to write to is asked for after this, by the caller. */
  onSubmit: (mode: SqlDumpMode) => void;
}

/** What of a MySQL database to write out. Only MySQL asks: a mongodump archive is whole or not
 *  at all. */
function DumpDialog({ database, modes, onCancel, onSubmit }: Props) {
  const { t } = useTranslation();
  const offered = modes === undefined ? MODES : MODES.filter((m) => modes.includes(m.mode));
  const [mode, setMode] = useState<SqlDumpMode>(offered[0]?.mode ?? "all");

  return (
    <Modal
      label={database}
      onClose={onCancel}
      overlayClassName={styles.overlay}
      className={styles.dialog}
    >
      {(close) => (
        <>
          <h3 className={styles.title}>{t("dump.dumpTitle", { database })}</h3>

          <div className={styles.modes}>
            {offered.map((option) => (
              <label key={option.mode} className={styles.mode}>
                <input
                  type="radio"
                  name="dump-mode"
                  checked={mode === option.mode}
                  onChange={() => setMode(option.mode)}
                />
                <span>
                  <span className={styles.modeLabel}>{t(option.labelKey)}</span>
                  <span className={styles.modeHint}>{t(option.hintKey)}</span>
                </span>
              </label>
            ))}
          </div>

          <div className={styles.actions}>
            <Button size="large" onClick={() => close(onCancel)}>
              {t("common.cancel")}
            </Button>
            {/* The file picker this opens is a window of its own, so the dialog gets out of its way
                first rather than being covered mid-animation. */}
            <Button size="large" variant="primary" onClick={() => close(() => onSubmit(mode))}>
              {t("dump.chooseFile")}
            </Button>
          </div>
        </>
      )}
    </Modal>
  );
}

export default DumpDialog;
