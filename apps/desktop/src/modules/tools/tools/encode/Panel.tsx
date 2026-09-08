import { useEffect, useState } from "react";
import Button from "../../../../components/Button";
import { Textarea } from "../../../../components/Input";
import Select, { type SelectOption } from "../../../../components/Select";
import ErrorBanner from "../../../../components/ErrorBanner";
import { useTranslation, type TranslationKey } from "../../../../i18n";
import CopyField from "../../components/CopyField";
import {
  HASH_ALGOS,
  base64ToText,
  hashText,
  hexToText,
  textToBase64,
  textToHex,
  type HashAlgo,
} from "./encode";
import styles from "./Panel.module.css";

type Tab = "base64" | "hex" | "url" | "hash";

const TABS: Tab[] = ["base64", "hex", "url", "hash"];

const TAB_LABEL: Record<Tab, TranslationKey> = {
  base64: "toolbox.encode.tabBase64",
  hex: "toolbox.encode.tabHex",
  url: "toolbox.encode.tabUrl",
  hash: "toolbox.encode.tabHash",
};

const ALGO_OPTIONS: SelectOption<HashAlgo>[] = HASH_ALGOS.map((algo) => ({
  value: algo,
  label: algo,
}));

function EncodePanel() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>("base64");
  const [input, setInput] = useState("");
  const [output, setOutput] = useState("");
  const [error, setError] = useState<string | null>(null);

  const [urlSafe, setUrlSafe] = useState(false);
  const [spaced, setSpaced] = useState(false);
  const [whole, setWhole] = useState(false);
  const [algo, setAlgo] = useState<HashAlgo>("SHA-256");

  // Đổi thẻ là đổi việc, nên kết quả cũ không còn nghĩa gì — giữ nó lại chỉ khiến người ta tưởng
  // nó là kết quả của thẻ mới.
  useEffect(() => {
    setOutput("");
    setError(null);
  }, [tab]);

  /* Chỉ đường giải mã mới ném — base64 hỏng, hex lẻ chữ, URI không hợp lệ. Bọc chung một chỗ để
     mọi nút đi qua cùng một lối xử lý lỗi. */
  const run = (work: () => string) => {
    try {
      setOutput(work());
      setError(null);
    } catch {
      setOutput("");
      setError(t("toolbox.encode.badInput"));
    }
  };

  const hash = () => {
    void hashText(input, algo)
      .then((digest) => {
        setOutput(digest);
        setError(null);
      })
      .catch(() => {
        setOutput("");
        setError(t("toolbox.encode.badInput"));
      });
  };

  return (
    <div className={styles.panel}>
      <div className={styles.tabs} role="tablist">
        {TABS.map((name) => (
          <button
            key={name}
            type="button"
            role="tab"
            aria-selected={name === tab}
            className={name === tab ? `${styles.tab} ${styles.active}` : styles.tab}
            onClick={() => setTab(name)}
          >
            {t(TAB_LABEL[name])}
          </button>
        ))}
      </div>

      {error ? <ErrorBanner message={error} onDismiss={() => setError(null)} /> : null}

      <label className={styles.field}>
        <span className={styles.fieldLabel}>{t("toolbox.input")}</span>
        <Textarea
          value={input}
          onChange={(event) => setInput(event.target.value)}
          maxRows={10}
        />
      </label>

      <div className={styles.controls}>
        {tab === "base64" ? (
          <>
            <label className={styles.check}>
              <input
                type="checkbox"
                checked={urlSafe}
                onChange={(event) => setUrlSafe(event.target.checked)}
              />
              {t("toolbox.encode.urlSafe")}
            </label>
            <Button variant="primary" onClick={() => run(() => textToBase64(input, urlSafe))}>
              {t("toolbox.encode.encode")}
            </Button>
            <Button onClick={() => run(() => base64ToText(input))}>
              {t("toolbox.encode.decode")}
            </Button>
          </>
        ) : null}

        {tab === "hex" ? (
          <>
            <label className={styles.check}>
              <input
                type="checkbox"
                checked={spaced}
                onChange={(event) => setSpaced(event.target.checked)}
              />
              {t("toolbox.encode.spaced")}
            </label>
            <Button variant="primary" onClick={() => run(() => textToHex(input, spaced))}>
              {t("toolbox.encode.encode")}
            </Button>
            <Button onClick={() => run(() => hexToText(input))}>{t("toolbox.encode.decode")}</Button>
          </>
        ) : null}

        {tab === "url" ? (
          <>
            <label className={styles.check}>
              <input
                type="checkbox"
                checked={whole}
                onChange={(event) => setWhole(event.target.checked)}
              />
              {t("toolbox.encode.whole")}
            </label>
            <Button
              variant="primary"
              onClick={() => run(() => (whole ? encodeURI(input) : encodeURIComponent(input)))}
            >
              {t("toolbox.encode.encode")}
            </Button>
            <Button onClick={() => run(() => (whole ? decodeURI(input) : decodeURIComponent(input)))}>
              {t("toolbox.encode.decode")}
            </Button>
          </>
        ) : null}

        {tab === "hash" ? (
          <>
            <Select
              value={algo}
              options={ALGO_OPTIONS}
              onChange={setAlgo}
              ariaLabel={t("toolbox.encode.algo")}
              className={styles.algo}
            />
            <Button variant="primary" onClick={hash}>
              {t("toolbox.encode.hash")}
            </Button>
          </>
        ) : null}
      </div>

      {tab === "hash" && algo === "MD5" ? (
        <p className={styles.warning}>{t("toolbox.encode.md5Warning")}</p>
      ) : null}

      <CopyField label={t("toolbox.output")} value={output} multiline />
    </div>
  );
}

export default EncodePanel;
