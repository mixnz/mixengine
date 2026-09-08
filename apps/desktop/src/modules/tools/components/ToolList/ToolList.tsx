import { useTranslation, type TranslationKey } from "../../../../i18n";
import { CloseIcon } from "../../../../icons";
import { TOOL_GROUPS, type ToolDefinition, type ToolGroup } from "../../tool";
import styles from "./ToolList.module.css";

const GROUP_LABEL: Record<ToolGroup, TranslationKey> = {
  data: "toolbox.groupData",
  encode: "toolbox.groupEncode",
  time: "toolbox.groupTime",
  infra: "toolbox.groupInfra",
  text: "toolbox.groupText",
};

interface ToolListProps {
  tools: ToolDefinition[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** What the search box above holds — filters tools by their (translated) label. Empty means
   *  every tool, same as before this existed. */
  query?: string;
  /** "Frequently used" order, most-used first — owned by the caller so it stays fixed for the tab's
   *  lifetime instead of resorting on every pick. See `ToolsTab`. */
  frequentIds: string[];
  /** Drops a tool from the "Frequently used" group. */
  onRemoveFrequent: (id: string) => void;
}

/**
 * Danh sách tool có nhóm.
 *
 * Riêng của module thay vì `components/ItemList`: cái kia nhận một mảng chuỗi phẳng và gánh cả
 * tìm kiếm, ghim và menu chuột phải — thứ một danh sách cố định gồm mười mấy nhãn ta tự viết
 * không cần, và nống nó ra cho đúng một người dùng thì hại nhiều hơn lợi. Việc lọc theo `query` thì
 * vẫn cần — chỉ là nhỏ đến mức viết thẳng ở đây rẻ hơn kéo `ItemList` vào.
 */
function ToolList({
  tools,
  selectedId,
  onSelect,
  query = "",
  frequentIds,
  onRemoveFrequent,
}: ToolListProps) {
  const { t } = useTranslation();
  if (tools.length === 0) return <p className={styles.empty}>{t("toolbox.empty")}</p>;

  const needle = query.trim().toLowerCase();
  const matches = needle
    ? tools.filter((tool) => t(tool.labelKey).toLowerCase().includes(needle))
    : tools;
  if (matches.length === 0) return <p className={styles.empty}>{t("toolbox.noMatch")}</p>;

  // Order comes from the caller as-is — filtered through `matches` so a search that excludes a
  // frequent tool excludes it here too, same as everywhere else in this list.
  const frequentTools = frequentIds
    .map((id) => matches.find((tool) => tool.id === id))
    .filter((tool): tool is ToolDefinition => tool !== undefined);

  return (
    <nav className={styles.list} aria-label={t("toolbox.list")}>
      {frequentTools.length > 0 && (
        <section className={styles.group}>
          <h2 className={styles.groupTitle}>{t("toolbox.groupFrequent")}</h2>
          {frequentTools.map((tool) => (
            <div key={`frequent-${tool.id}`} className={styles.frequentRow}>
              <button
                type="button"
                className={tool.id === selectedId ? `${styles.item} ${styles.selected}` : styles.item}
                aria-current={tool.id === selectedId ? "true" : undefined}
                onClick={() => onSelect(tool.id)}
              >
                {t(tool.labelKey)}
              </button>
              <button
                type="button"
                className={styles.frequentRemove}
                title={t("toolbox.removeFrequent")}
                aria-label={t("toolbox.removeFrequent")}
                onClick={() => onRemoveFrequent(tool.id)}
              >
                <CloseIcon size="0.85em" />
              </button>
            </div>
          ))}
        </section>
      )}
      {TOOL_GROUPS.map((group) => {
        const inGroup = matches.filter((tool) => tool.group === group);
        if (inGroup.length === 0) return null;
        return (
          <section key={group} className={styles.group}>
            <h2 className={styles.groupTitle}>{t(GROUP_LABEL[group])}</h2>
            {inGroup.map((tool) => (
              <button
                key={tool.id}
                type="button"
                className={tool.id === selectedId ? `${styles.item} ${styles.selected}` : styles.item}
                aria-current={tool.id === selectedId ? "true" : undefined}
                onClick={() => onSelect(tool.id)}
              >
                {t(tool.labelKey)}
              </button>
            ))}
          </section>
        );
      })}
    </nav>
  );
}

export default ToolList;
