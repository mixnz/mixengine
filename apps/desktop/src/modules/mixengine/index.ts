import { lazy } from "react";

import { EngineIcon } from "../../icons";
import type { ModuleDefinition } from "../../shell/module";

/* Nạp khi một tab của module này được mở lần đầu, không phải lúc khởi động — cùng lý do với bốn
   module kia. Icon và nhãn thì eager: chúng có mặt trên tab strip trước khi có tab nào loại này. */
/** MixEngine: môi trường web dev cục bộ chạy trên máy này, quản lý từ đây. */
export const mixengineModule: ModuleDefinition = {
  id: "mixengine",
  labelKey: "app.moduleMixEngine",
  Icon: EngineIcon,
  defaultTitleKey: "mixengine.newTabTitle",
  Tab: lazy(() => import("./MixEngineTab")),
};
