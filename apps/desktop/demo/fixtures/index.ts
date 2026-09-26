import { storeHandlers } from "../ipc/store";
import type { Handlers } from "../ipc/dispatch";
import { dbFiles, dbHandlers } from "./db";
import { mixengineHandlers } from "./mixengine";
import { pluginHandlers } from "./plugins";
import { restFiles, restHandlers } from "./rest";
import { syncHandlers } from "./sync";
import { terminalFiles, terminalHandlers } from "./terminal";
import { updateHandlers } from "./update";

/** Every scene gets every fixture: a scene is a session, not a different set of answers. */
export const handlers: Handlers = {
  ...pluginHandlers,
  ...mixengineHandlers,
  ...dbHandlers,
  ...restHandlers,
  ...terminalHandlers,
  ...syncHandlers,
  ...updateHandlers,
  ...storeHandlers({ ...dbFiles, ...restFiles, ...terminalFiles }),
};
