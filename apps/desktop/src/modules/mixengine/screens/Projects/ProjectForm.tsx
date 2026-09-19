import { useEffect, useRef, useState, type ReactNode } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";

import Button from "../../../../components/Button";
import Input from "../../../../components/Input";
import Modal from "../../../../components/Modal";
import Select from "../../../../components/Select";
import { errorMessage } from "../../../../core/errors";
import { useTranslation } from "../../../../i18n";
import { ChevronRightIcon } from "../../../../icons";
import * as api from "../../api";
import type { ProjectDetail } from "@mixengine/api";
import type { RuntimeKind } from "@mixengine/api";
import type { RuntimeSummary } from "@mixengine/api";
import { installedVersions } from "../../runtimeState";
import SiteFields, { draftDomains, emptySiteDraft, siteCreateFields } from "../../components/SiteFields";
import styles from "./ProjectForm.module.css";

// Every kind the contract knows, in the order the form shows them. `composer` arrived with
// MixEngine's T27c and was the first thing the alias onto `bindings/` caught (phase 11, T102): a
// project pinned to a Composer version would otherwise have lost that pin on its next save here.
// `go` arrived with T27d, before `composer`, in the order the contract's own list keeps; `java`
// arrived with T27e, after `go`.
const RUNTIME_KINDS: readonly RuntimeKind[] = ["php", "node", "python", "ruby", "go", "java", "composer"];

/**
 * Một khối gấp/mở dựng tay — thay cho `<details>` gốc vì hai lý do:
 *
 * **Icon và chuyển động tự chọn được.** `<details>` chỉ có tam giác mặc định của trình duyệt,
 * không đổi được kiểu hay tốc độ. Ở đây một `ChevronRightIcon` xoay 90° khi mở, cùng khuôn với
 * chevron của `Select` (`Select.module.css`).
 *
 * **Chiều cao đổi mượt, không nhảy khựng.** Chiều cao đi từ `0fr` lên `1fr` trên chính
 * `grid-template-rows` — kỹ thuật animate về `auto` không cần đo bằng JS. `<details>` đổi chiều cao
 * tức thì trong một frame, và đó chính là thứ khiến `Modal` không kịp canh lại giữa màn hình (xem
 * `dialogMotion.ts`, `onEntered`) trước khi có phần này.
 */
function Disclosure({
  summary,
  defaultOpen = false,
  children,
}: {
  summary: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={styles.disclosure}>
      <button
        type="button"
        className={styles.disclosureSummary}
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <ChevronRightIcon
          size="1.1em"
          className={`${styles.disclosureChevron} ${open ? styles.disclosureChevronOpen : ""}`}
        />
        {summary}
      </button>
      <div className={`${styles.disclosureBody} ${open ? styles.disclosureBodyOpen : ""}`}>
        <div className={styles.disclosureInner}>{children}</div>
      </div>
    </div>
  );
}

interface Props {
  /** `undefined` = tạo mới. Có giá trị = sửa. */
  initial?: ProjectDetail;
  onCancel: () => void;
  /** Gọi sau khi lưu xong — cha tự `reload()`. `warning` có giá trị khi project đã tạo xong nhưng
   *  site đi kèm (mục "tạo nhanh site") thất bại — project vẫn coi là đã lưu, cha tự vẽ cảnh báo. */
  onSaved: (warning?: string) => void;
}

