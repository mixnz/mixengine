import { useEffect, useState } from "react";

import { Tab, TabStrip, tabKeyDown } from "../../../../components/TabStrip";
import { useTranslation } from "../../../../i18n";
import Languages from "./Languages";
import Packages from "./Packages";
import { PACKAGE_CATEGORY_ORDER, packageCategory, type PackageCategory } from "./packageCategories";
import { usePackages } from "./usePackages";
import styles from "./Runtimes.module.css";

type TabKey = "languages" | PackageCategory;

/**
 * Một sidebar item, một dải tab — không hai mục sidebar (D5), và không hai tầng tab: Ngôn ngữ
 * đứng ngang hàng với từng nhóm package, không phải ngang hàng với một tab "Phần mềm" còn phải
 * mở ra mới thấy nhóm. `runtime.*` và `package.*` cùng hình dạng RPC và cùng hình dạng job, khác
 * đúng namespace gọi và đúng khả năng `force`.
 */
export default function Runtimes({ active }: { active: boolean }) {
  const [tab, setTab] = useState<TabKey>("languages");
  const { t } = useTranslation();

  // State của `package.*` sống ở đây, không trong từng nhóm — xem `usePackages`. Đọc kể cả khi
  // đang ở tab Ngôn ngữ: dải tab dưới đây cần biết có package nào rơi vào nhóm "Khác" không.
  const packages = usePackages(active);

  // Đổi tab không được unmount Ngôn ngữ: một job đang cài ở đó vẫn phải còn được theo dõi
  // (`installingJob`/`jobs` cục bộ của nó) khi người dùng ghé qua một nhóm package rồi quay lại —
  // xem `MixEngineTab.tsx`, chỗ đã theo cùng luật này cho các màn sidebar. Các nhóm package thì
  // không cần giữ mount: state của chúng đã ở `usePackages`, cao hơn tab.
  const [languagesMounted, setLanguagesMounted] = useState(tab === "languages");
  useEffect(() => {
    if (tab === "languages") setLanguagesMounted(true);
  }, [tab]);

  // Ba nhóm đầu luôn có mặt — vị trí một tab không được nhảy chỉ vì người dùng vừa gỡ bản cuối
  // cùng trong nhóm đó. "Khác" thì ngược lại: nó không phải một nhóm người dùng nhận ra, chỉ là
  // chốt cho package registry mới hơn bản đang chạy (xem `packageCategories.ts`), nên chỉ vẽ khi
  // thật sự có gì rơi vào đó.
  const hasOther =
    packages.installed.some((row) => packageCategory(row.package) === "other") ||
    packages.available.some((release) => packageCategory(release.package) === "other");
  const categoryTabs = PACKAGE_CATEGORY_ORDER.filter((cat) => cat !== "other" || hasOther);

  // Package "Khác" cuối cùng vừa biến mất trong lúc đang đứng ở tab đó: quay về Ngôn ngữ thay vì
  // giữ một tab không còn trên dải.
  useEffect(() => {
    if (tab === "other" && !hasOther) setTab("languages");
  }, [tab, hasOther]);

  const categoryLabel: Record<PackageCategory, string> = {
    web: t("mixengine.runtimes.categoryWeb"),
    database: t("mixengine.runtimes.categoryDatabase"),
    cache: t("mixengine.runtimes.categoryCache"),
    other: t("mixengine.runtimes.categoryOther"),
  };

  const tabs: { key: TabKey; label: string }[] = [
    { key: "languages", label: t("mixengine.runtimes.tabLanguages") },
    ...categoryTabs.map((cat) => ({ key: cat as TabKey, label: categoryLabel[cat] })),
  ];

  return (
    <div className={styles.runtimes}>
      <div className={styles.tabStripWrap}>
        <TabStrip size="small" role="tablist">
          {tabs.map((item) => {
            const selected = item.key === tab;
            const pick = () => setTab(item.key);
            return (
              <Tab
                key={item.key}
                active={selected}
                role="tab"
                aria-selected={selected}
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
      {languagesMounted && (
        <div className={styles.pane} hidden={tab !== "languages"}>
          <Languages active={active && tab === "languages"} />
        </div>
      )}
      {tab !== "languages" && (
        // `key` gắn theo nhóm: ô tìm của `Packages` là state cục bộ, và một câu tìm gõ cho Máy chủ
        // web không được đi theo sang Cơ sở dữ liệu.
        <div className={styles.pane}>
          <Packages key={tab} category={tab} state={packages} />
        </div>
      )}
    </div>
  );
}
