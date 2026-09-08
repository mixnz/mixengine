import Button from "../../../../components/Button";
import Input from "../../../../components/Input";
import Select from "../../../../components/Select";
import { SendIcon, StopIcon } from "../../../../icons";
import { useTranslation } from "../../../../i18n";
import { METHODS, type Method } from "../../types";
import styles from "./UrlBar.module.css";

interface Props {
  /** The URL box itself, so the workspace can put the keyboard in it for a brand new request. */
  inputRef?: React.Ref<HTMLInputElement>;
  method: Method;
  url: string;
  /** While this is true the button cancels instead of sending. */
  sending: boolean;
  /** Turns Send off for a reason that is not an empty URL: a variable the environment has no value
   *  for. What is wrong is said under the box, by `UrlPreview`, rather than in a tooltip here. */
  blocked?: boolean;
  onMethodChange: (method: Method) => void;
  onUrlChange: (url: string) => void;
  /** Handed the pasted text; returns whether it was taken as a request, in which case the box does
   *  not also receive it. Anything else — a URL, a fragment of one, prose — pastes as text. */
  onPasteText: (text: string) => boolean;
  onSend: () => void;
  onCancel: () => void;
}

/** The top row of the request pane: what to send, where, and the one button that does it. */
function UrlBar({
  inputRef,
  method,
  url,
  sending,
  blocked = false,
  onMethodChange,
  onUrlChange,
  onPasteText,
  onSend,
  onCancel,
}: Props) {
  const { t } = useTranslation();

  return (
    <div className={styles.bar}>
      <Select<Method>
        className={styles.method}
        triggerClassName={styles.methodTrigger}
        value={method}
        options={METHODS.map((m) => ({ value: m, label: m }))}
        onChange={onMethodChange}
        ariaLabel={t("rest.method")}
        size="small"
        /* Seven options is short enough to read, but typing `de` to reach DELETE beats running
           the eye down the list — and the same control gains a filter for free. */
        searchable
        searchPlaceholder={t("rest.methodSearch")}
      />
      <Input
        ref={inputRef}
        className={styles.url}
        value={url}
        placeholder={t("rest.urlPlaceholder")}
        aria-label={t("rest.urlPlaceholder")}
        onChange={(e) => onUrlChange(e.target.value)}
        /* A cURL command pasted here is a whole request, not a URL: what to do with it is the
           workspace's to decide, and this only asks and then keeps out of the way. */
        onPaste={(e) => {
          if (onPasteText(e.clipboardData.getData("text"))) e.preventDefault();
        }}
        // Enter in the URL box is the oldest gesture there is for "go".
        onKeyDown={(e) => {
          if (e.key === "Enter" && !sending && !blocked) onSend();
        }}
      />
      <Button
        className={styles.send}
        variant="primary"
        onClick={sending ? onCancel : onSend}
        // Only the URL is required. A GET with nothing else filled in is a whole request.
        disabled={!sending && (url.trim() === "" || blocked)}
      >
        {sending ? <StopIcon size="1em" /> : <SendIcon size="1em" />}
        {sending ? t("rest.cancel") : t("rest.send")}
      </Button>
    </div>
  );
}

export default UrlBar;
