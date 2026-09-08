import { lazy } from "react";

import type { ModuleDefinition } from "../../shell/module";
import { GlobeIcon } from "../../icons";
import RestSettings from "./components/RestSettings";
import { REST_SHORTCUTS } from "./shortcuts";

/* Loaded when a tab of this module is first opened, not at launch. The workspace behind it is the
   heaviest thing in the bundle — CodeMirror here, xterm in the terminal — and a launch that parses
   all three to show one is paying for two nobody asked for. Everything else in this file stays
   eager: the icon and the label are on the tab strip before any tab of this kind exists. */
/** REST client: composing an HTTP request, sending it, and reading what came back. */
export const restModule: ModuleDefinition = {
  id: "rest",
  labelKey: "app.moduleRest",
  Icon: GlobeIcon,
  /* The same key the [+] menu is drawn from, because a REST tab is called REST for as long as
     it is open: there is no "before the module names it" here to have a second word for. */
  defaultTitleKey: "app.moduleRest",
  Tab: lazy(() => import("./RestTab")),
  settings: { labelKey: "rest.settingsTitle", Icon: GlobeIcon, Section: RestSettings },
  shortcuts: REST_SHORTCUTS,
};
