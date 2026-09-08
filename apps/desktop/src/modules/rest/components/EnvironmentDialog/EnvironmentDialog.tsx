import { useState } from "react";
import Button from "../../../../components/Button";
import ConfirmDialog from "../../../../components/ConfirmDialog";
import Input from "../../../../components/Input";
import { CloseIcon, EyeIcon, EyeOffIcon, PlusIcon, TrashIcon } from "../../../../icons";
import { useTranslation } from "../../../../i18n";
import { useDraftFocus } from "../../draftFocus";
import { newVar, type EnvVar, type Environment } from "../../environments";
import {
  createEnvironment,
  deleteEnvironment,
  flushEnvironments,
  saveEnvironment,
  useEnvironments,
} from "../../environmentsStore";
import styles from "./EnvironmentDialog.module.css";
import Modal from "../../../../components/Modal";

interface Props {
  /** Which environment to open on — the one the tab strip was showing. */
  initialId: string | null;
  onClose: () => void;
}

/**
 * The environments, and what is in them.
 *
 * Every edit is written through as it is made, so there is no Save button and no dialog asking
 * whether to keep anything — the same stance the request pane takes, for the same reason. The
 * writes are debounced, which is why leaving flushes: a token typed and a dialog closed in the
 * same second must not lose its last character.
 *
 * A variable marked secret has its value kept in the OS credential store rather than in
 * `rest-environments.json`, and is shown as dots until its owner asks to see it. Unmarking one
 * moves the value back into the file on the next write — which is the honest reading of unticking
 * a box called Secret.
 */
