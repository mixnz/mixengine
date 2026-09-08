import { useState } from "react";
import Input from "../../../../components/Input";
import Select from "../../../../components/Select";
import { EyeIcon, EyeOffIcon } from "../../../../icons";
import { useTranslation, type TranslationKey } from "../../../../i18n";
import { authOverride } from "../../buildRequest";
import type { Auth, KeyValue } from "../../types";
import styles from "./AuthPane.module.css";

interface Props {
  auth: Auth;
  /** Both tables, only to say when one of them already claims the name this auth would use. */
  headers: KeyValue[];
  params: KeyValue[];
  onChange: (auth: Auth) => void;
}

type Kind = Auth["kind"];

const KINDS: Kind[] = ["none", "bearer", "basic", "apiKey"];

const LABELS: Record<Kind, TranslationKey> = {
  none: "rest.authNone",
  bearer: "rest.authBearer",
  basic: "rest.authBasic",
  apiKey: "rest.authApiKey",
};

/** What each kind starts as. Nothing is carried between kinds: a token is not a username, and
 *  keeping one in the other's field would only make it look as though it were being sent. */
function emptyAuth(kind: Kind): Auth {
  switch (kind) {
    case "none":
      return { kind: "none" };
    case "bearer":
      return { kind: "bearer", token: "" };
    case "basic":
      return { kind: "basic", username: "", password: "" };
    case "apiKey":
      return { kind: "apiKey", name: "", value: "", in: "header" };
  }
}

/** A field whose value is dots until its owner asks to see it. Shoulders read screens; the eye is
 *  there for the moment a token has to be checked character by character. */
function Secret({
  value,
  label,
  onChange,
}: {
  value: string;
  label: string;
  onChange: (value: string) => void;
}) {
  const { t } = useTranslation();
  const [shown, setShown] = useState(false);
  return (
    <div className={styles.secret}>
      <Input
        className={styles.control}
        size="small"
        type={shown ? "text" : "password"}
        value={value}
        aria-label={label}
        onChange={(e) => onChange(e.target.value)}
      />
      <button
        type="button"
        className={styles.reveal}
        aria-label={shown ? t("rest.hideValue") : t("rest.showValue")}
        title={shown ? t("rest.hideValue") : t("rest.showValue")}
        onClick={() => setShown(!shown)}
      >
        {shown ? <EyeOffIcon size="0.9em" /> : <EyeIcon size="0.9em" />}
      </button>
    </div>
  );
}

/**
 * The Auth tab.
 *
 * What is chosen here is folded into the request by `buildRequest`, and only where nothing was
 * typed by hand: a ticked `Authorization` header, or a parameter of the same name as an API key,
 * wins. That is the same rule the body's content type follows — what is written out in a table is
 * the one part of a request its author can see — and when it applies, the line at the foot says so
 * rather than leaving the two to disagree in silence.
 *
 * These values live in `rest-requests.json` like every other field. The keyring is for environment
 * variables marked secret, which arrive in Phase 4; from then on a token stays off disk by being
 * `{{token}}` here and a value there.
 */
function AuthPane({ auth, headers, params, onChange }: Props) {
  const { t } = useTranslation();
  const overridden = authOverride(auth, headers, params);

  return (
    <div className={styles.pane}>
      <div className={styles.row}>
        <span className={styles.label}>{t("rest.authKind")}</span>
        <Select<Kind>
          className={styles.kind}
          size="small"
          value={auth.kind}
          ariaLabel={t("rest.authKind")}
          options={KINDS.map((kind) => ({ value: kind, label: t(LABELS[kind]) }))}
          onChange={(kind) => onChange(emptyAuth(kind))}
        />
      </div>

      {auth.kind === "none" && <p className={`${styles.hint} muted`}>{t("rest.authNoneHint")}</p>}

      {auth.kind === "bearer" && (
        <div className={styles.row}>
          <span className={styles.label}>{t("rest.authToken")}</span>
          <Secret
            value={auth.token}
            label={t("rest.authToken")}
            onChange={(token) => onChange({ ...auth, token })}
          />
        </div>
      )}

      {auth.kind === "basic" && (
        <>
          <div className={styles.row}>
            <span className={styles.label}>{t("rest.authUsername")}</span>
            <Input
              className={styles.control}
              size="small"
              value={auth.username}
              aria-label={t("rest.authUsername")}
              onChange={(e) => onChange({ ...auth, username: e.target.value })}
            />
          </div>
          <div className={styles.row}>
            <span className={styles.label}>{t("rest.authPassword")}</span>
            <Secret
              value={auth.password}
              label={t("rest.authPassword")}
              onChange={(password) => onChange({ ...auth, password })}
            />
          </div>
        </>
      )}

      {auth.kind === "apiKey" && (
        <>
          <div className={styles.row}>
            <span className={styles.label}>{t("rest.authKeyName")}</span>
            <Input
              className={styles.control}
              size="small"
              value={auth.name}
              aria-label={t("rest.authKeyName")}
              onChange={(e) => onChange({ ...auth, name: e.target.value })}
            />
          </div>
          <div className={styles.row}>
            <span className={styles.label}>{t("rest.authKeyValue")}</span>
            <Secret
              value={auth.value}
              label={t("rest.authKeyValue")}
              onChange={(value) => onChange({ ...auth, value })}
            />
          </div>
          <div className={styles.row}>
            <span className={styles.label}>{t("rest.authKeyIn")}</span>
            <Select<"header" | "query">
              className={styles.kind}
              size="small"
              value={auth.in}
              ariaLabel={t("rest.authKeyIn")}
              options={[
                { value: "header", label: t("rest.authInHeader") },
                { value: "query", label: t("rest.authInQuery") },
              ]}
              onChange={(where) => onChange({ ...auth, in: where })}
            />
          </div>
        </>
      )}

      {overridden !== null && (
        <p className={`${styles.hint} muted`}>{t("rest.authOverridden", { name: overridden })}</p>
      )}
    </div>
  );
}

export default AuthPane;
