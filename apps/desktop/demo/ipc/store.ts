import type { Args, Handlers } from "./dispatch";

/**
 * `@tauri-apps/plugin-store` held in memory: one resource id per file, each file a key/value
 * object copied from the seed so a scene that writes never changes what the next scene reads.
 *
 * Every JSON file a module keeps goes through here — saved connections, saved requests, terminal
 * settings, tool usage. A file nobody seeded is simply empty, which is what a fresh install has.
 */
export function storeHandlers(files: Record<string, Record<string, unknown>>): Handlers {
  const dataByRid = new Map<number, Record<string, unknown>>();
  const ridByPath = new Map<string, number>();
  let nextRid = 1;

  const open = (path: string): number => {
    let rid = ridByPath.get(path);
    if (rid === undefined) {
      rid = nextRid++;
      ridByPath.set(path, rid);
      dataByRid.set(rid, structuredClone(files[path] ?? {}));
    }
    return rid;
  };
  const data = (args: Args): Record<string, unknown> => dataByRid.get(args.rid as number) ?? {};

  return {
    "plugin:store|load": (args) => open(args.path as string),
    "plugin:store|get_store": (args) => ridByPath.get(args.path as string) ?? null,
    "plugin:store|get": (args) => {
      const values = data(args);
      const key = args.key as string;
      return key in values ? [values[key], true] : [null, false];
    },
    "plugin:store|set": (args) => {
      data(args)[args.key as string] = args.value;
      return null;
    },
    "plugin:store|has": (args) => (args.key as string) in data(args),
    "plugin:store|delete": (args) => delete data(args)[args.key as string],
    "plugin:store|keys": (args) => Object.keys(data(args)),
    "plugin:store|values": (args) => Object.values(data(args)),
    "plugin:store|entries": (args) => Object.entries(data(args)),
    "plugin:store|length": (args) => Object.keys(data(args)).length,
    "plugin:store|clear": (args) => {
      const values = data(args);
      for (const key of Object.keys(values)) delete values[key];
      return null;
    },
    "plugin:store|reset": () => null,
    "plugin:store|reload": () => null,
    "plugin:store|save": () => null,
    "plugin:resources|close": () => null,
  };
}
