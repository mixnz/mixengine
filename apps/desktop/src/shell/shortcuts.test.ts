import { describe, expect, it } from "vitest";
import { decide, type Press } from "../core/shortcuts";
import { moduleTabShortcuts, newModuleTabId, shortcutsFor } from "./shortcuts";
import { visibleModules } from "./profiles";
import { MODULES, MODULE_PRESETS } from "./registry";

const everything = visibleModules(MODULE_PRESETS.everything);
const mixengineOnly = visibleModules(MODULE_PRESETS.mixengine);
const databaseTools = visibleModules(MODULE_PRESETS.databaseTools);

/* The number keys are derived from the modules a profile leaves visible, so what is worth pinning
   down is the derivation: which module each key opens, that it counts from one however few there
   are, and that the catalogue the table and the dispatcher read carries every one of them.
   `Workspace.tsx` registers its handlers from the same list, which is why nothing here has to reach
   into React to check they agree. */
describe("moduleTabShortcuts", () => {
  it("gives the visible modules 1, 2, 3… in the order they are drawn", () => {
    expect(moduleTabShortcuts(everything).map((e) => [e.def.chord.key, e.moduleId])).toEqual(
      MODULES.map((module, i) => [String(i + 1), module.id]),
    );
  });

  /* The point of the whole task: `Ctrl/Cmd+1` is the first module a person can see, whichever one
     that is. A profile of one module gets one chord, and it is `1` — not the number the registry
     happens to list that module at. */
  it("counts from one whatever the profile leaves visible", () => {
    expect(moduleTabShortcuts(mixengineOnly).map((e) => [e.def.chord.key, e.moduleId])).toEqual([
      ["1", "mixengine"],
    ]);
    expect(moduleTabShortcuts(databaseTools).map((e) => e.def.chord.key)).toEqual([
      "1",
      "2",
      "3",
      "4",
    ]);
    expect(moduleTabShortcuts(databaseTools)[0].moduleId).toBe("db");
  });

  it("names each chord after the module it opens, and the module after itself", () => {
    for (const { moduleId, def } of moduleTabShortcuts(everything)) {
      expect(def.id).toBe(newModuleTabId(moduleId));
      expect(def.labelVars?.module).toBe(MODULES.find((m) => m.id === moduleId)?.labelKey);
    }
  });

  it("is on the catalogue the dispatcher resolves against", () => {
    for (const visible of [everything, mixengineOnly, databaseTools]) {
      const ids = shortcutsFor(visible)
        .flatMap((group) => group.defs)
        .map((def) => def.id);
      for (const { def } of moduleTabShortcuts(visible)) expect(ids).toContain(def.id);
    }
  });

  it("leaves no chord claimed twice", () => {
    for (const visible of [everything, mixengineOnly, databaseTools]) {
      const chords = shortcutsFor(visible)
        .flatMap((group) => group.defs)
        // `rest.closeRequest` shares `Ctrl/Cmd+W` with `app.closeTab` on purpose — the pane
        // listening last wins. Only the number keys are being checked here.
        .filter((def) => /^[1-9]$/.test(def.chord.key))
        .map((def) => def.chord.key);
      expect(new Set(chords).size).toBe(chords.length);
    }
  });

  /* A hidden module contributes no chord of its own either: its panes are never mounted, so nothing
     would answer one. The catalogue is what the shortcut table draws, and a row for a key nothing
     answers is a row that lies. */
  it("leaves a hidden module's own chords off the catalogue", () => {
    const scopes = shortcutsFor(mixengineOnly).map((group) => group.scope);
    const hidden = MODULES.filter((m) => m.id !== "mixengine").flatMap((m) => m.shortcuts ?? []);
    for (const group of hidden) expect(scopes).not.toContain(group.scope);
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
    expect(decide(pressR, shortcutsFor(everything), ctx)).toEqual({ do: "run", id: "rest.send" });
  });

  // Sending from inside the body editor is the whole point of the chord this aliases.
  it("sends from where the request is being typed", () => {
    const ctx = { modalDepth: 0, enabled: ["rest.send"] };
    expect(decide({ ...pressR, typing: true }, shortcutsFor(everything), ctx)).toEqual({
      do: "run",
      id: "rest.send",
    });
  });

  it("still reloads the pane everywhere else", () => {
    const ctx = { modalDepth: 0, enabled: ["pane.reload"] };
    expect(decide(pressR, shortcutsFor(everything), ctx)).toEqual({ do: "run", id: "pane.reload" });
  });
});
