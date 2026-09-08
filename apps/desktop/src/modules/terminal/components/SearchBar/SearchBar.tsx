import { useEffect, useRef, useState } from "react";
import Button from "../../../../components/Button";
import Input from "../../../../components/Input";
import { ChevronDownIcon, ChevronUpIcon, CloseIcon } from "../../../../icons";
import { useTranslation } from "../../../../i18n";
import styles from "./SearchBar.module.css";

interface Props {
  /** Tìm `query`, đi tới (`back` sai) hoặc lùi (`back` đúng). Trả `false` khi không có kết quả
   *  nào — thanh nói điều đó ra thay vì im lặng như thể chưa gõ gì. */
  onFind: (query: string, back: boolean) => boolean;
  onClose: () => void;
  /** Bơm lên một mỗi lần `Ctrl+F` được bấm. Thanh đã mở rồi thì phím ấy không mở lại được gì —
   *  cái nó phải làm là kéo bàn phím về ô và chọn sẵn nội dung, đúng như thanh tìm của trình
   *  duyệt. Một con số chứ không phải một cờ: cùng một cử chỉ lặp lại phải kích hoạt lại. */
  focusSignal: number;
}

/** Thanh tìm trong phần đã cuộn qua của một phiên terminal. */
function SearchBar({ onFind, onClose, focusSignal }: Props) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  /* `null` là chưa tìm lần nào — khác hẳn "đã tìm và không thấy gì", và chỉ cái thứ hai mới đáng
     nói ra. */
  const [found, setFound] = useState<boolean | null>(null);

  /* Thanh vừa hiện ra là để gõ vào; một thanh mở ra mà bàn phím vẫn ở chỗ khác thì mở làm gì. Và
     `Ctrl+F` bấm lại lúc thanh đang mở chạy lại đúng effect này — `select()` là cái làm cho lần
     bấm thứ hai có nghĩa: gõ đè lên chuỗi cũ để tìm cái khác. */
  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    input.select();
  }, [focusSignal]);

  function find(text: string, back: boolean) {
    setQuery(text);
    if (text === "") {
      setFound(null);
      return;
    }
    setFound(onFind(text, back));
  }

  return (
    <div className={styles.bar}>
      <Input
        ref={inputRef}
        size="small"
        className={styles.field}
        placeholder={t("terminal.findPlaceholder")}
        aria-label={t("terminal.findPlaceholder")}
        value={query}
        /* Tìm ngay từng phím: kết quả nhảy theo cái đang gõ, đúng như thanh tìm của trình duyệt.
           `back` luôn sai ở đây — gõ thêm một chữ là thu hẹp về phía trước, không phải quay lui. */
        onChange={(e) => find(e.target.value, false)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            onClose();
            return;
          }
          if (e.key !== "Enter") return;
          e.preventDefault();
          find(query, e.shiftKey);
        }}
      />
      {found === false && <span className={styles.status}>{t("terminal.findNoMatch")}</span>}
      <Button
        size="small"
        disabled={query === ""}
        title={t("terminal.findPrevious")}
        aria-label={t("terminal.findPrevious")}
        onClick={() => find(query, true)}
      >
        <ChevronUpIcon size="0.9em" />
      </Button>
      <Button
        size="small"
        disabled={query === ""}
        title={t("terminal.findNext")}
        aria-label={t("terminal.findNext")}
        onClick={() => find(query, false)}
      >
        <ChevronDownIcon size="0.9em" />
      </Button>
      <Button
        size="small"
        title={t("terminal.findClose")}
        aria-label={t("terminal.findClose")}
        onClick={onClose}
      >
        <CloseIcon size="0.9em" />
      </Button>
    </div>
  );
}

export default SearchBar;
