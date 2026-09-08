import { lazy } from "react";

import type { ModuleDefinition } from "../../shell/module";
import { ToolsIcon } from "../../icons";

/* Nạp khi một tab của module này được mở lần đầu, không phải lúc khởi động — cùng lý do với ba
   module kia. Icon và nhãn thì eager: chúng có mặt trên tab strip trước khi có tab nào loại này. */
/** Tools: những tiện ích nhỏ một dev chạm tới trong lúc đang làm việc với DB, API hoặc máy chủ. */
export const toolsModule: ModuleDefinition = {
  id: "tools",
  labelKey: "app.moduleTools",
  Icon: ToolsIcon,
  defaultTitleKey: "toolbox.newTabTitle",
  Tab: lazy(() => import("./ToolsTab")),
};
