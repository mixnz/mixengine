import { useMemo, useState } from "react";
import { Textarea } from "../../../../components/Input";
import Select, { type SelectOption } from "../../../../components/Select";
import { useTranslation } from "../../../../i18n";
import CopyField from "../../components/CopyField";
import {
  parseEnv,
  parseJsonEnv,
  toDockerArgs,
  toEnv,
  toExport,
  toJsonEnv,
  type EnvPair,
} from "./env";
import styles from "./Panel.module.css";

type ReadShape = "env" | "json";
type WriteShape = "env" | "json" | "export" | "docker";

function EnvPanel() {
  const { t } = useTranslation();
  const [input, setInput] = useState("");
  const [from, setFrom] = useState<ReadShape>("env");
  const [to, setTo] = useState<WriteShape>("json");

  const froms: SelectOption<ReadShape>[] = [
    { value: "env", label: t("toolbox.env.formatEnv") },
    { value: "json", label: t("toolbox.env.formatJson") },
  ];

  const tos: SelectOption<WriteShape>[] = [
    { value: "env", label: t("toolbox.env.formatEnv") },
    { value: "json", label: t("toolbox.env.formatJson") },
    { value: "export", label: t("toolbox.env.formatExport") },
    { value: "docker", label: t("toolbox.env.formatDocker") },
  ];

  const pairs = useMemo<EnvPair[] | null>(() => {
    if (input.trim() === "") return [];
    return from === "env" ? parseEnv(input) : parseJsonEnv(input);
  }, [input, from]);

  const output = useMemo(() => {
    if (!pairs) return "";
    if (to === "env") return toEnv(pairs);
    if (to === "json") return toJsonEnv(pairs);
    if (to === "export") return toExport(pairs);
    return toDockerArgs(pairs);
  }, [pairs, to]);

  return (
    <div className={styles.panel}>
      <label className={styles.field}>
        <span className={styles.fieldLabel}>{t("toolbox.input")}</span>
        <Textarea
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder={t("toolbox.env.placeholder")}
          maxRows={14}
        />
      </label>

      <div className={styles.controls}>
        <Select
          value={from}
          options={froms}
          onChange={setFrom}
          ariaLabel={t("toolbox.env.from")}
          className={styles.format}
        />
        <Select
          value={to}
          options={tos}
          onChange={setTo}
          ariaLabel={t("toolbox.env.to")}
          className={styles.format}
        />
      </div>

      {pairs === null ? <p className={styles.error}>{t("toolbox.env.notJson")}</p> : null}
      {pairs !== null ? <CopyField label={t("toolbox.output")} value={output} multiline /> : null}
    </div>
  );
}

export default EnvPanel;
