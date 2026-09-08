import { useMemo } from "react";
import { useTranslation } from "../../../../i18n";
import { formatBytes, hexDump } from "../../format";
import styles from "./HexView.module.css";

/** How much of a body is dumped. Past this the page is thousands of lines of monospace and no
 *  faster to read for it. */
const MAX_DUMP = 5 * 1024 * 1024;

interface Props {
  bytes: Uint8Array;
  /** The real length, which may be more than `bytes` holds when Rust cut the body. */
  totalSize: number;
}

/** Raw, for a body that is not text: offset, bytes, and the characters that are printable. */
function HexView({ bytes, totalSize }: Props) {
  const { t } = useTranslation();
  const dump = useMemo(() => hexDump(bytes, MAX_DUMP), [bytes]);
  const cut = bytes.length > MAX_DUMP || totalSize > bytes.length;

  return (
    <>
      {cut && (
        <p className={`${styles.notice} muted`}>
          {t("rest.truncatedNotice", {
            shown: formatBytes(Math.min(bytes.length, MAX_DUMP)),
            total: formatBytes(totalSize),
          })}
        </p>
      )}
      <pre className={styles.hex}>{dump}</pre>
    </>
  );
}

export default HexView;
