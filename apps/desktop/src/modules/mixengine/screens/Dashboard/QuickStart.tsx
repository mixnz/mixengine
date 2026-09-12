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
import type { BlueprintSummary } from "@mixengine/api";
import ElevationDialog from "../../components/ElevationDialog";
import ApplyDialog from "../Blueprints/ApplyDialog";
import { canStart } from "../../quickStart";
import { siteUrl } from "../../siteState";
import styles from "./QuickStart.module.css";

/** Đã dựng xong tới đâu. */
type Phase =
  | { kind: "form" }
  | { kind: "applying"; blueprint: BlueprintSummary }
  | { kind: "granting"; pending: unknown[]; canPrompt: boolean; reason?: string | null }
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

  /**
   * Lượt apply đã xong. Bước tiếp theo là **lượt cho phép**, không phải lượt khởi động.
   *
   * Một apply không bao giờ tự bật prompt — nó xếp hosts entry và chứng chỉ vào hàng đợi, và client
   * là chỗ tiêu cái prompt duy nhất ấy. Khởi động trước đó sẽ phục vụ site ở một tên máy này chưa
   * phân giải và bằng chứng chỉ chưa store nào tin.
   *
   * Hàng đợi rỗng (máy đã có sẵn tên trong hosts) thì đi thẳng sang khởi động — không có gì để hỏi.
   * Không đọc được `elevation.status` cũng đi tiếp: site vẫn chạy, và một thẻ đứng im vì không hỏi
   * được một câu phụ trợ thì tệ hơn một site chạy mà tên chưa phân giải.
   */
  async function granted() {
    setError("");

    try {
      const waiting = await api.elevationStatus();

      if (waiting.pending.length > 0) {
        setPhase({
          kind: "granting",
          pending: waiting.pending,
          canPrompt: waiting.can_prompt,
          reason: waiting.reason,
        });
        return;
      }
    } catch {
      // Đi tiếp: xem doc ở trên.
    }

    void start();
  }

  /** Khởi động mọi thứ home này khai, rồi tìm địa chỉ của site vừa dựng. */
  async function start() {
    setPhase({ kind: "starting" });
    setError("");

    try {
      await api.serviceStartAll();

      const sites = await api.sites(project);
      const made = sites.sites[0];

      setPhase({ kind: "done", url: made === undefined ? null : siteUrl(made) });
    } catch (e) {
      setError(errorMessage(t, e));
      setPhase({ kind: "done", url: null });
    } finally {
      // Dù khởi động được hay không: site đã tồn tại, nên Dashboard phải đọc lại `site.list` và
      // thôi mời dựng site đầu tiên.
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
          onDone={() => void granted()}
        />
      )}

      {/* Đóng hộp thoại là đi tiếp, không phải huỷ: `elevation.drop` không có ở đây, nên đóng chỉ
          ẩn nó đi và hàng đợi vẫn còn — Dashboard vẫn đếm. Site vẫn nên được khởi động: một tên
          chưa phân giải là chuyện của hàng đợi, không phải lý do để không chạy gì cả. */}
      {phase.kind === "granting" && (
        <ElevationDialog
          pending={phase.pending}
          canPrompt={phase.canPrompt}
          reason={phase.reason}
          onClose={() => void start()}
        />
      )}
    </section>
  );
}
