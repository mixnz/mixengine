import { storeHandlers } from "../ipc/store";
import type { Handlers } from "../ipc/dispatch";
import { dbFiles, dbHandlers } from "./db";
import { mixengineHandlers } from "./mixengine";
import { pluginHandlers } from "./plugins";

/** Every scene gets every fixture: a scene is a session, not a different set of answers. */
export const handlers: Handlers = {
  ...pluginHandlers,
  ...mixengineHandlers,
  ...dbHandlers,
  ...storeHandlers({ ...dbFiles }),
};
