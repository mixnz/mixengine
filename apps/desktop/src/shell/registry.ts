import type { ModuleDefinition } from "./module";
import { dbModule } from "../modules/db";
import { mixengineModule } from "../modules/mixengine";
import { restModule } from "../modules/rest";
import { terminalModule } from "../modules/terminal";
import { toolsModule } from "../modules/tools";

/** Every module the app can open a tab of. Adding one is a line here — and this is the only file
 *  outside `src/modules/` that names any of them. */
export const MODULES: ModuleDefinition[] = [
  dbModule,
  restModule,
  terminalModule,
  toolsModule,
  mixengineModule,
];

/** What `Ctrl+T`, and a plain click on `[+]`, opens. */
export const DEFAULT_MODULE_ID = "db";

export function moduleById(id: string): ModuleDefinition {
  const found = MODULES.find((m) => m.id === id);
  // A tab's `moduleId` only ever comes from this list, so a miss is a programming error rather than
  // something to put in front of the user.
  if (!found) throw new Error(`Unknown module: ${id}`);
  return found;
}
