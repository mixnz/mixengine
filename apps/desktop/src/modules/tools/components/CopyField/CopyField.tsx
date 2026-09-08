import { useEffect, useState } from "react";
import { CheckIcon, CopyIcon } from "../../../../icons";
import { useTranslation } from "../../../../i18n";
import { copyText } from "../../../../core/clipboard";
import styles from "./CopyField.module.css";

interface CopyFieldProps {
  label: string;
  value: string;
  /** Cho ô cao lên và cuộn được, cho giá trị dài nhiều dòng. */
  multiline?: boolean;
  /** In bằng font mono. Mặc định bật — gần như mọi thứ module này in ra là mã hoặc id. */
  mono?: boolean;
}

const COPIED_MS = 1500;

/**
 * Một dòng kết quả chỉ đọc kèm nút chép.
 *
 * Nút báo đã chép bằng cách tự đổi trong một giây rưỡi. Một lần chép hỏng bị nuốt ở đây, đúng như
 * `RequestList` và `TreeView` của module rest làm: `copyText` đã tự xử lý phần khó (nó thử lại
 * bằng đường `execCommand` cũ trước khi bỏ cuộc), và một dòng kết quả không có chỗ nào để treo
 * thông báo lỗi lên.
 */
function CopyField({ label, value, multiline = false, mono = true }: CopyFieldProps) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), COPIED_MS);
    return () => clearTimeout(timer);
  }, [copied]);

  const copy = () => {
    void copyText(value)
      .then(() => setCopied(true))
      .catch(() => {});
  };

  return (
    <div className={styles.row}>
      <span className={styles.label}>{label}</span>
      <output
        className={`${styles.value}${mono ? ` ${styles.mono}` : ""}${multiline ? ` ${styles.multiline}` : ""}`}
      >
        {value}
      </output>
      <button
        type="button"
        className={styles.copy}
        onClick={copy}
        title={copied ? t("toolbox.copied") : t("toolbox.copy")}
        aria-label={copied ? t("toolbox.copied") : t("toolbox.copy")}
        disabled={value === ""}
      >
        {copied ? <CheckIcon /> : <CopyIcon />}
      </button>
    </div>
  );
}

export default CopyField;
