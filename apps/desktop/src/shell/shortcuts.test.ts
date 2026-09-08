import { describe, expect, it } from "vitest";
import { decide, type Press } from "../core/shortcuts";
import { ALL_SHORTCUTS, MODULE_TAB_SHORTCUTS, newModuleTabId } from "./shortcuts";
import { MODULES } from "./registry";

/* The number keys are derived from the registry, so what is worth pinning down is the derivation:
   which module each key opens, and that the catalogue the table and the dispatcher read carries
   every one of them. `App.tsx` registers its handlers from the same list, which is why nothing here
   has to reach into React to check they agree. */
describe("MODULE_TAB_SHORTCUTS", () => {
  it("gives the modules 1, 2, 3… in the order the registry lists them", () => {
    expect(MODULE_TAB_SHORTCUTS.map((entry) => [entry.def.chord.key, entry.moduleId])).toEqual(
      MODULES.map((module, i) => [String(i + 1), module.id]),
    );
  });

  it("names each chord after the module it opens, and the module after itself", () => {
    for (const { moduleId, def } of MODULE_TAB_SHORTCUTS) {
      expect(def.id).toBe(newModuleTabId(moduleId));
      expect(def.labelVars?.module).toBe(MODULES.find((m) => m.id === moduleId)?.labelKey);
    }
  });

  it("is on the catalogue the dispatcher resolves against", () => {
    const ids = ALL_SHORTCUTS.flatMap((group) => group.defs).map((def) => def.id);
    for (const { def } of MODULE_TAB_SHORTCUTS) expect(ids).toContain(def.id);
  });

  it("leaves no chord claimed twice", () => {
    const chords = ALL_SHORTCUTS.flatMap((group) => group.defs)
      // `rest.closeRequest` shares `Ctrl/Cmd+W` with `app.closeTab` on purpose — the pane listening
      // last wins. Only the number keys are being checked here.
      .filter((def) => /^[1-9]$/.test(def.chord.key))
      .map((def) => def.chord.key);
    expect(new Set(chords).size).toBe(chords.length);
  });
});

/* `Ctrl/Cmd+R` is written down twice — as `pane.reload` in this file, and as an alias of
   `rest.send` in the REST module — and which of the two a press means is settled against the one
   assembled catalogue. That is what is worth pinning: either def moving is a change to the
   other. */
describe("Ctrl/Cmd+R", () => {
  const pressR: Press = {
    key: "r",
    shift: false,
    alt: false,
    mod: true,
    ctrlOnly: true,
    typing: false,
  };

  it("sends the request while a REST tab is listening", () => {
    const ctx = { modalDepth: 0, enabled: ["rest.send"] };
    expect(decide(pressR, ALL_SHORTCUTS, ctx)).toEqual({ do: "run", id: "rest.send" });
  });

  // Sending from inside the body editor is the whole point of the chord this aliases.
  it("sends from where the request is being typed", () => {
    const ctx = { modalDepth: 0, enabled: ["rest.send"] };
    expect(decide({ ...pressR, typing: true }, ALL_SHORTCUTS, ctx)).toEqual({
      do: "run",
      id: "rest.send",
    });
  });

  it("still reloads the pane everywhere else", () => {
    const ctx = { modalDepth: 0, enabled: ["pane.reload"] };
    expect(decide(pressR, ALL_SHORTCUTS, ctx)).toEqual({ do: "run", id: "pane.reload" });
  });
});
