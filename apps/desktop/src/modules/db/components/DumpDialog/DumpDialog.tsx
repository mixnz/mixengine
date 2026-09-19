import { useState } from "react";
import RadioCard from "../../../../components/RadioCard";
import { useTranslation } from "../../../../i18n";
import type { SqlDumpMode } from "../../sql/api";
import styles from "./DumpDialog.module.css";
import Modal, { ModalBody } from "../../../../components/Modal";

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
      title={t("dump.dumpTitle", { database })}
      size="small"
      actions={[
        { kind: "cancel", label: t("common.cancel") },
        {
          kind: "confirm",
          label: t("dump.chooseFile"),
          // The file picker this opens is a window of its own, so the dialog gets out of its way
          // first rather than being covered mid-animation.
          onClick: () => onSubmit(mode),
          closes: true,
        },
      ]}
    >
      {() => (
        <ModalBody>
          <div className={styles.modes}>
            {offered.map((option) => (
              <RadioCard
                key={option.mode}
                name="dump-mode"
                checked={mode === option.mode}
                onChange={() => setMode(option.mode)}
                label={t(option.labelKey)}
                description={t(option.hintKey)}
              />
            ))}
          </div>
        </ModalBody>
      )}
    </Modal>
  );
}

export default DumpDialog;
