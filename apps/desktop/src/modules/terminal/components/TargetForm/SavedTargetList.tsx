import { useState } from "react";
import ConfirmDialog from "../../../../components/ConfirmDialog";
import ContextMenu from "../../../../components/ContextMenu";
import { GlobeIcon } from "../../../../icons";
import { useTranslation } from "../../../../i18n";
import { ShellIcon } from "../../icons";
import { shellLabel } from "../../shells";
import type { SavedTarget } from "../../types";
import styles from "./SavedTargetList.module.css";

interface Props {
  targets: SavedTarget[];
  /** Đích đang được nạp trong form, để tô đúng dòng. */
  selectedId: string | null;
  onSelect: (target: SavedTarget) => void;
  /** Nháy đúp: nạp đích *và* mở luôn phiên. Một chỗ hay dùng thì mọi ô trong form đã đúng sẵn, nên
   *  bắt người ta nạp rồi mới bấm Kết nối là bắt bấm hai lần cho một ý định. */
  onOpen: (target: SavedTarget) => void;
  onDelete: (id: string) => void;
  /** Bỏ form về trắng — hành động trên danh sách, không phải trên một dòng nào của nó, nên nó nằm
   *  ở đầu cột chứ không trong menu của một dòng. */
  onNew: () => void;
}

/** Menu mở ở đâu, và mở trên đích nào. */
interface MenuState {
  target: SavedTarget;
  x: number;
  y: number;
}

/** Dòng phụ dưới tên: đủ để phân biệt hai mục trùng tên, không dài hơn thế. */
function subtitle(target: SavedTarget): string {
  if (target.kind === "ssh") return `${target.config.username}@${target.config.host}`;
  const label = shellLabel(target.shellName);
  return target.cwd ? `${label} · ${target.cwd}` : label;
}

/**
 * Cột đích đã lưu — cả shell trên máy này lẫn máy chủ SSH, trộn chung một danh sách.
 *
 * Trộn chung vì cột này là *những chỗ tôi hay mở*, không phải danh sách máy chủ: nó vẫn hiện khi
 * form đang ở "Máy này", và nó vẫn hiện như thế từ trước khi có nhánh local. Cái phân biệt hai loại
 * là dấu hiệu đầu dòng cộng dòng phụ, chứ không phải hai nhóm có tiêu đề riêng — với năm bảy mục
 * thì hai tiêu đề tốn nhiều chỗ hơn phần chúng nói được.
 *
 * Tự vẽ chứ không dùng `ItemList`: cái đó nói lại bằng tên, mà hai mục trùng tên — chuyện thường
 * với "prod" — thì không phân biệt được. Danh sách này đi theo `id`.
 */
function SavedTargetList({ targets, selectedId, onSelect, onOpen, onDelete, onNew }: Props) {
  const { t } = useTranslation();
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [confirming, setConfirming] = useState<SavedTarget | null>(null);

  return (
    <aside className={styles.list}>
      <div className={styles.header}>
        <h3>{t("terminal.savedTargets")}</h3>
        <button type="button" className={styles.new} onClick={onNew} title={t("terminal.newTarget")}>
          +<span className="visually-hidden">{t("terminal.newTarget")}</span>
        </button>
      </div>

      {targets.length === 0 ? (
        <p className={styles.empty}>{t("terminal.noTargets")}</p>
      ) : (
        <ul>
          {targets.map((target) => (
            <li key={target.id}>
              <button
                type="button"
                className={`${styles.item}${target.id === selectedId ? ` ${styles.itemActive}` : ""}`}
                onClick={() => onSelect(target)}
                onDoubleClick={() => onOpen(target)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setMenu({ target, x: e.clientX, y: e.clientY });
                }}
              >
                <span className={styles.title}>
                  {/* Logo của shell cho máy này; quả địa cầu cho SSH, vì cái nó nói là "ở chỗ khác
                      trên mạng" chứ không phải "một terminal" — cả hai dòng đều là terminal. */}
                  {target.kind === "local" ? (
                    <ShellIcon name={target.shellName} className={styles.mark} />
                  ) : (
                    <GlobeIcon size="1em" className={styles.mark} />
                  )}
                  <strong>{target.name}</strong>
                </span>
                <span className={styles.endpoint}>{subtitle(target)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {menu && (
        <ContextMenu x={menu.x} y={menu.y} onClose={() => setMenu(null)}>
          <button
            type="button"
            onClick={() => {
              setConfirming(menu.target);
              setMenu(null);
            }}
          >
            {t("terminal.deleteTarget")}
          </button>
        </ContextMenu>
      )}

      {confirming && (
        <ConfirmDialog
          title={t("terminal.deleteTargetTitle")}
          /* Chỉ máy chủ mới có gì trong kho thông tin đăng nhập để mất, nên chỉ nó mới nói câu ấy —
             hứa xoá mật khẩu của một shell trên máy này là hứa một việc không có thật. */
          message={
            confirming.kind === "ssh"
              ? t("terminal.deleteTargetMessageSsh", { name: confirming.name })
              : t("terminal.deleteTargetMessage", { name: confirming.name })
          }
          confirmLabel={t("terminal.deleteTarget")}
          danger
          onConfirm={() => {
            onDelete(confirming.id);
            setConfirming(null);
          }}
          onCancel={() => setConfirming(null)}
        />
      )}
    </aside>
  );
}

export default SavedTargetList;
