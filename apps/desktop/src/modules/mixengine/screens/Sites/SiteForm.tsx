import { useEffect, useState } from "react";

import Modal, { ModalBody, ModalErrors } from "../../../../components/Modal";
import Select from "../../../../components/Select";
import { errorMessage } from "../../../../core/errors";
import { useTranslation } from "../../../../i18n";
import * as api from "../../api";
import type { SiteDetail } from "@mixengine/api";
import SiteFields, {
  emptySiteDraft,
  siteCreateFields,
  siteDraftFromDetail,
  siteUpdateFields,
} from "../../components/SiteFields";
import styles from "./SiteForm.module.css";

interface Props {
  /** `undefined` = tạo mới. Có giá trị = sửa, khoá project lại. */
  initial?: SiteDetail;
  /** Chọn sẵn khi tạo mới — Sites truyền project đang lọc, nếu có. Bỏ qua khi `initial` có giá trị. */
  defaultProject?: string;
  onCancel: () => void;
  /** Gọi sau khi lưu xong — cha tự `reload()`. */
  onSaved: () => void;
}

export default function SiteForm({ initial, defaultProject, onCancel, onSaved }: Props) {
  const { t } = useTranslation();
  const editing = initial !== undefined;

  const [projectNames, setProjectNames] = useState<string[]>([]);
  const [serviceIds, setServiceIds] = useState<string[]>([]);
  // `false` cho tới khi cả hai danh sách trên tới nơi — xem chỗ dùng nó ngay trước `return`.
  const [listsReady, setListsReady] = useState(false);

  const [project, setProject] = useState(
    editing && initial.site.owner.type === "project"
      ? initial.site.owner.name
      : (defaultProject ?? ""),
  );
  // Root của project sở hữu site — cho tạo mới, đọc lại mỗi khi đổi project (dưới); cho sửa,
  // `SiteDetail.root` đã có sẵn, project bị khoá nên không đổi nữa. Chỉ để hiển thị: giá trị gửi
  // lên daemon vẫn luôn là phần còn lại một mình (`docRoot`), đúng `SiteSummary.doc_root`.
  const [projectRoot, setProjectRoot] = useState(editing ? initial.root : "");
  // Đã có lần trả lời đầu tiên chưa — khác với `projectRoot !== ""`, vì "" là một câu trả lời hợp
  // lệ (không project nào chọn, hoặc project rỗng thật). Chỉ chặn Modal ở lần đầu; đổi project sau
  // khi Modal đã mở không đóng nó lại, xem chỗ dùng ngay trước `return`.
  const [projectRootReady, setProjectRootReady] = useState(editing);
  const [draft, setDraft] = useState(() => (editing ? siteDraftFromDetail(initial) : emptySiteDraft()));

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    void Promise.all([api.projects(), api.services()]).then(([projectList, serviceList]) => {
      setProjectNames(projectList.projects.map((p) => p.name));
      setServiceIds(serviceList.services.map((s) => s.id));
      setListsReady(true);
    });
  }, []);

  // Chỉ cho tạo mới — sửa thì project bị khoá và `initial.root` đã là root đúng, không đổi nữa.
  useEffect(() => {
    if (editing) return;
    if (project === "") {
      setProjectRoot("");
      setProjectRootReady(true);
      return;
    }
    let live = true;
    void api
      .projectShow(project)
      .then((detail) => {
        if (!live) return;
        setProjectRoot(detail.project.root);
        setProjectRootReady(true);
      })
      .catch(() => {
        if (!live) return;
        setProjectRoot("");
        setProjectRootReady(true);
      });
    return () => {
      live = false;
    };
  }, [editing, project]);

  const noProjects = !editing && projectNames.length === 0;

  // Chưa đủ dữ liệu để biết hình dạng cuối cùng của form — chưa mở Modal. Không chờ thì danh sách
  // service (rỗng lúc đầu, đầy sau khi `api.services()` trả lời) và dòng "Full path" (chờ
  // `projectRoot`) nới chiều cao dialog ra đúng lúc animation mở nó còn đang chạy — dialog đang
  // animate ở một chiều cao, giữa chừng lại cao thêm, và đó chính là chỗ modal "dứt vị trí lên
  // trên" bị báo. `onEntered`/`.settled` (`dialogMotion.ts`) chỉ che được thay đổi *sau khi*
  // animation xong; thay đổi *trong lúc* nó đang chạy thì phải tránh từ gốc, không phải che sau đó.
  // Gọi cục bộ qua IPC nên thường xong trong một khung hình — một khoảng lặng rất ngắn trước khi mở
  // còn tốt hơn một cái giật hình sau khi đã mở.
  if (!listsReady || !projectRootReady) return null;

  async function submit() {
    setSaving(true);
    setError("");
    try {
      if (editing) {
        await api.siteUpdate({ site: { domain: initial.site.domain }, ...siteUpdateFields(draft) });
      } else {
        await api.siteCreate({ project: { name: project }, ...siteCreateFields(draft) });
      }
      onSaved();
    } catch (e) {
      setError(errorMessage(t, e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title={t(editing ? "mixengine.sites.form.editTitle" : "mixengine.sites.form.createTitle")}
      onClose={onCancel}
      locked={saving}
      actions={[
        { kind: "cancel", label: t("common.cancel"), disabled: saving },
        {
          kind: "confirm",
          label: t("common.save"),
          onClick: () => void submit(),
          disabled: !editing && (project === "" || noProjects),
          busy: saving ? t("mixengine.sites.form.saving") : undefined,
        },
      ]}
    >
      {() => (
        <>
          <ModalBody>
            {!editing && (
              <label className={styles.field}>
                {t("mixengine.sites.form.project")}
                {noProjects ? (
                  <p className={styles.hint}>{t("mixengine.sites.form.noProjects")}</p>
                ) : (
                  <Select
                    value={project}
                    onChange={setProject}
                    disabled={saving}
                    options={projectNames.map((name) => ({ value: name, label: name }))}
                    placeholder={t("mixengine.sites.form.project")}
                  />
                )}
              </label>
            )}

            <SiteFields
              value={draft}
              onChange={setDraft}
              serviceIds={serviceIds}
              projectRoot={projectRoot}
              disabled={saving}
              showEnabled={editing}
            />
          </ModalBody>
          <ModalErrors messages={[error]} />
        </>
      )}
    </Modal>
  );
}
