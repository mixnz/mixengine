import { describe, expect, it } from "vitest";

import { actionVariant, arrangeActions, type ModalAction } from "./actions";

const cancel: ModalAction = { kind: "cancel", label: "Cancel" };
const save: ModalAction = { kind: "confirm", label: "Save" };
const remove: ModalAction = { kind: "danger", label: "Delete" };
const copy: ModalAction = { kind: "secondary", label: "Copy" };
const show: ModalAction = { kind: "secondary", label: "Show" };

describe("arrangeActions", () => {
  it("puts cancel before the answer on the right", () => {
    expect(arrangeActions([cancel, save])).toEqual({ start: [], end: [cancel, save] });
  });

  it("ignores the array's order across kinds", () => {
    expect(arrangeActions([save, cancel])).toEqual({ start: [], end: [cancel, save] });
    expect(arrangeActions([remove, cancel]).end).toEqual([cancel, remove]);
  });

  it("sends tools left beside a decision, in their own order", () => {
    expect(arrangeActions([copy, cancel, show])).toEqual({ start: [copy, show], end: [cancel] });
  });

  it("keeps a lone tool on the right", () => {
    expect(arrangeActions([copy])).toEqual({ start: [], end: [copy] });
  });

  it("draws nothing for no actions", () => {
    expect(arrangeActions([])).toEqual({ start: [], end: [] });
  });
});

describe("actionVariant", () => {
  it("maps each kind to one look", () => {
    expect(actionVariant("confirm")).toBe("primary");
    expect(actionVariant("danger")).toBe("danger");
    expect(actionVariant("cancel")).toBe("default");
    expect(actionVariant("secondary")).toBe("default");
  });
});
