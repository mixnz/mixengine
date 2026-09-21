import { useCallback, useEffect, useState } from "react";
import Button from "../../../../components/Button";
import Checkbox from "../../../../components/Checkbox";
import ConfirmDialog from "../../../../components/ConfirmDialog";
import ErrorBanner from "../../../../components/ErrorBanner";
import NoticeBanner from "../../../../components/NoticeBanner";
import { errorMessage } from "../../../../core/errors";
import { useTranslation } from "../../../../i18n";
import { SYNCABLE } from "../../../registry";
import { requestSync } from "../../../sync";
import {
  syncDevices,
  syncFreezeState,
  syncLogout,
  syncRevokeDevice,
  syncThaw,
  type SyncDevice,
  type SyncFreeze,
  type SyncStatus,
} from "../../../sync/api";
import { readEnabled, setEnabled } from "../../../sync/enabled";
import { clearReplaced, onReplacedChange, replacedCounts } from "../../../sync/replaced";
import settings from "../SettingsModal.module.css";
import ChangePassword from "./ChangePassword";
import DeleteAccount from "./DeleteAccount";
import MoveAccount from "./MoveAccount";
import styles from "./SyncSection.module.css";

interface Props {
  status: SyncStatus;
  onChanged: () => void;
}

/** Codes that mean this machine is no longer signed in, whatever the screen still shows. */
const SIGNED_OUT = new Set(["error.syncSignedOut", "error.syncNotSignedIn"]);

function codeOf(error: unknown): string | undefined {
  return typeof error === "object" && error !== null ? (error as { code?: string }).code : undefined;
}

/**
 * Signed in: who, where, what follows this person to their other machines, and which machines
 * those are. **Every row starts off** (D5), and a replaced edit is reported here and asked about
 * nowhere (D4).
 */
