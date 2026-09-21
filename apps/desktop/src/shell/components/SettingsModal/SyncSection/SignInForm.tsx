import { useState } from "react";
import Button from "../../../../components/Button";
import Input from "../../../../components/Input";
import SegmentedControl from "../../../../components/SegmentedControl";
import Select from "../../../../components/Select";
import { errorMessage } from "../../../../core/errors";
import { useTranslation } from "../../../../i18n";
import { syncLogin, syncRegister, type SyncStatus } from "../../../sync/api";
import { addServer, DEFAULT_SERVER, readServers, removeServer } from "../../../sync/servers";
import settings from "../SettingsModal.module.css";
import Field from "./Field";
import styles from "./SyncSection.module.css";

type Mode = "signIn" | "signUp";

interface Props {
  deviceName: string;
  onDeviceNameChange: (name: string) => void;
  onSignedIn: (status: SyncStatus) => void;
  /** Sign-up reached the server: the recovery key, to be shown once. */
  onRegistered: (recoveryKey: string, email: string) => void;
}

/**
 * Signed out: which server, and either signing in or making an account. The password leaves this
 * form only as an argument to Rust, which stretches it and forgets it (D2); a closed server's
 * access token goes the same way and is kept beside `MK`, never in the list of servers.
 *
 * The access-token field is shown only for a server that is not the default: the default instance
 * is open, and a field nobody there needs is a field somebody fills with their password.
 */
function SignInForm({ deviceName, onDeviceNameChange, onSignedIn, onRegistered }: Props) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<Mode>("signIn");
  const [servers, setServers] = useState(() => readServers(localStorage));
  const [server, setServer] = useState(DEFAULT_SERVER);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [access, setAccess] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  function add() {
    const result = addServer(localStorage, draft);
    if (!result.ok) {
      setProblem(t(result.reason === "insecure" ? "sync.serverInsecure" : "sync.serverInvalid"));
      return;
    }
    setServers(result.servers);
    setServer(result.url);
    setAdding(false);
    setDraft("");
    setProblem(null);
  }

  function remove() {
    setServers(removeServer(localStorage, server));
    setServer(DEFAULT_SERVER);
  }

  async function submit() {
    if (mode === "signUp" && password !== again) {
      setProblem(t("sync.passwordsDiffer"));
      return;
    }
    setProblem(null);
    setBusy(true);
    const token = server === DEFAULT_SERVER || access.trim() === "" ? null : access.trim();
    try {
      if (mode === "signIn") onSignedIn(await syncLogin(server, token, email.trim(), password, deviceName.trim()));
      else onRegistered(await syncRegister(server, token, email.trim(), password), email.trim());
    } catch (error) {
      setProblem(errorMessage(t, error));
    } finally {
      setBusy(false);
    }
  }

  const ready =
    email.trim() !== "" && password !== "" && deviceName.trim() !== "" && (mode === "signIn" || again !== "");

  return (
    <form
      className={settings.section}
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <p className={settings.hint}>{t("sync.intro")}</p>
      <SegmentedControl<Mode>
        aria-label={t("sync.title")}
        block
        value={mode}
        onChange={(next) => {
          setMode(next);
          setProblem(null);
        }}
        segments={[
          { value: "signIn", label: t("sync.signIn") },
          { value: "signUp", label: t("sync.signUp") },
        ]}
      />

      <div className={styles.field}>
        <span className={settings.sectionLabel}>{t("sync.server")}</span>
        <div className={styles.row}>
          <Select<string>
            className={styles.grow}
            value={server}
            ariaLabel={t("sync.server")}
            options={servers.map((url) => ({
              value: url,
              label: url === DEFAULT_SERVER ? t("sync.serverDefault", { url }) : url,
            }))}
            onChange={setServer}
          />
          {server !== DEFAULT_SERVER && (
            <Button size="small" variant="ghost" onClick={remove}>
              {t("sync.removeServer")}
            </Button>
          )}
          {!adding && (
            <Button size="small" onClick={() => setAdding(true)}>
              {t("sync.addServer")}
            </Button>
          )}
        </div>
        {adding && (
          <div className={styles.row}>
            <Input
              className={styles.grow}
              mono
              value={draft}
              placeholder="https://sync.example.com"
              aria-label={t("sync.addServer")}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  add();
                }
              }}
            />
            <Button size="small" variant="primary" onClick={add}>
              {t("sync.addServerAction")}
            </Button>
            <Button
              size="small"
              variant="ghost"
              onClick={() => {
                setAdding(false);
                setDraft("");
              }}
            >
              {t("common.cancel")}
            </Button>
          </div>
        )}
      </div>

      {server !== DEFAULT_SERVER && (
        <Field label={t("sync.access")} hint={t("sync.accessHint")}>
          <Input type="password" value={access} onChange={(event) => setAccess(event.target.value)} />
        </Field>
      )}
      <Field label={t("sync.email")}>
        <Input type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
      </Field>
      <Field label={t("common.password")} hint={mode === "signUp" ? t("sync.passwordHint") : undefined}>
        <Input
          type="password"
          autoComplete={mode === "signIn" ? "current-password" : "new-password"}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
      </Field>
      {mode === "signUp" && (
        <Field label={t("sync.passwordAgain")}>
          <Input
            type="password"
            autoComplete="new-password"
            value={again}
            onChange={(event) => setAgain(event.target.value)}
          />
        </Field>
      )}
      <Field label={t("sync.deviceName")}>
        <Input value={deviceName} onChange={(event) => onDeviceNameChange(event.target.value)} />
      </Field>

      {problem && (
        <p className={styles.problem} role="alert">
          {problem}
        </p>
      )}
      <div className={styles.row}>
        <Button
          variant="primary"
          type="submit"
          disabled={!ready}
          busy={busy ? t(mode === "signIn" ? "sync.signingIn" : "sync.signingUp") : undefined}
        >
          {t(mode === "signIn" ? "sync.signIn" : "sync.signUp")}
        </Button>
      </div>
    </form>
  );
}

export default SignInForm;
