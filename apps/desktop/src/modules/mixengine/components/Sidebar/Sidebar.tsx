import { useTranslation, type TranslationKey } from "../../../../i18n";
import type { MixEngineScreen } from "../../tabState";
import styles from "./Sidebar.module.css";

/**
 * Chín mục cố định của `client-surface.md`, cộng hai mục MixDB tự thêm (`projects`, `metrics`).
 *
 * **`projects` không nằm trong 9 màn hình `client-surface.md` liệt kê.** `client-surface.md` không
 * dựng Projects thành một màn hình riêng — nó giả định một client hỏi `project.list` cho đúng một
 * dropdown. MixDB dựng hẳn một màn hình quản lý vì `project.*` đã có đủ method
 * (`list, create, show, update, delete, export`) cho một màn hình đầy đủ, và vì Sites (mục ngay sau)
 * không dùng được nếu chưa có project nào — xem Quyết định D4,
 * `docs/superpowers/specs/2026-09-06-mixengine-runtimes-services-logs-design.md`. Đặt ngay sau
 * Dashboard vì nó là thứ Sites cần trước.
 *
 * **`metrics` cũng không nằm trong 9 màn hình đó** — `client-surface.md` gộp CPU%/RSS "bây giờ" vào
 * Dashboard, không đòi một màn riêng. MixDB tách lịch sử 24 giờ ra một mục sidebar của riêng nó (D1,
 * `docs/superpowers/specs/2026-09-07-mixengine-metrics-settings-design.md`) vì đây là dữ liệu khác
 * hình dạng (biểu đồ theo thời gian, không phải một hàng trong bảng service).
 *
 * **Không còn mục nào xám.** Cả 11 mục đều dựng được — riêng bên trong Settings, hàng "default web
 * server" vẫn để trống có chú thích (T97 chưa lên bản release nào), cùng lý do cả mục Settings từng
 * để xám trước khi màn hình này tồn tại.
 */
const ITEMS: readonly { screen: MixEngineScreen; labelKey: TranslationKey }[] = [
  { screen: "dashboard", labelKey: "mixengine.sidebar.dashboard" },
  { screen: "projects", labelKey: "mixengine.sidebar.projects" },
  { screen: "sites", labelKey: "mixengine.sidebar.sites" },
  { screen: "domains", labelKey: "mixengine.sidebar.domains" },
  { screen: "runtimes", labelKey: "mixengine.sidebar.runtimes" },
  { screen: "servicesDetail", labelKey: "mixengine.sidebar.servicesDetail" },
  { screen: "logs", labelKey: "mixengine.sidebar.logs" },
  { screen: "blueprints", labelKey: "mixengine.sidebar.blueprints" },
  { screen: "extensions", labelKey: "mixengine.sidebar.extensions" },
  { screen: "metrics", labelKey: "mixengine.sidebar.metrics" },
  { screen: "settings", labelKey: "mixengine.sidebar.settings" },
];

export default function Sidebar({
  screen,
  onSelect,
}: {
  screen: MixEngineScreen;
  onSelect: (screen: MixEngineScreen) => void;
}) {
  const { t } = useTranslation();

  return (
    <nav className={styles.sidebar} aria-label={t("mixengine.sidebar.label")}>
      {ITEMS.map((item) => (
        <button
          key={item.labelKey}
          type="button"
          className={styles.item}
          aria-current={item.screen === screen ? "page" : undefined}
          onClick={() => onSelect(item.screen)}
        >
          {t(item.labelKey)}
        </button>
      ))}
    </nav>
  );
}
