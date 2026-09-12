import { useCallback, useEffect, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";

import Button from "../../../../components/Button";
import ErrorBanner from "../../../../components/ErrorBanner";
import Input from "../../../../components/Input";
import Select from "../../../../components/Select";
import { errorMessage } from "../../../../core/errors";
import { useTranslation } from "../../../../i18n";
import * as api from "../../api";
import type { BlueprintApplied } from "@mixengine/api";
import type { BlueprintSummary } from "@mixengine/api";
import AfterApply from "../../components/AfterApply";
import ApplyDialog from "../Blueprints/ApplyDialog";
import { canStart } from "../../quickStart";
import styles from "./QuickStart.module.css";

/** Đã dựng xong tới đâu. */
type Phase =
  | { kind: "form" }
  | { kind: "applying"; blueprint: BlueprintSummary }
  | { kind: "settling"; applied: BlueprintApplied }
  | { kind: "done"; url: string | null };

/**
 * Dựng site đầu tiên trong một lần bấm — T117.
 *
 * **Một thẻ, không phải wizard.** Một modal chồng lên một daemon đang cài runtime là một modal chắn
 * đường; một màn hình riêng thì phải tự biện minh mãi mãi kể cả khi người ta đã có hai mươi site.
 * Thẻ này chỉ được vẽ khi `site.list` rỗng, và nó biến mất bằng cách **xong việc**.
 *
 * **Đoạn sau apply — cho phép → khởi động → mở — sống trong [`AfterApply`]**, không ở đây nữa.
 * Nó từng chỉ ở đây, nên apply từ màn Blueprints kết thúc ở một danh sách bước và một nút Đóng:
 * service chưa bật, tên miền chưa phân giải, và không có đường nào tới site vừa dựng. Thẻ này giờ
 * chỉ hỏi ba câu, mở `ApplyDialog`, rồi nhận lại một địa chỉ.
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
            <Select
              value={slug}
              onChange={setSlug}
              disabled={phase.kind !== "form"}
              options={available.map((blueprint) => ({
                value: blueprint.slug,
                label: blueprint.name,
              }))}
            />
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
            {phase.kind === "settling"
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
          // Thư mục người dùng chọn ở trên là **chỗ để đặt** project, không phải project — T120a.
          // Daemon đặt tên thư mục bằng handle của project, và tên đó hiện trong plan trước khi
          // bấm Apply.
          rootIsParent
          withFrontEnd
          autostart
          onCancel={() => setPhase({ kind: "form" })}
          onDone={(applied) => {
            if (applied === null) {
              setPhase({ kind: "form" });
              return;
            }
            setPhase({ kind: "settling", applied });
          }}
        />
      )}

      {/**
       * **`onCreated` chỉ được gọi ở đây, khi mọi thứ đã xong — và đó là một ràng buộc, không
       * phải một sở thích.** Dashboard vẽ thẻ này khi và chỉ khi `site.list` rỗng
       * (`shouldOfferQuickStart`), nên `onCreated` là cú đọc lại làm thẻ này **biến mất**. Gọi nó
       * sớm hơn — lúc apply vừa xong, chẳng hạn — sẽ unmount `AfterApply` ngay giữa chuỗi ba call
       * của nó: cú `site.list` của Dashboard về trong vài mili giây, còn chuỗi kia cần
       * `elevation.status` + `service.start_all` + `site.list`, nên nó thua chắc chắn chứ không
       * phải thua lúc được lúc mất. Triệu chứng là một project dựng xong mà trình duyệt không
       * bao giờ mở.
       */}
      {phase.kind === "settling" && (
        <AfterApply
          project={phase.applied.project}
          onFinished={(url) => {
            setPhase({ kind: "done", url });
            onCreated();
          }}
        />
      )}
    </section>
  );
}
