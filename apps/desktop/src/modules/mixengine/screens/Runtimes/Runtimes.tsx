import { useEffect, useRef, useState, type CSSProperties } from "react";

import { Tab, TabStrip, tabKeyDown } from "../../../../components/TabStrip";
import { useTranslation } from "../../../../i18n";
import Languages from "./Languages";
import Packages from "./Packages";
import styles from "./Runtimes.module.css";

type TabKey = "languages" | "packages";

/**
 * Một sidebar item, hai tab con — không hai mục sidebar (D5). `runtime.*` và `package.*` cùng hình
 * dạng RPC và cùng hình dạng job, khác đúng namespace gọi và đúng khả năng `force`.
 */
export default function Runtimes({ active }: { active: boolean }) {
  const [tab, setTab] = useState<TabKey>("languages");
  const { t } = useTranslation();

  // Đổi tab không được unmount cái vừa rời đi: một job đang cài ở Ngôn ngữ vẫn phải còn được theo
  // dõi (`installingJob`/`jobs` cục bộ của nó) khi người dùng ghé qua Gói rồi quay lại — xem
  // `MixEngineTab.tsx`, chỗ đã theo cùng luật này cho các màn sidebar.
  const [mountedTabs, setMountedTabs] = useState<TabKey[]>([tab]);
  useEffect(() => {
    setMountedTabs((prev) => (prev.includes(tab) ? prev : [...prev, tab]));
  }, [tab]);

  // Chiều cao thật của dải tab này, đo lại mỗi khi đổi — để dải category bên trong Packages.tsx
  // (cùng `size="small"`, nên cao bằng hệt) biết dính ngay dưới nó, không đè lên. Không đoán một
  // con số cố định: cỡ chữ theo theme người dùng chọn, đoán sai là hai dải chồng lên nhau hoặc hở
  // ra một khe.
  const stripWrapRef = useRef<HTMLDivElement>(null);
  const [stripHeight, setStripHeight] = useState(0);
  useEffect(() => {
    const el = stripWrapRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setStripHeight(entry.contentRect.height));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const tabs: { key: TabKey; label: string }[] = [
    { key: "languages", label: t("mixengine.runtimes.tabLanguages") },
    { key: "packages", label: t("mixengine.runtimes.tabPackages") },
  ];

  return (
    <div
      className={styles.runtimes}
      style={{ "--tabstrip-height": `${stripHeight}px` } as CSSProperties}
    >
      <div ref={stripWrapRef} className={styles.tabStripWrap}>
        <TabStrip size="small" role="tablist">
          {tabs.map((item) => {
            const active = item.key === tab;
            const pick = () => setTab(item.key);
            return (
              <Tab
                key={item.key}
                active={active}
                role="tab"
                aria-selected={active}
                tabIndex={0}
                onClick={pick}
                onKeyDown={tabKeyDown(pick)}
              >
                {item.label}
              </Tab>
            );
          })}
        </TabStrip>
      </div>
      {mountedTabs.includes("languages") && (
        <div className={styles.pane} hidden={tab !== "languages"}>
          <Languages active={active && tab === "languages"} />
        </div>
      )}
      {mountedTabs.includes("packages") && (
        <div className={styles.pane} hidden={tab !== "packages"}>
          <Packages active={active && tab === "packages"} />
        </div>
      )}
    </div>
  );
}
