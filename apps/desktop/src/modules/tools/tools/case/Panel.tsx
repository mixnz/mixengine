import { useMemo, useState } from "react";
import { Textarea } from "../../../../components/Input";
import Select, { type SelectOption } from "../../../../components/Select";
import { useTranslation } from "../../../../i18n";
import CopyField from "../../components/CopyField";
import { CASE_STYLES, convert, type CaseStyle } from "./caseConvert";
import styles from "./Panel.module.css";

const STYLE_LABEL: Record<CaseStyle, string> = {
  camel: "camelCase",
  snake: "snake_case",
  kebab: "kebab-case",
  pascal: "PascalCase",
  constant: "CONSTANT_CASE",
  dot: "dot.case",
  title: "Title Case",
};

/* Nhãn là chính cú pháp nó sinh ra, nên không dịch: `snake_case` gọi là snake_case ở mọi ngôn ngữ,
   và một bản dịch chỉ làm người đọc phải đoán ngược lại. */
const STYLE_OPTIONS: SelectOption<CaseStyle>[] = CASE_STYLES.map((style) => ({
  value: style,
  label: STYLE_LABEL[style],
}));

function CasePanel() {
  const { t } = useTranslation();
  const [input, setInput] = useState("");
  const [style, setStyle] = useState<CaseStyle>("snake");

  // Từng dòng một: cách dùng thật là chép cả danh sách cột từ tab db rồi dán vào đây.
  const output = useMemo(
    () =>
      input
        .split("\n")
        .map((line) => convert(line, style))
        .join("\n"),
    [input, style],
  );

  return (
    <div className={styles.panel}>
      <div className={styles.controls}>
        <Select
          value={style}
          options={STYLE_OPTIONS}
          onChange={setStyle}
          ariaLabel={t("toolbox.case.style")}
          className={styles.style}
        />
      </div>

      <label className={styles.field}>
        <span className={styles.fieldLabel}>{t("toolbox.input")}</span>
        <Textarea
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder={t("toolbox.case.placeholder")}
          maxRows={14}
        />
      </label>

      <CopyField label={t("toolbox.output")} value={output} multiline />
    </div>
  );
}

export default CasePanel;
