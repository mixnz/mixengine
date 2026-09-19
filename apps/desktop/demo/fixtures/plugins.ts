import pkg from "../../package.json";
import { returns, type Handlers } from "../ipc/dispatch";

/** The shell's own commands and the plugins every screen may touch, answered neutrally. */
export const pluginHandlers: Handlers = {
  "plugin:app|version": returns(pkg.version),
  "plugin:app|name": returns("MixLab"),
  // Error-level calls are recorded by the dispatcher before this answers.
  "plugin:log|log": returns(null),
  "plugin:opener|open_url": returns(null),
  "plugin:opener|open_path": returns(null),
  "plugin:dialog|open": returns(null),
  "plugin:dialog|save": returns(null),
  "plugin:clipboard-manager|write_text": returns(null),
  "plugin:clipboard-manager|read_text": returns(""),
  "plugin:path|resolve_directory": returns("/Users/ada/Library/Application Support/MixLab"),
  launch_take_requests: returns([]),
  import_happened: returns(false),
  // Every window asks for the tray icon on start (T168); a picture has no tray to put one in.
  tray_configure: returns(null),
};
