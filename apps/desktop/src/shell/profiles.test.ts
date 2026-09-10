import { describe, expect, it } from "vitest";
import { MODULES, MODULE_PRESETS } from "./registry";
import {
  MODULES_STORAGE_KEY,
  defaultModuleId,
  normalizeModules,
  presetOf,
  resolveStoredModules,
  visibleModules,
  type ShellStorage,
} from "./profiles";

const KNOWN = MODULES.map((m) => m.id);

/** A `localStorage` with nothing in it but what a test put there. */
function storageOf(entries: Record<string, string>): ShellStorage {
  const map = new Map(Object.entries(entries));
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
  };
}

describe("normalizeModules", () => {
  it("keeps a set this build knows, as it was given", () => {
    expect(normalizeModules(["db", "mixengine"], KNOWN)).toEqual(["db", "mixengine"]);
  });

  it("drops an id this build does not have", () => {
    expect(normalizeModules(["db", "gopher"], KNOWN)).toEqual(["db"]);
  });

  it("collapses a repeated id", () => {
    expect(normalizeModules(["db", "db"], KNOWN)).toEqual(["db"]);
  });

  /* A window with no modules in it is not a window. Empty is the same answer as unreadable, so the
     caller has one branch to write and one to test. */
  it("answers null for anything that leaves nothing to draw", () => {
    expect(normalizeModules([], KNOWN)).toBeNull();
    expect(normalizeModules(["gopher"], KNOWN)).toBeNull();
    expect(normalizeModules(null, KNOWN)).toBeNull();
    expect(normalizeModules("db", KNOWN)).toBeNull();
    expect(normalizeModules({ db: true }, KNOWN)).toBeNull();
    expect(normalizeModules([1, 2], KNOWN)).toBeNull();
  });
});

describe("presetOf", () => {
  it("recognises each preset from its set, whatever order it arrives in", () => {
    expect(presetOf(MODULE_PRESETS.mixengine)).toBe("mixengine");
    expect(presetOf([...MODULE_PRESETS.everything].reverse())).toBe("everything");
    expect(presetOf([...MODULE_PRESETS.databaseTools].reverse())).toBe("databaseTools");
  });

  it("answers null for a set of someone's own", () => {
    expect(presetOf(["mixengine", "terminal"])).toBeNull();
  });
});

describe("visibleModules", () => {
  it("draws in the registry's order, not the order it was handed", () => {
    const ids = visibleModules(["tools", "mixengine", "db"]).map((m) => m.id);
    expect(ids).toEqual(MODULES.filter((m) => ids.includes(m.id)).map((m) => m.id));
    expect(ids[0]).toBe("mixengine");
  });

  it("ignores an id this build does not have", () => {
    expect(visibleModules(["mixengine", "gopher"]).map((m) => m.id)).toEqual(["mixengine"]);
  });
});

/* Named per preset rather than positional, on purpose: with T109 the default is implicit in the
   registry's order, and a module inserted at the head of `MODULES` would move it silently. These
   three cases are what say so out loud. */
describe("defaultModuleId", () => {
  it("opens MixEngine for the profiles that lead with it", () => {
    expect(defaultModuleId(visibleModules(MODULE_PRESETS.mixengine))).toBe("mixengine");
    expect(defaultModuleId(visibleModules(MODULE_PRESETS.everything))).toBe("mixengine");
  });

  it("opens the database client for the toolbox profile", () => {
    expect(defaultModuleId(visibleModules(MODULE_PRESETS.databaseTools))).toBe("db");
  });

  /* The *first* visible module, not merely a visible one — `visibleModules` has already put the
     set into the registry's order by the time this sees it. */
  it("takes the first module the registry lists, whatever order the set arrived in", () => {
    expect(defaultModuleId(visibleModules(["terminal", "db"]))).toBe("db");
  });
});

/* The three questions of D3, in order. Only the fourth answer — "ask" — costs an IPC call, and it
   is the only one this cannot decide here; `null` is what it answers instead. */
describe("resolveStoredModules", () => {
  it("uses a stored set when there is one", () => {
    const storage = storageOf({ [MODULES_STORAGE_KEY]: JSON.stringify(["mixengine", "db"]) });
    expect(resolveStoredModules(storage, KNOWN)).toEqual(["mixengine", "db"]);
  });

  /* The window this task is most able to hurt: a MixLab install from before T108. It has a theme
     and a session and four modules' worth of saved work, and no `mixdb-modules` — and handing it
     the MixEngine preset would make its database tabs disappear on an upgrade. */
  it("gives a window that predates this setting everything", () => {
    for (const key of ["mixdb-session", "mixdb-theme", "mixdb-accent", "mixdb-glass", "mixdb-lang"]) {
      expect(resolveStoredModules(storageOf({ [key]: "x" }), KNOWN)).toEqual(
        MODULE_PRESETS.everything,
      );
    }
  });

  it("treats an unusable stored value as no setting at all", () => {
    expect(resolveStoredModules(storageOf({ [MODULES_STORAGE_KEY]: "{" }), KNOWN)).toBeNull();
    expect(resolveStoredModules(storageOf({ [MODULES_STORAGE_KEY]: "[]" }), KNOWN)).toBeNull();
    expect(
      resolveStoredModules(storageOf({ [MODULES_STORAGE_KEY]: JSON.stringify(["gopher"]) }), KNOWN),
    ).toBeNull();
  });

  it("has nothing to go on in a profile that has never been used", () => {
    expect(resolveStoredModules(storageOf({}), KNOWN)).toBeNull();
  });

  /* An unusable value in a profile that has been used still lands on Everything: the two questions
     are asked in order, and the second one does not care why the first had no answer. */
  it("still answers everything when an unusable value sits beside a used profile", () => {
    const storage = storageOf({ [MODULES_STORAGE_KEY]: "{", "mixdb-session": "x" });
    expect(resolveStoredModules(storage, KNOWN)).toEqual(MODULE_PRESETS.everything);
  });
});
