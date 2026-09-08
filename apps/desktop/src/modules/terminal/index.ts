import { lazy } from "react";

import type { ModuleDefinition } from "../../shell/module";
import { TerminalIcon } from "../../icons";
import TerminalSettings from "./components/TerminalSettings";
import { TERMINAL_SHORTCUTS } from "./shortcuts";

/* Loaded when a tab of this module is first opened, not at launch. The workspace behind it is the
   heaviest thing in the bundle — CodeMirror here, xterm in the terminal — and a launch that parses
   all three to show one is paying for two nobody asked for. Everything else in this file stays
   eager: the icon and the label are on the tab strip before any tab of this kind exists. */
/** Terminal: một phiên shell trên máy này, hoặc — từ đợt 2 — trên một máy chủ qua SSH. */
export const terminalModule: ModuleDefinition = {
  id: "terminal",
  labelKey: "app.moduleTerminal",
  Icon: TerminalIcon,
  defaultTitleKey: "terminal.newTabTitle",
  Tab: lazy(() => import("./TerminalTab")),
  settings: { labelKey: "terminal.settingsTitle", Icon: TerminalIcon, Section: TerminalSettings },
  shortcuts: TERMINAL_SHORTCUTS,
};