function AccountView({ status, onChanged }: Props) {
  const { t, lang } = useTranslation();
  const [enabled, setEnabledIds] = useState(() => readEnabled(localStorage));
  const [replaced, setReplaced] = useState(replacedCounts);
  const [devices, setDevices] = useState<SyncDevice[] | null>(null);
  const [revoking, setRevoking] = useState<SyncDevice | null>(null);
  const [busy, setBusy] = useState(false);
  /** The one form open under the account line, if any. */
  const [panel, setPanel] = useState<"none" | "password" | "delete" | "move">("none");
  const [freeze, setFreeze] = useState<SyncFreeze | null>(null);
  const [changed, setChanged] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => onReplacedChange(() => setReplaced(replacedCounts())), []);

  const fail = useCallback(
    (error: unknown) => {
      if (SIGNED_OUT.has(codeOf(error) ?? "")) onChanged();
      else setProblem(errorMessage(t, error));
    },
    [onChanged, t],
  );

  const loadDevices = useCallback(() => {
    syncDevices().then(setDevices).catch(fail);
  }, [fail]);
  useEffect(loadDevices, [loadDevices]);

  const loadFreeze = useCallback(() => {
    syncFreezeState().then(setFreeze).catch(fail);
  }, [fail]);
  useEffect(loadFreeze, [loadFreeze]);

  async function thaw() {
    try {
      setFreeze(await syncThaw());
    } catch (error) {
      fail(error);
    }
  }

  const day = (seconds: number) => new Date(seconds * 1000).toLocaleDateString(lang);
  const labelOf = (id: string) => {
    const collection = SYNCABLE.find((candidate) => candidate.id === id);
    return collection ? t(collection.labelKey) : id;
  };

  function toggle(id: string, on: boolean) {
    setEnabledIds(setEnabled(localStorage, id, on));
    if (on) requestSync();
  }

  async function signOut() {
    setBusy(true);
    try {
      await syncLogout();
      onChanged();
    } catch (error) {
      fail(error);
    } finally {
      setBusy(false);
    }
  }

  async function revoke(device: SyncDevice) {
    setRevoking(null);
    try {
      await syncRevokeDevice(device.id);
      loadDevices();
    } catch (error) {
      fail(error);
    }
  }

  return (
    <>
      <div className={settings.section}>
        <div className={settings.updateRow}>
          <div className={settings.updateText}>
            <span className={settings.updateVersion}>{t("sync.signedInAs", { email: status.email ?? "" })}</span>
            <span className={settings.updateStatus}>{status.server}</span>
          </div>
          <div className={styles.row}>
            {panel === "none" && (
              <>
                <Button size="small" variant="ghost" onClick={() => setPanel("password")}>
                  {t("sync.changePassword")}
                </Button>
                <Button size="small" variant="ghost" onClick={() => setPanel("move")}>
                  {t("sync.moveTitle")}
                </Button>
                <Button size="small" variant="ghost" onClick={() => setPanel("delete")}>
                  {t("sync.deleteAccount")}
                </Button>
              </>
            )}
            <Button size="small" busy={busy ? t("sync.signingOut") : undefined} onClick={() => void signOut()}>
              {t("sync.signOut")}
            </Button>
          </div>
        </div>
        <p className={settings.hint}>{t("sync.signOutHint")}</p>
        {changed && <NoticeBanner message={t("sync.passwordChanged")} onDismiss={() => setChanged(false)} />}
        {status.closingOn !== null && <NoticeBanner message={t("sync.closing", { date: day(status.closingOn) })} />}
        {freeze?.state === "frozen" && panel !== "move" && (
          <div className={styles.row}>
            <NoticeBanner
              message={t("sync.frozen", { date: freeze.frozenAt === null ? "" : day(freeze.frozenAt) })}
            />
            <Button size="small" onClick={() => void thaw()}>
              {t("sync.thaw")}
            </Button>
          </div>
        )}
        {[...replaced].map(([id, count]) => (
          <NoticeBanner
            key={id}
            message={t("sync.replaced", { count, collection: labelOf(id) })}
            onDismiss={clearReplaced}
          />
        ))}
        {problem && <ErrorBanner message={problem} onDismiss={() => setProblem(null)} />}
      </div>

      {panel === "password" && (
        <ChangePassword
          onDone={() => {
            setPanel("none");
            setChanged(true);
            loadDevices();
          }}
          onCancel={() => setPanel("none")}
        />
      )}
      {panel === "delete" && status.server && (
        <DeleteAccount server={status.server} onDeleted={onChanged} onCancel={() => setPanel("none")} />
      )}
      {panel === "move" && status.server && (
        <MoveAccount
          from={status.server}
          deviceName={devices?.find((device) => device.current)?.name ?? "MixLab"}
          onMoved={onChanged}
          onCancel={() => {
            setPanel("none");
            loadFreeze();
          }}
        />
      )}

      <div className={settings.section}>
        <span className={settings.sectionLabel}>{t("sync.collections")}</span>
        {SYNCABLE.map((collection) => (
          <Checkbox
            key={collection.id}
            className={settings.moduleRow}
            label={t(collection.labelKey)}
            checked={enabled.has(collection.id)}
            onChange={(event) => toggle(collection.id, event.target.checked)}
          />
        ))}
        <p className={settings.hint}>{t("sync.collectionsHint")}</p>
      </div>

      <div className={settings.section}>
        <span className={settings.sectionLabel}>{t("sync.devices")}</span>
        {devices?.map((device) => (
          <div key={device.id} className={styles.device}>
            <div className={settings.updateText}>
              <span>
                {device.name}
                {device.current && <span className={styles.tag}>{t("sync.thisDevice")}</span>}
              </span>
              <span className={settings.updateStatus}>{t("sync.lastSeen", { when: day(device.lastSeenAt) })}</span>
            </div>
            {/* This machine leaves by signing out, above, which also forgets it here. */}
            {!device.current && (
              <Button size="small" variant="ghost" onClick={() => setRevoking(device)}>
                {t("sync.revoke")}
              </Button>
            )}
          </div>
        ))}
      </div>

      {revoking && (
        <ConfirmDialog
          title={t("sync.revokeTitle", { name: revoking.name })}
          message={t("sync.revokeMessage")}
          confirmLabel={t("sync.revoke")}
          danger
          onConfirm={() => void revoke(revoking)}
          onCancel={() => setRevoking(null)}
        />
      )}
    </>
  );
}

export default AccountView;
