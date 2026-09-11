import { useCallback, useEffect, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";

import Button from "../../../../components/Button";
import ErrorBanner from "../../../../components/ErrorBanner";
import Input from "../../../../components/Input";
import { errorMessage } from "../../../../core/errors";
import { useTranslation } from "../../../../i18n";
import * as api from "../../api";
import type { BlueprintSummary } from "@mixengine/api";
import ApplyDialog from "../Blueprints/ApplyDialog";
import { canStart } from "../../quickStart";
import { siteUrl } from "../../siteState";
import styles from "./QuickStart.module.css";

/** Đã dựng xong tới đâu. */
type Phase =
  | { kind: "form" }
  | { kind: "applying"; blueprint: BlueprintSummary }
  | { kind: "starting" }
  | { kind: "done"; url: string | null };

/**
 * Dựng site đầu tiên trong một lần bấm — T117.
 *
 * **Một thẻ, không phải wizard.** Một modal chồng lên một daemon đang cài runtime là một modal chắn
 * đường; một màn hình riêng thì phải tự biện minh mãi mãi kể cả khi người ta đã có hai mươi site.
 * Thẻ này chỉ được vẽ khi `site.list` rỗng, và nó biến mất bằng cách **xong việc**.
 *
 * **Ba call, theo đúng thứ tự đó, và thứ tự mới là phần khó.** `blueprint.apply` không bao giờ bật
 * prompt quyền — nó xếp hàng đợi và client là chỗ tiêu cái prompt duy nhất ấy. Nên: apply → cho
 * phép → khởi động → mở. Khởi động *trước* lượt cho phép sẽ phục vụ site ở một tên máy này chưa
 * phân giải và bằng chứng chỉ chưa store nào tin — một lỗi trình duyệt nằm cuối một thanh tiến độ.
 *
 * **"Khởi động" nghĩa là mọi service home này khai**, và nút nói đúng câu đó. Tự suy ra tập service
 * của riêng apply này từ kế hoạch đã xong là business logic trong client — và còn sai ở lần apply
 * thứ hai, nơi web server site cần là cái kế hoạch *tìm thấy* chứ không phải cái nó tạo ra. Trên
 * home mà thẻ này xuất hiện, hai tập đó là một.
 */
export default function QuickStart({ onCreated }: { onCreated: () => void }) {
  const [available, setAvailable] = useState<BlueprintSummary[]>([]);
  const [slug, setSlug] = useState("");
  const [project, setProject] = useState("");
  const [root, setRoot] = useState("");
  const [phase, setPhase] = useState<Phase>({ kind: "form" });
  const [error, setError] = useState("");
  const { t } = useTranslation();

  const reload = useCallback(async () => {
    try {
      const listed = await api.blueprints();
      setAvailable(listed.blueprints);
      setSlug((current) => (current === "" ? (listed.blueprints[0]?.slug ?? "") : current));
      setError("");
    } catch (e) {
      setError(errorMessage(t, e));
    }
  }, [t]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function browse() {
    const picked = await openDialog({ directory: true, multiple: false });
    if (typeof picked === "string") setRoot(picked);
  }

  /** Lượt apply đã xong: tiêu prompt quyền nếu có, rồi khởi động, rồi tìm địa chỉ. */
  async function finish() {
    setPhase({ kind: "starting" });
    setError("");

    try {
      // Hàng đợi quyền: apply đã xếp hosts entry và chứng chỉ vào đó. Dashboard vẽ dialog của nó từ
      // cùng một `elevation.status`, nên ở đây chỉ cần *chờ cho hàng đợi rỗng* thì mới khởi động —
      // và khi máy không prompt được thì vẫn đi tiếp: site chạy, chỉ là tên chưa phân giải, và câu
      // nói điều đó là của ElevationDialog.
      await api.serviceStartAll();

      const sites = await api.sites(project);
      const made = sites.sites[0];

      setPhase({ kind: "done", url: made === undefined ? null : siteUrl(made) });
      onCreated();
    } catch (e) {
      setError(errorMessage(t, e));
      setPhase({ kind: "done", url: null });
      onCreated();
    }
  }

  const chosen = available.find((blueprint) => blueprint.slug === slug);

  return (
    <section className={styles.card}>
      {error !== "" && <ErrorBanner message={error} onDismiss={() => setError("")} />}

      <h3 className={styles.title}>{t("mixengine.quickStart.title")}</h3>
      <p className={styles.intro}>{t("mixengine.quickStart.intro")}</p>

      {phase.kind === "done" ? (
        <div className={styles.doneRow}>
          <span>{t("mixengine.quickStart.done")}</span>
          {phase.url !== null && (
            <Button variant="primary" onClick={() => void openUrl(phase.url ?? "")}>
              {t("mixengine.quickStart.open", { url: phase.url })}
            </Button>
          )}
        </div>
      ) : (
        <div className={styles.form}>
          <label className={styles.field}>
            {t("mixengine.quickStart.stack")}
            <select
              className={styles.select}
              value={slug}
              disabled={phase.kind !== "form"}
              onChange={(e) => setSlug(e.target.value)}
            >
              {available.map((blueprint) => (
                <option key={blueprint.slug} value={blueprint.slug}>
                  {blueprint.name}
                </option>
              ))}
            </select>
          </label>

          <label className={styles.field}>
            {t("mixengine.quickStart.name")}
            <Input
              value={project}
              disabled={phase.kind !== "form"}
              onChange={(e) => setProject(e.target.value)}
            />
          </label>

          <label className={styles.field}>
            {t("mixengine.quickStart.folder")}
            <div className={styles.folderRow}>
              <Input value={root} disabled={phase.kind !== "form"} readOnly />
              <Button onClick={() => void browse()} disabled={phase.kind !== "form"}>
                {t("mixengine.quickStart.browse")}
              </Button>
            </div>
          </label>

          <Button
            variant="primary"
            disabled={
              phase.kind !== "form" || chosen === undefined || !canStart(project, root)
            }
            onClick={() => chosen && setPhase({ kind: "applying", blueprint: chosen })}
          >
            {phase.kind === "starting"
              ? t("mixengine.quickStart.starting")
              : t("mixengine.quickStart.create")}
          </Button>
        </div>
      )}

      {phase.kind === "applying" && (
        <ApplyDialog
          blueprint={phase.blueprint}
          initialProject={project}
          initialRoot={root}
          withFrontEnd
          autostart
          onCancel={() => setPhase({ kind: "form" })}
          onDone={() => void finish()}
        />
      )}
    </section>
  );
}