export default function ProjectForm({ initial, onCancel, onSaved }: Props) {
  const { t } = useTranslation();
  const editing = initial !== undefined;

  const [root, setRoot] = useState(editing ? initial.project.root : "");
  const [name, setName] = useState(editing ? initial.project.name : "");
  const [pins, setPins] = useState<Record<RuntimeKind, string>>(() => {
    const initialPins: Record<RuntimeKind, string> = {
      php: "",
      node: "",
      python: "",
      ruby: "",
      go: "",
      java: "",
      composer: "",
    };
    if (editing) {
      for (const pin of initial.pins) initialPins[pin.kind] = pin.constraint;
    }
    return initialPins;
  });

  // "Tạo nhanh site" — chỉ hiện lúc tạo project mới (xem JSX). Bỏ trống domains là bỏ qua hẳn bước
  // này, không phải một site rỗng gửi lên daemon.
  // Root của site này luôn là `root` (field ngay phía trên) — cùng project, biết ngay từ đầu, không
  // cần đọc lại như `SiteForm` phải làm khi project là một lựa chọn tách rời.
  const [siteDraft, setSiteDraft] = useState(emptySiteDraft);
  const [serviceIds, setServiceIds] = useState<string[]>([]);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [installed, setInstalled] = useState<RuntimeSummary[]>([]);
  const actionsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (editing) return;
    void api.services().then((list) => setServiceIds(list.services.map((s) => s.id)));
  }, [editing]);

  /**
   * Các bản đã cài, để mỗi ô pin gợi ý được thay vì bắt gõ thuộc lòng.
   *
   * **Đã cài, không phải tải được** — một constraint chỉ bao giờ được resolve trên những bản có
   * trên máy này (`VersionConstraint`), nên gợi ý một bản chưa cài là mời người dùng ghim vào thứ
   * sẽ không resolve nổi.
   *
   * Hỏng thì bỏ qua: ô pin vẫn gõ tay được như trước, và một dialog tạo project không nên chết vì
   * danh sách gợi ý không đọc được.
   */
  useEffect(() => {
    let live = true;
    void api
      .runtimesInstalled()
      .then((list) => live && setInstalled(list.runtimes))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  // Dialog dài (khối "tạo nhanh site" mở ra) cuộn được, và nút Lưu nằm ở cuối — lỗi vẽ ra ngay
  // phía trên nút đó, đúng chỗ người dùng đang nhìn lúc bấm, nhưng chèn thêm nội dung vào giữa
  // trang không tự kéo trình duyệt theo. Cuộn theo `.actions` (không phải chính khối lỗi) với
  // `block: "end"` — cuộn theo khối lỗi sẽ đẩy đúng hai nút Cancel/Save ra ngoài tầm nhìn phía dưới,
  // vì `block: "end"` canh *đáy* của phần tử được nhắm vào đáy khung nhìn; nhắm vào `.actions` (phần
  // tử cuối cùng) cho cả lỗi lẫn hai nút cùng lọt vào khung một lượt.
  useEffect(() => {
    if (error !== "") actionsRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [error]);

  async function browseRoot() {
    const picked = await openDialog({ directory: true, multiple: false });
    if (typeof picked === "string") setRoot(picked);
  }

  function pinsPayload(): Partial<Record<RuntimeKind, string>> | undefined {
    const entries = RUNTIME_KINDS.filter((kind) => pins[kind].trim() !== "").map((kind) => [
      kind,
      pins[kind].trim(),
    ]);
    return entries.length > 0 ? Object.fromEntries(entries) : undefined;
  }

  const siteDomains = draftDomains(siteDraft);

  async function submit() {
    setSaving(true);
    setError("");
    try {
      if (editing) {
        await api.projectUpdate({
          project: { name: initial.project.name },
          name: name !== initial.project.name ? name : undefined,
          root: root !== initial.project.root ? root : undefined,
          // No `keep_warm`: absent leaves the column as it is. The form no longer shows it — it
          // only matters while Save battery is on, and `mix project keep-warm` sets it (T167g).
          pins: pinsPayload() ?? {},
        });
        onSaved();
        return;
      }

      const created = await api.projectCreate({
        root,
        name: name.trim() === "" ? undefined : name,
        pins: pinsPayload(),
      });
      if (siteDomains.length > 0) {
        try {
          await api.siteCreate({ project: { name: created.project.name }, ...siteCreateFields(siteDraft) });
        } catch (e) {
          // Project đã lưu xong — đây là một cảnh báo về riêng cái site, không phải một lần lưu
          // thất bại. Đóng dialog vẫn đúng: mở lại nó chỉ để gõ lại y hệt phần project sẽ đụng
          // ngay lỗi "tên đã tồn tại", vì `project.create` vừa chạy xong thật.
          onSaved(t("mixengine.projects.form.siteFailed", { error: errorMessage(t, e) }));
          return;
        }
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
      label={t(editing ? "mixengine.projects.form.editTitle" : "mixengine.projects.form.createTitle")}
      onClose={onCancel}
      locked={saving}
      overlayClassName={styles.overlay}
      className={styles.dialog}
    >
      {(close) => (
        <>
          <h3 className={styles.title}>
            {t(editing ? "mixengine.projects.form.editTitle" : "mixengine.projects.form.createTitle")}
          </h3>

          <div className={styles.form}>
            <label className={styles.field}>
              {t("mixengine.projects.form.root")}
              <div className={styles.rootRow}>
                <Input value={root} disabled={saving} onChange={(e) => setRoot(e.target.value)} />
                <Button onClick={() => void browseRoot()} disabled={saving}>
                  {t("common.browse")}
                </Button>
              </div>
              {editing && <p className={styles.hint}>{t("mixengine.projects.form.rootMovedHint")}</p>}
            </label>

            <label className={styles.field}>
              {t("mixengine.projects.form.name")}
              <Input
                value={name}
                disabled={saving}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("mixengine.projects.form.namePlaceholder")}
              />
            </label>

            <Disclosure summary={t("mixengine.projects.form.pinsSummary")}>
              {/* `freeText` chứ không phải một Select thường: giá trị ở đây là một
                  `VersionConstraint`, và danh sách chỉ là các bản đã cài — `^8.3` hay `8.3` không
                  nằm trong đó nhưng vẫn phải ghim được. */}
              {RUNTIME_KINDS.map((kind) => (
                <label key={kind} className={styles.field}>
                  {kind}
                  <Select
                    value={pins[kind]}
                    freeText
                    disabled={saving}
                    placeholder={t("mixengine.projects.form.pinAny")}
                    searchPlaceholder={t("mixengine.projects.form.pinPlaceholder")}
                    onChange={(value) => setPins((prev) => ({ ...prev, [kind]: value }))}
                    options={[
                      { value: "", label: t("mixengine.projects.form.pinAny") },
                      ...installedVersions(installed, kind).map((version) => ({
                        value: version,
                        label: version,
                      })),
                    ]}
                  />
                </label>
              ))}
            </Disclosure>

            {/* Chỉ ở form tạo mới — sửa một project đã có không phải lúc để gộp thêm một site,
                site của nó (nếu có) đã sửa được riêng ở màn Sites. */}
            {!editing && (
              <Disclosure summary={t("mixengine.projects.form.quickSiteSummary")}>
                <SiteFields
                  value={siteDraft}
                  onChange={setSiteDraft}
                  serviceIds={serviceIds}
                  projectRoot={root}
                  disabled={saving}
                />
              </Disclosure>
            )}
          </div>

          {error !== "" && (
            <div className={styles.errors} role="alert">
              <p>{error}</p>
            </div>
          )}

          <div ref={actionsRef} className={styles.actions}>
            <Button size="large" onClick={() => close(onCancel)} disabled={saving}>
              {t("common.cancel")}
            </Button>
            <Button
              size="large"
              variant="primary"
              onClick={() => void submit()}
              disabled={saving || root.trim() === ""}
            >
              {saving ? t("mixengine.projects.form.saving") : t("common.save")}
            </Button>
          </div>
        </>
      )}
    </Modal>
  );
}
