import type { AnswerSubject } from "@mixengine/api";
import type { BlueprintApplied } from "@mixengine/api";
import type { BlueprintPlan } from "@mixengine/api";
import type { JobSummary } from "@mixengine/api";
import type { MismatchAnswer } from "@mixengine/api";
import type { PlanAction } from "@mixengine/api";
import type { PlanStep } from "@mixengine/api";
import type { ScaffoldConsent } from "@mixengine/api";
import type { VersionAnswer } from "@mixengine/api";
import type { TranslationKey } from "../../i18n";

/**
 * Chỉ hai loại action từng sinh `disposition: "choice"` trong bindings hiện tại
 * (`install_runtime`, `ensure_service`) — subject suy từ chính action đó.
 *
 * **`id` của service ghép `${package}@${instance}` — suy ra, chưa đối chiếu daemon thật.** Xem ghi
 * chú Task 12 (Blueprints plan) và Self-Review Notes.
 */
export function answerSubjectFor(step: PlanStep): AnswerSubject | null {
  if (step.disposition.disposition !== "choice") return null;
  if (step.action.action === "install_runtime") {
    return { subject: "runtime", kind: step.action.kind };
  }
  if (step.action.action === "ensure_service") {
    return { subject: "service", id: `${step.action.package}@${step.action.instance}` };
  }
  return null;
}

/** `-1` khi plan không có bước `run_scaffold` nào — luôn tối đa một bước như vậy trên một plan. */
export function scaffoldStepIndex(steps: PlanStep[]): number {
  return steps.findIndex((step) => step.action.action === "run_scaffold");
}

/**
 * Ô đồng ý đang ở trạng thái nào — `none` khi plan không hề có lệnh nào để hỏi.
 *
 * **`declined` là một câu trả lời, không phải một ô chưa chạm tới.** Trong `mix`, câu hỏi này là
 * một `[y/N]` chặn ngang: không trả lời thì không đi tiếp được, và `unasked` in hẳn một dòng stderr
 * nói lệnh đã bị bỏ. Trên desktop ô tick im lặng, nên một apply bỏ qua lệnh khởi tạo trông y hệt
 * một apply chạy nó — người dùng chỉ biết ở màn "Xong", lẫn giữa mười dòng khác. Trạng thái này là
 * thứ để giao diện nói trước, ở nút bấm và ở khối cảnh báo cạnh ô tick.
 */
export function scaffoldConsentState(
  steps: PlanStep[],
  agreed: boolean,
): "none" | "agreed" | "declined" {
  if (scaffoldStepIndex(steps) < 0) return "none";
  return agreed ? "agreed" : "declined";
}

/**
 * Lệnh khởi tạo đã bị bỏ lại, hoặc `null`.
 *
 * Dùng để dựng một khối riêng ở đầu màn "Xong" thay cho dòng `stepNotRun` lẫn trong danh sách —
 * và thay cho `why` của daemon, vốn kết bằng một gợi ý `mix blueprint apply --run-scaffold`: một
 * cờ dòng lệnh vô nghĩa với người đang bấm chuột.
 */
export function scaffoldLeftCommand(applied: BlueprintApplied): string | null {
  for (const outcome of applied.steps) {
    if (outcome.action.action !== "run_scaffold") continue;
    if (outcome.result.result !== "not_run") continue;
    return outcome.action.command;
  }
  return null;
}

/**
 * Apply thật chỉ bật khi mọi bước `choice` đã có câu trả lời và không bước nào `blocked`/
 * `unsupported`. Một bước `confirm` (scaffold) không chặn gì — từ chối nó chỉ khiến bước đó
 * `not_run`, không khiến cả plan không gửi được.
 */
export function canApply(steps: PlanStep[], choices: Record<number, MismatchAnswer>): boolean {
  return steps.every((step, i) => {
    const d = step.disposition.disposition;
    if (d === "blocked" || d === "unsupported") return false;
    if (d === "choice") return choices[i] !== undefined;
    return true;
  });
}

export function buildAnswers(
  steps: PlanStep[],
  choices: Record<number, MismatchAnswer>,
): VersionAnswer[] {
  const answers: VersionAnswer[] = [];
  steps.forEach((step, i) => {
    const subject = answerSubjectFor(step);
    const answer = choices[i];
    if (subject && answer) answers.push({ subject, answer });
  });
  return answers;
}

/** `command` là đúng chuỗi step đã hiện — không phải cái gì người dùng gõ lại. */
export function buildScaffoldConsent(plan: BlueprintPlan, step: PlanStep): ScaffoldConsent | null {
  if (step.action.action !== "run_scaffold") return null;
  return { command: step.action.command, untrusted: !plan.trusted };
}

/** Một câu người đọc được cho mỗi `PlanAction` — mười biến thể, mười khoá i18n. */
export function describePlanAction(
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string,
  action: PlanAction,
): string {
  const base = "mixengine.blueprints.apply.action" as const;
  switch (action.action) {
    case "register_project":
      return t(`${base}.register_project`, { name: action.name, root: action.root });
    case "install_runtime":
      return t(`${base}.install_runtime`, { kind: action.kind, wanted: action.wanted });
    case "install_package":
      return t(`${base}.install_package`, {
        package: action.package,
        wanted: action.wanted ?? "latest",
      });
    case "ensure_service":
      return t(`${base}.ensure_service`, { package: action.package, instance: action.instance });
    case "create_database":
      return t(`${base}.create_database`, { database: action.database, user: action.user });
    case "create_site":
      return t(`${base}.create_site`, { kind: action.kind.kind, docRoot: action.doc_root });
    case "add_domain":
      return t(`${base}.add_domain`, { domain: action.domain });
    case "issue_certificate":
      return t(`${base}.issue_certificate`, { domains: action.domains.join(", ") });
    case "set_php_extension":
      return t(`${base}.set_php_extension`, { name: action.name, runtime: action.runtime });
    case "run_scaffold":
      return t(`${base}.run_scaffold`, { command: action.command });
  }
}

/** `null` cho một job chưa xong, thất bại, hay bị huỷ — không suy ra từ `state`, chỉ đọc `outcome`. */
export function blueprintAppliedFrom(job: JobSummary): BlueprintApplied | null {
  if (job.outcome?.ending !== "succeeded") return null;
  return job.outcome.result as BlueprintApplied;
}

/** `null` khi job không thất bại (kể cả đang chạy, kể cả huỷ) — huỷ không phải một lỗi để hiện. */
export function jobFailureMessage(job: JobSummary): string | null {
  return job.outcome?.ending === "failed" ? job.outcome.error.message : null;
}
