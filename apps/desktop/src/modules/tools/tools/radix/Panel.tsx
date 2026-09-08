import { useState } from "react";
import Input from "../../../../components/Input";
import Select, { type SelectOption } from "../../../../components/Select";
import { useTranslation, type TranslationKey } from "../../../../i18n";
import CopyField from "../../components/CopyField";
import { BASES, detectBase, formatOutputs, parseValue, type Base } from "./radix";
import styles from "./Panel.module.css";

type BaseChoice = "auto" | Base;

const BASE_LABEL: Record<Base, TranslationKey> = {
  bin: "toolbox.radix.bin",
  oct: "toolbox.radix.oct",
  dec: "toolbox.radix.dec",
  hex: "toolbox.radix.hex",
};

const GUESSED: Record<Base, TranslationKey> = {
  bin: "toolbox.radix.guessedBin",
  oct: "toolbox.radix.guessedOct",
  dec: "toolbox.radix.guessedDec",
  hex: "toolbox.radix.guessedHex",
};

function RadixPanel() {
  const { t } = useTranslation();
  const [input, setInput] = useState("");
  const [inputBase, setInputBase] = useState<BaseChoice>("auto");

  const inputBaseOptions: SelectOption<BaseChoice>[] = [
    { value: "auto", label: t("toolbox.radix.auto") },
    ...BASES.map((base) => ({ value: base, label: t(BASE_LABEL[base]) })),
  ];

  const trimmed = input.trim();
  const detected = inputBase === "auto" ? detectBase(trimmed) : inputBase;
  const value = detected === null ? null : parseValue(trimmed, detected);
  const outputs = value === null ? null : formatOutputs(value);

  const guess = inputBase === "auto" && detected !== null ? t(GUESSED[detected]) : null;

  return (
    <div className={styles.panel}>
      <div className={styles.controls}>
        <Input
          value={input}
          onChange={(event) => setInput(event.target.value)}
          aria-label={t("toolbox.radix.value")}
          placeholder={t("toolbox.radix.placeholder")}
          className={styles.input}
        />
        <Select
          value={inputBase}
          options={inputBaseOptions}
          onChange={setInputBase}
          ariaLabel={t("toolbox.radix.inputBase")}
          className={styles.inputBase}
        />
      </div>

      {guess ? <p className={styles.guess}>{guess}</p> : null}

      {trimmed === "" ? null : outputs ? (
        <div className={styles.results}>
          {BASES.map((base) => (
            <CopyField key={base} label={t(BASE_LABEL[base])} value={outputs[base]} />
          ))}
        </div>
      ) : (
        <p className={styles.unreadable}>{t("toolbox.radix.unreadable")}</p>
      )}
    </div>
  );
}

export default RadixPanel;
