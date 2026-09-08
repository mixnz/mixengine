import { useMemo, useState } from "react";
import Button from "../../../../components/Button";
import Input from "../../../../components/Input";
import Select, { type SelectOption } from "../../../../components/Select";
import { useTranslation } from "../../../../i18n";
import CopyField from "../../components/CopyField";
import { setTimeZone, useToolsWorkspace } from "../../workspace";
import { detectUnit, toInstant, toOutputs } from "./time";
import { allZones, canonicalZone, preferredZone, zoneOffset } from "./zones";
import styles from "./Panel.module.css";

/* Vùng của máy, đã chỉnh lại theo nước của người dùng — xem `preferredZone`. Windows báo về
   `Asia/Bangkok` cho một máy đặt tiếng Việt, và +07:00 thì giống hệt nên không ai nhìn ra.

   Ba nguồn chứ không một: `resolvedOptions().locale` trong webview đi theo **ngôn ngữ hiển thị**
   của webview — thường là `en-US` — chứ không theo vùng của Windows như Node. `navigator.languages`
   mới là chỗ ngôn ngữ thật của người dùng lộ ra. */
const resolved = Intl.DateTimeFormat().resolvedOptions();
const LOCALE_SOURCES = [
  resolved.locale,
  ...(typeof navigator === "undefined" ? [] : (navigator.languages ?? [])),
  typeof navigator === "undefined" ? "" : navigator.language,
];
const LOCAL_ZONE = preferredZone(resolved.timeZone, LOCALE_SOURCES, Date.now());

/* Tính một lần ở tầng module: hơn bốn trăm mục, và danh sách không đổi trong suốt một phiên chạy. */
const ZONE_NAMES = allZones();

function TimestampPanel() {
  const { t } = useTranslation();
  const workspace = useToolsWorkspace();
  const [input, setInput] = useState(() => String(Date.now()));
  // Đóng băng "bây giờ" thay vì để nó nhảy mỗi giây: dòng "3 ngày trước" mà tự đổi trong lúc
  // người ta đang đọc thì khó chịu hơn là hữu ích. Nút "Bây giờ" làm mới cả hai.
  const [now, setNow] = useState(() => Date.now());

  /* Tên đã lưu được chuẩn hoá lại trên đường ra: một file do bản trước ghi có thể còn giữ
     `Asia/Saigon`. Vùng nào runtime không còn biết thì lui về múi của máy, chứ không để ô chọn
     trống trơn. */
  const stored = workspace.timeZone === null ? null : canonicalZone(workspace.timeZone);
  const zone = stored !== null && ZONE_NAMES.includes(stored) ? stored : LOCAL_ZONE;

  /* Chênh lệch của mỗi vùng phụ thuộc thời điểm — một nửa thế giới đổi giờ theo mùa — nên danh
     sách được dựng lại khi `now` đổi, chứ không phải một lần ở tầng module như tên các vùng. */
  const zoneOptions: SelectOption<string>[] = useMemo(
    () =>
      ZONE_NAMES.map((name) => {
        const offset = zoneOffset(name, now);
        const label = offset ? `${name} (UTC${offset})` : name;
        // Gõ "saigon" hay "+07" hay "ho chi minh" đều phải tìm ra được cùng một vùng.
        return { value: name, label, searchText: `${label} ${name.replace(/[_/]/g, " ")}` };
      }),
    [now],
  );

  const unit = detectUnit(input);
  const instant = toInstant(input);
  const outputs = useMemo(
    () => (instant === null ? null : toOutputs(instant, zone, now)),
    [instant, zone, now],
  );

  const guess =
    unit === "seconds"
      ? t("toolbox.timestamp.guessedSeconds")
      : unit === "millis"
        ? t("toolbox.timestamp.guessedMillis")
        : unit === "micros"
          ? t("toolbox.timestamp.guessedMicros")
          : instant !== null
            ? t("toolbox.timestamp.guessedIso")
            : null;

  return (
    <div className={styles.panel}>
      <div className={styles.controls}>
        <Input
          value={input}
          onChange={(event) => setInput(event.target.value)}
          aria-label={t("toolbox.timestamp.value")}
          placeholder={t("toolbox.timestamp.placeholder")}
          className={styles.input}
        />
        <Button
          onClick={() => {
            const stamp = Date.now();
            setNow(stamp);
            setInput(String(stamp));
          }}
        >
          {t("toolbox.timestamp.now")}
        </Button>
        <Select
          value={zone}
          options={zoneOptions}
          onChange={setTimeZone}
          searchable
          searchPlaceholder={t("toolbox.timestamp.searchZone")}
          ariaLabel={t("toolbox.timestamp.timeZone")}
          className={styles.zone}
        />
      </div>

      {guess ? <p className={styles.guess}>{guess}</p> : null}

      {outputs ? (
        <div className={styles.results}>
          <CopyField label={t("toolbox.timestamp.isoUtc")} value={outputs.isoUtc} />
          <CopyField label={t("toolbox.timestamp.isoLocal")} value={outputs.isoLocal} />
          <CopyField label={t("toolbox.timestamp.unixSeconds")} value={outputs.unixSeconds} />
          <CopyField label={t("toolbox.timestamp.unixMillis")} value={outputs.unixMillis} />
          <CopyField label={t("toolbox.timestamp.relative")} value={outputs.relative} mono={false} />
        </div>
      ) : (
        <p className={styles.unreadable}>{t("toolbox.timestamp.unreadable")}</p>
      )}
    </div>
  );
}

export default TimestampPanel;