function EnvironmentDialog({ initialId, onClose }: Props) {
  const { t } = useTranslation();
  const environments = useEnvironments();
  const [chosenId, setChosenId] = useState<string | null>(initialId);
  const [confirmDelete, setConfirmDelete] = useState(false);
  /** Which value boxes have been asked to show themselves, by row. Held by position: a variable
   *  has no id of its own, and rows are only ever added at the foot or taken out. */
  const [revealed, setRevealed] = useState<number[]>([]);
  const { bind, owe } = useDraftFocus();

  /* The first environment when nothing is chosen, so the right-hand side is never empty while
     there is something to show — including straight after a delete. */
  const chosen = environments.find((env) => env.id === chosenId) ?? environments[0] ?? null;

  function done() {
    // The store is debounced, so the last keystroke is still in the air. This is what lands it.
    void flushEnvironments();
    onClose();
  }

  function pick(id: string | null) {
    setChosenId(id);
    // Revealing is per row, and the rows are about to be a different environment's.
    setRevealed([]);
  }

  function edit(patch: Partial<Environment>) {
    if (chosen === null) return;
    saveEnvironment({ ...chosen, ...patch });
  }

  function updateVar(index: number, patch: Partial<EnvVar>) {
    if (chosen === null) return;
    edit({ vars: chosen.vars.map((v, i) => (i === index ? { ...v, ...patch } : v)) });
  }

  function appendVar(column: "name" | "value", text: string) {
    if (chosen === null) return;
    owe(`${chosen.vars.length}:${column}`);
    edit({ vars: [...chosen.vars, { ...newVar(), [column]: text }] });
  }

  return (
    <>
      <Modal
        label={t("rest.envDialogTitle")}
        onClose={done}
        overlayClassName={styles.overlay}
        className={styles.dialog}
      >
        {(close) => (
          <>
          <div className={styles.header}>
            <h3 className={styles.title}>{t("rest.envDialogTitle")}</h3>
            <button
              type="button"
              className={styles.headerClose}
              onClick={() => close(done)}
              title={t("common.close")}
              aria-label={t("common.close")}
            >
              <CloseIcon />
            </button>
          </div>

          <div className={styles.body}>
            <div className={styles.list}>
              {environments.map((env) => (
                <button
                  key={env.id}
                  type="button"
                  className={`${styles.item}${env.id === chosen?.id ? ` ${styles.itemActive}` : ""}`}
                  onClick={() => pick(env.id)}
                >
                  {env.name}
                </button>
              ))}
              {environments.length === 0 && (
                <p className={`${styles.empty} muted`}>{t("rest.envEmpty")}</p>
              )}
              <Button
                size="small"
                className={styles.add}
                onClick={() => pick(createEnvironment(t("rest.envDefaultName")).id)}
              >
                <PlusIcon size="1em" />
                {t("rest.envNew")}
              </Button>
            </div>

            <div className={styles.detail}>
              {chosen === null ? (
                <p className={`${styles.empty} muted`}>{t("rest.envNonePicked")}</p>
              ) : (
                <>
                  <div className={styles.nameRow}>
                    <span className={styles.label}>{t("rest.envNameLabel")}</span>
                    <Input
                      className={styles.name}
                      size="small"
                      value={chosen.name}
                      aria-label={t("rest.envNameLabel")}
                      onChange={(e) => edit({ name: e.target.value })}
                    />
                    <button
                      type="button"
                      className={styles.delete}
                      onClick={() => setConfirmDelete(true)}
                      aria-label={t("rest.envDelete")}
                      title={t("rest.envDelete")}
                    >
                      <TrashIcon size="0.9em" />
                    </button>
                  </div>

                  <div className={styles.table}>
                    <div className={`${styles.row} ${styles.head}`}>
                      <span>{t("rest.envVarName")}</span>
                      <span>{t("rest.envVarValue")}</span>
                      <span title={t("rest.envVarSecretHint")}>{t("rest.envVarSecret")}</span>
                      <span />
                    </div>
                    {chosen.vars.map((variable, index) => {
                      const shown = !variable.secret || revealed.includes(index);
                      return (
                        <div key={index} className={styles.row}>
                          <Input
                            ref={bind(`${index}:name`)}
                            size="small"
                            value={variable.name}
                            aria-label={t("rest.envVarName")}
                            onChange={(e) => updateVar(index, { name: e.target.value })}
                          />
                          <div className={styles.value}>
                            <Input
                              ref={bind(`${index}:value`)}
                              size="small"
                              type={shown ? "text" : "password"}
                              value={variable.value}
                              aria-label={t("rest.envVarValue")}
                              onChange={(e) => updateVar(index, { value: e.target.value })}
                            />
                            {variable.secret && (
                              <button
                                type="button"
                                className={styles.reveal}
                                aria-label={shown ? t("rest.hideValue") : t("rest.showValue")}
                                title={shown ? t("rest.hideValue") : t("rest.showValue")}
                                onClick={() =>
                                  setRevealed((prev) =>
                                    shown ? prev.filter((i) => i !== index) : [...prev, index],
                                  )
                                }
                              >
                                {shown ? <EyeOffIcon size="0.9em" /> : <EyeIcon size="0.9em" />}
                              </button>
                            )}
                          </div>
                          <input
                            type="checkbox"
                            checked={variable.secret}
                            aria-label={t("rest.envVarSecret")}
                            title={t("rest.envVarSecretHint")}
                            onChange={(e) => updateVar(index, { secret: e.target.checked })}
                          />
                          <button
                            type="button"
                            className={styles.remove}
                            aria-label={t("rest.envRemoveVar")}
                            title={t("rest.envRemoveVar")}
                            onClick={() => {
                              setRevealed([]);
                              edit({ vars: chosen.vars.filter((_, i) => i !== index) });
                            }}
                          >
                            <CloseIcon size="0.9em" />
                          </button>
                        </div>
                      );
                    })}
                    {/* The empty row at the foot is not in the data: typing into it is what adds one,
                        exactly as in the request tables. */}
                    <div className={`${styles.row} ${styles.draft}`}>
                      <Input
                        size="small"
                        value=""
                        placeholder={t("rest.envAddVar")}
                        aria-label={t("rest.envAddVar")}
                        onChange={(e) => appendVar("name", e.target.value)}
                      />
                      <Input
                        size="small"
                        value=""
                        aria-label={t("rest.envVarValue")}
                        onChange={(e) => appendVar("value", e.target.value)}
                      />
                      <span />
                      <span />
                    </div>
                  </div>
          </>
            )}
          </div>
        </div>
          </>
        )}
      </Modal>
      {/* Its own portal, and outside the dialog on purpose: a confirm over a dialog is a
          second modal, not part of the first one's contents. */}
      {confirmDelete && chosen !== null && (
        <ConfirmDialog
          title={t("rest.envDeleteTitle")}
          message={t("rest.envDeleteMessage", { name: chosen.name })}
          confirmLabel={t("rest.delete")}
          danger
          onConfirm={() => {
            deleteEnvironment(chosen.id);
            setConfirmDelete(false);
            pick(null);
          }}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </>
  );
}

export default EnvironmentDialog;
