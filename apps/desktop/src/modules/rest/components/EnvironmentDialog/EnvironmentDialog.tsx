import { useState } from "react";
import Button from "../../../../components/Button";
import ConfirmDialog from "../../../../components/ConfirmDialog";
import Input, { Textarea } from "../../../../components/Input";
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
import Modal, { ModalBody } from "../../../../components/Modal";
import Checkbox from "../../../../components/Checkbox";
import Select from "../../../../components/Select";

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

  /* The first environment when nothing is chosen, so the table below the dropdown is never empty
     while there is something to show — including straight after a delete. */
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
        title={t("rest.envDialogTitle")}
        // Large: the variable rows carry a name, a value, a reveal, a secret tick and a delete,
        // and at the normal width the value is squeezed to a few characters and the row scrolls.
        size="large"
        layer={70}
        fixedHeight
        onClose={done}
      >
        {() => (
          <>
            <ModalBody fill>
              <div className={styles.body}>
                {/* Which environment, as a dropdown across the top rather than a column down the side:
                    the variable table is what needs the width, and a list of a handful of names
                    does not earn a column of its own. */}
                <div className={styles.picker}>
                  {chosen === null ? (
                    <p className={`${styles.empty} muted`}>{t("rest.envEmpty")}</p>
                  ) : (
                    <Select<string>
                      className={styles.select}
                      size="small"
                      value={chosen.id}
                      options={environments.map((env) => ({ value: env.id, label: env.name }))}
                      onChange={pick}
                      ariaLabel={t("rest.envLabel")}
                      searchable
                    />
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
                                {/* A textarea has no `type="password"`: a hidden secret is masked
                                    by the `masked` class instead. */}
                                <Textarea
                                  ref={bind(`${index}:value`)}
                                  size="small"
                                  maxRows={6}
                                  className={shown ? undefined : styles.masked}
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
                              {/* In a cell of its own so it can be one field tall and centred;
                                  the box alone would sit at the top of the row. */}
                              <span className={styles.tick}>
                                <Checkbox
                                  size="small"
                                  checked={variable.secret}
                                  aria-label={t("rest.envVarSecret")}
                                  title={t("rest.envVarSecretHint")}
                                  onChange={(e) => updateVar(index, { secret: e.target.checked })}
                                />
                              </span>
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
                          <Textarea
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
            </ModalBody>
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
