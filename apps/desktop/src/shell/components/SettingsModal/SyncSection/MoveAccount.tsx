import { useState } from "react";
import Button from "../../../../components/Button";
import Input from "../../../../components/Input";
import NoticeBanner from "../../../../components/NoticeBanner";
import SegmentedControl from "../../../../components/SegmentedControl";
import Select from "../../../../components/Select";
import { errorMessage } from "../../../../core/errors";
import { useTranslation } from "../../../../i18n";
import { syncMoveAbandon, syncMoveBegin, syncMoveConfirm, syncMoveFinish } from "../../../sync/api";
import { addServer, DEFAULT_SERVER, readServers } from "../../../sync/servers";
import settings from "../SettingsModal.module.css";
import Field from "./Field";
import styles from "./SyncSection.module.css";

type Phase = { kind: "where" } | { kind: "code" } | { kind: "choose"; copied: number };
type End = "delete" | "thaw";

interface Props {
  /** The server the account is on now, which is not on offer as a destination. */
  from: string;
  deviceName: string;
  onMoved: () => void;
  onCancel: () => void;
}

/**
 * Moving the account (D4b): register on the new server and confirm there, then freeze this one,
 * copy everything unchanged, check it all arrived — and only then ask what to do with the old
 * account, **deletion offered first**: a deleted account signs a forgotten machine out the same
 * day, and a thawed one lets it go on writing where nobody reads.
 */
function MoveAccount({ from, deviceName, onMoved, onCancel }: Props) {
  const { t } = useTranslation();
  const [phase, setPhase] = useState<Phase>({ kind: "where" });
  const [servers, setServers] = useState(() => readServers(localStorage).filter((url) => url !== from));
  const [to, setTo] = useState(() => servers[0] ?? "");
  const [draft, setDraft] = useState("");
  const [access, setAccess] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [end, setEnd] = useState<End>("delete");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function run(work: () => Promise<void>) {
    setBusy(true);
    setProblem(null);
    try {
      await work();
    } catch (error) {
      setProblem(errorMessage(t, error));
    } finally {
      setBusy(false);
    }
  }

  function add() {
    const result = addServer(localStorage, draft);
    if (!result.ok) {
      setProblem(t(result.reason === "insecure" ? "sync.serverInsecure" : "sync.serverInvalid"));
      return;
    }
    setServers(result.servers.filter((url) => url !== from));
    setTo(result.url);
    setDraft("");
    setProblem(null);
  }

  const abandon = () =>
    run(async () => {
      await syncMoveAbandon();
      onCancel();
    });

  const problemLine = problem && (
    <p className={styles.problem} role="alert">
      {problem}
    </p>
  );

  if (phase.kind === "where") {
    const token = to === DEFAULT_SERVER || access.trim() === "" ? null : access.trim();
    return (
      <form
        className={settings.section}
        onSubmit={(event) => {
          event.preventDefault();
          void run(async () => {
            await syncMoveBegin(to, token, password);
            setPhase({ kind: "code" });
          });
        }}
      >
        <span className={settings.sectionLabel}>{t("sync.moveTitle")}</span>
        <p className={settings.hint}>{t("sync.moveHint")}</p>
        <div className={styles.field}>
          <span className={settings.sectionLabel}>{t("sync.moveTo")}</span>
          {servers.length > 0 && (
            <Select<string>
              value={to}
              ariaLabel={t("sync.moveTo")}
              options={servers.map((url) => ({ value: url, label: url }))}
              onChange={setTo}
            />
          )}
          <div className={styles.row}>
            <Input
              className={styles.grow}
              mono
              value={draft}
              placeholder="https://sync.example.com"
              aria-label={t("sync.addServer")}
              onChange={(event) => setDraft(event.target.value)}
            />
            <Button size="small" onClick={add} disabled={draft.trim() === ""}>
              {t("sync.addServerAction")}
            </Button>
          </div>
        </div>
        {to !== DEFAULT_SERVER && to !== "" && (
          <Field label={t("sync.access")} hint={t("sync.accessHint")}>
            <Input type="password" value={access} onChange={(event) => setAccess(event.target.value)} />
          </Field>
        )}
        <Field label={t("common.password")}>
          <Input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </Field>
        {problemLine}
        <div className={styles.row}>
          <Button size="small" variant="ghost" onClick={onCancel}>
            {t("common.cancel")}
          </Button>
          <Button
            size="small"
            variant="primary"
            type="submit"
            disabled={to === "" || password === ""}
            busy={busy ? t("sync.moving") : undefined}
          >
            {t("sync.continue")}
          </Button>
        </div>
      </form>
    );
  }

  if (phase.kind === "code") {
    return (
      <form
        className={settings.section}
        onSubmit={(event) => {
          event.preventDefault();
          void run(async () => {
            const moved = await syncMoveConfirm(code.trim(), deviceName);
            setPhase({ kind: "choose", copied: moved.copied });
          });
        }}
      >
        <span className={settings.sectionLabel}>{t("sync.moveTitle")}</span>
        <p className={settings.hint}>{t("sync.moveCodeHint", { server: to })}</p>
        <Field label={t("sync.code")}>
          <Input mono value={code} onChange={(event) => setCode(event.target.value)} />
        </Field>
        {problemLine}
        <div className={styles.row}>
          <Button size="small" variant="ghost" onClick={() => void abandon()}>
            {t("sync.moveAbandon")}
          </Button>
          <Button
            size="small"
            variant="primary"
            type="submit"
            disabled={code.trim() === ""}
            busy={busy ? t("sync.copying") : undefined}
          >
            {t("sync.moveCopy")}
          </Button>
        </div>
      </form>
    );
  }

  return (
    <form
      className={settings.section}
      onSubmit={(event) => {
        event.preventDefault();
        void run(async () => {
          await syncMoveFinish(end === "delete");
          onMoved();
        });
      }}
    >
      <span className={settings.sectionLabel}>{t("sync.moveTitle")}</span>
      <p className={settings.hint}>{t("sync.moveCopied", { count: phase.copied, server: to })}</p>
      <SegmentedControl<End>
        aria-label={t("sync.moveEnd")}
        block
        value={end}
        onChange={setEnd}
        segments={[
          { value: "delete", label: t("sync.moveDeleteOld") },
          { value: "thaw", label: t("sync.moveKeepOld") },
        ]}
      />
      <NoticeBanner message={t(end === "delete" ? "sync.moveDeleteOldHint" : "sync.moveKeepOldHint")} />
      {problemLine}
      <div className={styles.row}>
        <Button size="small" variant="ghost" onClick={() => void abandon()}>
          {t("sync.moveAbandon")}
        </Button>
        <Button
          size="small"
          variant={end === "delete" ? "danger" : "primary"}
          type="submit"
          busy={busy ? t("sync.moving") : undefined}
        >
          {t("sync.moveFinish")}
        </Button>
      </div>
    </form>
  );
}

export default MoveAccount;
