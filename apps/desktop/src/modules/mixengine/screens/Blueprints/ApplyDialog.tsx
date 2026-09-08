import { useEffect, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";

import Button from "../../../../components/Button";
import Input from "../../../../components/Input";
import Modal from "../../../../components/Modal";
import { errorMessage } from "../../../../core/errors";
import { useTranslation } from "../../../../i18n";
import * as api from "../../api";
import type { BlueprintApplied } from "../../api/types/BlueprintApplied";
import type { BlueprintPlan } from "../../api/types/BlueprintPlan";
import type { BlueprintSummary } from "../../api/types/BlueprintSummary";
import type { MismatchAnswer } from "../../api/types/MismatchAnswer";
import {
  answerSubjectFor,
  blueprintAppliedFrom,
  buildAnswers,
  buildScaffoldConsent,
  canApply,
  describePlanAction,
  jobFailureMessage,
  scaffoldStepIndex,
} from "../../blueprintPlan";
import { applyJob, type JobRow } from "../../daemonState";
import { subscribeDaemonWatch } from "../../daemonWatch";
import { applyLogFrame, type LogEntry } from "../../logState";
import { jobFor } from "../../runtimeState";
import styles from "./ApplyDialog.module.css";

interface Props {
  blueprint: BlueprintSummary;
  onCancel: () => void;
  onDone: () => void;
}

type Phase =
  | { kind: "form" }
  | { kind: "plan"; plan: BlueprintPlan }
  | { kind: "running"; jobId: number }
  | { kind: "done"; applied: BlueprintApplied }
  | { kind: "failed"; message: string };

/**
 * Một method (`blueprint.apply`), gọi hai lượt. Lượt 1 (`dry_run: true`) chỉ đọc; lượt 2
 * (`dry_run: false`) là lượt duy nhất thật sự làm gì, và chỉ gửi được sau khi `canApply` đồng ý.
 */
export default function ApplyDialog({ blueprint, onCancel, onDone }: Props) {
  const { t } = useTranslation();
  const [project, setProject] = useState("");
  const [root, setRoot] = useState("");
  const [phase, setPhase] = useState<Phase>({ kind: "form" });
  const [choices, setChoices] = useState<Record<number, MismatchAnswer>>({});
  const [scaffoldAgreed, setScaffoldAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [showLog, setShowLog] = useState(false);
  const [logEntries, setLogEntries] = useState<LogEntry[]>([]);

  async function browseRoot() {
    const picked = await openDialog({ directory: true, multiple: false });
    if (typeof picked === "string") setRoot(picked);
  }

  async function preview() {
    setBusy(true);
    setError("");
    try {
      const response = await api.blueprintApply({
        blueprint: blueprint.slug,
        project,
        root,
        dry_run: true,
      });
      if (response.outcome === "planned") {
        setChoices({});
        setScaffoldAgreed(false);
        setPhase({ kind: "plan", plan: response.plan });
      }
    } catch (e) {
      setError(errorMessage(t, e));
    } finally {
      setBusy(false);
    }
  }

  async function apply(plan: BlueprintPlan) {
    setBusy(true);
    setError("");
    try {
      const scaffoldIndex = scaffoldStepIndex(plan.steps);
      const scaffold =
        scaffoldAgreed && scaffoldIndex >= 0
          ? buildScaffoldConsent(plan, plan.steps[scaffoldIndex])
          : undefined;
      const response = await api.blueprintApply({
        blueprint: blueprint.slug,
        project,
        root,
        dry_run: false,
        answers: buildAnswers(plan.steps, choices),
        scaffold: scaffold ?? undefined,
      });
      if (response.outcome === "started") {
        setPhase({ kind: "running", jobId: response.job.id });
      }
    } catch (e) {
      setError(errorMessage(t, e));
    } finally {
      setBusy(false);
    }
  }

  // Theo dõi job khi đang chạy — đăng ký đúng một lần, gỡ khi rời phase "running". Qua
  // `subscribeDaemonWatch` chứ không gọi thẳng `api.watch()`: kênh đó dùng chung cho cả app (xem
  // `daemonWatch.ts`) — Dashboard/Sites/Runtimes rất có thể đang mở cùng lúc dialog này, và một
  // `api.watch()`/`api.unwatch()` riêng ở đây sẽ giành mất hoặc đóng luôn kênh của chúng.
  useEffect(() => {
    if (phase.kind !== "running") return;
    return subscribeDaemonWatch((raw) => setJobs((current) => applyJob(current, raw)));
  }, [phase.kind]);

  // Job đã biến khỏi JobRow[] (job_finished) — đọc lại kết quả đầy đủ qua job.status.
  useEffect(() => {
    if (phase.kind !== "running") return;
    if (jobFor(jobs, phase.jobId) !== undefined) return;
    let live = true;
    api
      .jobStatus(phase.jobId)
      .then((job) => {
        if (!live) return;
        const applied = blueprintAppliedFrom(job);
        const failure = jobFailureMessage(job);
        if (applied) setPhase({ kind: "done", applied });
        else if (failure !== null) setPhase({ kind: "failed", message: failure });
      })
      .catch((e: unknown) => setError(errorMessage(t, e)));
    return () => {
      live = false;
    };
  }, [phase, jobs, t]);

  useEffect(() => {
    if (!showLog || phase.kind !== "running") return;
    setLogEntries([]);
    api
      .jobLogsWatch(phase.jobId, 200, true, (raw) => {
        setLogEntries((current) => applyLogFrame(current, raw, 2000));
      })
      .catch((e: unknown) => setError(errorMessage(t, e)));
    return () => {
      void api.jobLogsUnwatch();
    };
  }, [showLog, phase, t]);

  const running = phase.kind === "running" ? jobFor(jobs, phase.jobId) : undefined;

  return (
    <Modal
      label={t("mixengine.blueprints.apply.title", { blueprint: blueprint.name })}
      onClose={onCancel}
      locked={busy}
      overlayClassName={styles.overlay}
      className={styles.dialog}
    >
      {(close) => (
        <>
          <h3 className={styles.title}>
            {t("mixengine.blueprints.apply.title", { blueprint: blueprint.name })}
          </h3>

          {phase.kind === "form" && (
            <div className={styles.form}>
              <label className={styles.field}>
                {t("mixengine.blueprints.apply.project")}
                <Input value={project} disabled={busy} onChange={(e) => setProject(e.target.value)} />
              </label>
              <label className={styles.field}>
                {t("mixengine.blueprints.apply.root")}
                <div className={styles.rootRow}>
                  <Input value={root} disabled={busy} onChange={(e) => setRoot(e.target.value)} />
                  <Button onClick={() => void browseRoot()} disabled={busy}>
                    {t("common.browse")}
                  </Button>
                </div>
              </label>
            </div>
          )}

          {phase.kind === "plan" && (
            <div className={styles.plan}>
              <h4>{t("mixengine.blueprints.apply.planTitle")}</h4>
              <ul className={styles.steps}>
                {phase.plan.steps.map((step, i) => (
                  <li key={i} className={styles.step}>
                    <p>{describePlanAction(t, step.action)}</p>
                    {step.disposition.disposition === "blocked" && (
                      <p className={styles.blocked}>
                        {t("mixengine.blueprints.apply.stepBlocked", {
                          reason: step.disposition.reason,
                        })}
                      </p>
                    )}
                    {step.disposition.disposition === "unsupported" && (
                      <p className={styles.blocked}>
                        {t("mixengine.blueprints.apply.stepUnsupported", {
                          reason: step.disposition.reason,
                        })}
                      </p>
                    )}
                    {step.disposition.disposition === "choice" && answerSubjectFor(step) && (
                      <div className={styles.choice}>
                        <p>
                          {t("mixengine.blueprints.apply.choiceInstalled", {
                            installed: step.disposition.installed,
                          })}{" "}
                          —{" "}
                          {t("mixengine.blueprints.apply.choiceWanted", {
                            wanted: step.disposition.wanted,
                          })}
                        </p>
                        <Button
                          variant={choices[i] === "install" ? "primary" : "default"}
                          onClick={() => setChoices((c) => ({ ...c, [i]: "install" }))}
                        >
                          {t("mixengine.blueprints.apply.choiceInstall")}
                        </Button>
                        <Button
                          variant={choices[i] === "use_installed" ? "primary" : "default"}
                          onClick={() => setChoices((c) => ({ ...c, [i]: "use_installed" }))}
                        >
                          {t("mixengine.blueprints.apply.choiceUseInstalled")}
                        </Button>
                      </div>
                    )}
                    {step.action.action === "run_scaffold" && (
                      <div className={styles.scaffold}>
                        <p>{t("mixengine.blueprints.apply.scaffoldTitle")}</p>
                        <code>{step.action.command}</code>
                        {!phase.plan.trusted && (
                          <p className={styles.blocked}>
                            {t("mixengine.blueprints.apply.scaffoldUntrusted")}
                          </p>
                        )}
                        <label className={styles.checkbox}>
                          <input
                            type="checkbox"
                            checked={scaffoldAgreed}
                            onChange={(e) => setScaffoldAgreed(e.target.checked)}
                          />
                          {t("mixengine.blueprints.apply.scaffoldConsent")}
                        </label>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {phase.kind === "running" && (
            <div className={styles.running}>
              <p>{t("mixengine.blueprints.apply.running")}</p>
              <progress value={running?.percent ?? 0} max={100} />
              <p>{running?.message ?? ""}</p>
              <Button onClick={() => setShowLog((v) => !v)}>
                {showLog
                  ? t("mixengine.blueprints.apply.hideLog")
                  : t("mixengine.blueprints.apply.viewLog")}
              </Button>
              {showLog && (
                <div className={styles.log}>
                  {logEntries.map((entry, i) =>
                    entry.kind === "gap" ? (
                      <div key={i} className={styles.gap}>
                        {t("mixengine.logs.gap", { count: entry.missed })}
                      </div>
                    ) : (
                      <div key={i} className={styles.logLine}>
                        {entry.text}
                      </div>
                    ),
                  )}
                </div>
              )}
            </div>
          )}

          {phase.kind === "done" && (
            <div className={styles.done}>
              <h4>{t("mixengine.blueprints.apply.doneTitle")}</h4>
              <ul className={styles.steps}>
                {phase.applied.steps.map((outcome, i) => (
                  <li key={i} className={styles.step}>
                    <p>{describePlanAction(t, outcome.action)}</p>
                    <p>
                      {outcome.result.result === "done" && t("mixengine.blueprints.apply.stepDone")}
                      {outcome.result.result === "already_true" &&
                        t("mixengine.blueprints.apply.stepAlreadyTrue")}
                      {outcome.result.result === "not_run" &&
                        t("mixengine.blueprints.apply.stepNotRun", { why: outcome.result.why })}
                      {outcome.result.result === "failed" &&
                        t("mixengine.blueprints.apply.stepFailed", { why: outcome.result.why })}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {phase.kind === "failed" && (
            <div className={styles.errors} role="alert">
              <p>{phase.message}</p>
            </div>
          )}

          {error !== "" && (
            <div className={styles.errors} role="alert">
              <p>{error}</p>
            </div>
          )}

          <div className={styles.actions}>
            {(phase.kind === "form" || phase.kind === "plan") && (
              <Button size="large" onClick={() => close(onCancel)} disabled={busy}>
                {t("common.cancel")}
              </Button>
            )}
            {phase.kind === "form" && (
              <Button
                size="large"
                variant="primary"
                onClick={() => void preview()}
                disabled={busy || project.trim() === "" || root.trim() === ""}
              >
                {busy
                  ? t("mixengine.blueprints.apply.previewing")
                  : t("mixengine.blueprints.apply.preview")}
              </Button>
            )}
            {phase.kind === "plan" && (
              <Button
                size="large"
                variant="primary"
                onClick={() => void apply(phase.plan)}
                disabled={busy || !canApply(phase.plan.steps, choices)}
              >
                {busy
                  ? t("mixengine.blueprints.apply.applying")
                  : t("mixengine.blueprints.apply.applyButton")}
              </Button>
            )}
            {(phase.kind === "done" || phase.kind === "failed") && (
              <Button size="large" variant="primary" onClick={() => close(onDone)}>
                {t("mixengine.blueprints.apply.close")}
              </Button>
            )}
          </div>
        </>
      )}
    </Modal>
  );
}
