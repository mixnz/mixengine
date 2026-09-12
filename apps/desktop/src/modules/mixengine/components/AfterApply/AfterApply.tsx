import { useEffect, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";

import Button from "../../../../components/Button";
import Modal from "../../../../components/Modal";
import { errorMessage } from "../../../../core/errors";
import { useTranslation } from "../../../../i18n";
import * as api from "../../api";
import { siteUrl } from "../../siteState";
import ElevationDialog from "../ElevationDialog";
import styles from "./AfterApply.module.css";

/** Đã đi tới đâu trong chuỗi ba bước. */
type Phase =
  | { kind: "checking" }
  | { kind: "granting"; pending: unknown[]; canPrompt: boolean; reason?: string | null }
  | { kind: "starting" }
  | { kind: "ready"; url: string | null };

interface Props {
  /** Project vừa được apply dựng ra — dùng để tìm site của chính nó. */
  project: string;

  /** Người dùng đóng khối này. `url` là địa chỉ tìm được, hoặc `null` nếu không có site nào. */
  onFinished: (url: string | null) => void;
}

/**
 * Đoạn sau một `blueprint.apply` thành công: xin quyền → khởi động → mở site.
 *
 * **Ba call, theo đúng thứ tự đó, và thứ tự mới là phần khó.** `blueprint.apply` không bao giờ bật
 * prompt quyền — nó xếp hosts entry và chứng chỉ vào hàng đợi, và client là chỗ tiêu cái prompt duy
 * nhất ấy. Khởi động *trước* lượt cho phép sẽ phục vụ site ở một tên máy này chưa phân giải và
 * bằng chứng chỉ chưa store nào tin; mở trình duyệt vào đó là một lỗi đỏ nằm cuối một thanh tiến
 * độ xanh.
 *
 * Hàng đợi rỗng (máy đã có sẵn tên trong hosts) thì đi thẳng sang khởi động — không có gì để hỏi.
 * Không đọc được `elevation.status` cũng đi tiếp: site vẫn chạy, và đứng im vì không hỏi được một
 * câu phụ trợ thì tệ hơn một site chạy mà tên chưa phân giải.
 *
 * **"Khởi động" nghĩa là mọi service home này khai**, và câu chữ nói đúng thế. Tự suy ra tập
 * service của riêng apply này từ kế hoạch đã xong là business logic trong client — và còn sai ở
 * lần apply thứ hai, nơi web server site cần là cái kế hoạch *tìm thấy* chứ không phải cái nó tạo
 * ra.
 *
 * **Một component chứ không phải hai bản sao.** Chuỗi này từng chỉ sống trong `QuickStart`, nên
 * apply từ màn Blueprints kết thúc ở một danh sách bước và một nút Đóng: service chưa bật, tên
 * miền chưa phân giải, và không có đường nào tới site vừa dựng.
 *
 * **Không lồng trong `ApplyDialog`.** Cả `ElevationDialog` lẫn khối này đều là `Modal`, và `Modal`
 * nghe Escape ở mức `window`: hai cái chồng nhau thì một phím Escape đóng cả hai. Nên `ApplyDialog`
 * đóng lại trước, rồi màn gọi nó dựng component này lên thay chỗ.
 *
 * **Đưa ra địa chỉ, không tự điều hướng.** Bản đầu mở luôn trình duyệt khi lệnh khởi tạo đã chạy;
 * thử xong thì thấy chính cái popup này đã làm đủ việc *cho người ta thấy thành quả*, và giật một
 * cửa sổ trình duyệt lên trước mặt ai đó là một tác dụng phụ họ không xin. Nút ở đây, cú bấm là
 * của họ.
 */
export default function AfterApply({ project, onFinished }: Props) {
  const [phase, setPhase] = useState<Phase>({ kind: "checking" });
  const [error, setError] = useState("");
  const { t } = useTranslation();

  // Lượt xin quyền. Chạy đúng một lần, ngay khi khối này dựng lên.
  useEffect(() => {
    if (phase.kind !== "checking") return;
    let live = true;
    api
      .elevationStatus()
      .then((waiting) => {
        if (!live) return;
        if (waiting.pending.length > 0) {
          setPhase({
            kind: "granting",
            pending: waiting.pending,
            canPrompt: waiting.can_prompt,
            reason: waiting.reason,
          });
        } else {
          setPhase({ kind: "starting" });
        }
      })
      // Đi tiếp: xem doc ở trên.
      .catch(() => live && setPhase({ kind: "starting" }));
    return () => {
      live = false;
    };
  }, [phase.kind]);

  // Lượt khởi động, rồi tìm địa chỉ của site vừa dựng.
  useEffect(() => {
    if (phase.kind !== "starting") return;
    let live = true;
    void (async () => {
      try {
        await api.serviceStartAll();
        const listed = await api.sites(project);
        const made = listed.sites[0];
        const url = made === undefined ? null : siteUrl(made);
        if (!live) return;
        setPhase({ kind: "ready", url });
      } catch (e) {
        if (!live) return;
        setError(errorMessage(t, e));
        setPhase({ kind: "ready", url: null });
      }
    })();
    return () => {
      live = false;
    };
  }, [phase.kind, project, t]);

  // Đóng hộp thoại quyền là đi tiếp, không phải huỷ: `elevation.drop` không có ở đây, nên đóng chỉ
  // ẩn nó đi và hàng đợi vẫn còn — Dashboard vẫn đếm. Site vẫn nên được khởi động: một tên chưa
  // phân giải là chuyện của hàng đợi, không phải lý do để không chạy gì cả.
  if (phase.kind === "granting") {
    return (
      <ElevationDialog
        pending={phase.pending}
        canPrompt={phase.canPrompt}
        reason={phase.reason}
        onClose={() => setPhase({ kind: "starting" })}
      />
    );
  }

  const done = phase.kind === "ready";

  // Tiêu đề nói đúng trạng thái nó đang ở. Một cái nhan đề đứng yên ở "Đang đưa project lên" phía
  // trên một dòng "đã sẵn sàng" là hai câu cãi nhau trong cùng một hộp thoại — và nhan đề là thứ
  // người ta đọc trước.
  const heading = done
    ? t("mixengine.afterApply.titleReady")
    : t("mixengine.afterApply.titleWorking");

  return (
    <Modal
      label={heading}
      onClose={() => onFinished(done ? phase.url : null)}
      locked={!done}
      overlayClassName={styles.overlay}
      className={styles.dialog}
    >
      {(close) => (
        <>
          <h3 className={styles.title}>{heading}</h3>

          {!done && (
            <div className={styles.status}>
              <p>{t("mixengine.afterApply.starting")}</p>
              <progress />
            </div>
          )}

          {done && (
            <div className={styles.status}>
              {phase.url === null ? (
                <p>{t("mixengine.afterApply.noSite")}</p>
              ) : (
                <>
                  <p>{t("mixengine.afterApply.ready", { url: phase.url })}</p>
                  <Button variant="primary" onClick={() => void openUrl(phase.url ?? "")}>
                    {t("mixengine.afterApply.open", { url: phase.url })}
                  </Button>
                </>
              )}
            </div>
          )}

          {error !== "" && (
            <div className={styles.errors} role="alert">
              <p>{error}</p>
            </div>
          )}

          <div className={styles.actions}>
            <Button
              size="large"
              disabled={!done}
              onClick={() => close(() => onFinished(done ? phase.url : null))}
            >
              {t("mixengine.afterApply.close")}
            </Button>
          </div>
        </>
      )}
    </Modal>
  );
}
