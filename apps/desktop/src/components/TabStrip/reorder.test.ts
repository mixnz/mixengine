import { describe, expect, it } from "vitest";
import { dropTargetAt, moveId, moveTab, type TabBox } from "./reorder";

const IDS = ["a", "b", "c", "d"];

describe("moveId", () => {
  it("carries a tab to the right, past the one it was dropped on", () => {
    expect(moveId(IDS, "a", "c", "after")).toEqual(["b", "c", "a", "d"]);
  });

  it("carries a tab to the left, in front of the one it was dropped on", () => {
    expect(moveId(IDS, "d", "b", "before")).toEqual(["a", "d", "b", "c"]);
  });

  it("drops a tab on its own neighbour's near edge and nothing moves", () => {
    // `a` is already before `b`, and `d` is already after `c`.
    expect(moveId(IDS, "a", "b", "before")).toBe(IDS);
    expect(moveId(IDS, "d", "c", "after")).toBe(IDS);
  });

  it("hands back the very same array when a tab is dropped on itself", () => {
    expect(moveId(IDS, "b", "b", "after")).toBe(IDS);
  });

  it("hands back the very same array when either id is not on the strip", () => {
    expect(moveId(IDS, "zzz", "b", "after")).toBe(IDS);
    expect(moveId(IDS, "b", "zzz", "after")).toBe(IDS);
  });

  it("moves the first tab to the very end and the last to the very front", () => {
    expect(moveId(IDS, "a", "d", "after")).toEqual(["b", "c", "d", "a"]);
    expect(moveId(IDS, "d", "a", "before")).toEqual(["d", "a", "b", "c"]);
  });
});

describe("moveTab", () => {
  const TABS = [{ id: "a" }, { id: "b" }, { id: "c" }];

  it("moves the whole tab, not a copy of it", () => {
    const next = moveTab(TABS, "c", "a", "before");
    expect(next.map((t) => t.id)).toEqual(["c", "a", "b"]);
    expect(next[0]).toBe(TABS[2]);
  });

  it("hands back the very same array when nothing moves", () => {
    expect(moveTab(TABS, "b", "a", "after")).toBe(TABS);
  });
});

/** Four tabs 100px wide, 2px apart, starting at x=10 — `a` spans 10..110, `b` 112..212, `c`
 *  214..314 and `d` 316..416. All one width, so a tab moves at two thirds of a tab's travel:
 *  66.7px. */
const BOXES: TabBox[] = IDS.map((id, i) => ({ id, left: 10 + i * 102, width: 100 }));

describe("dropTargetAt", () => {
  it("takes the next tab's place once it covers two thirds of it, carried to the right", () => {
    // `a` drawn from 78 covers 66px of `b`, and from 79 covers 67.
    expect(dropTargetAt(78, BOXES, "a")).toBeNull();
    expect(dropTargetAt(79, BOXES, "a")).toEqual({ id: "b", side: "after" });
  });

  it("takes the same two thirds carried the other way", () => {
    // `d` drawn from 248 covers 66px of `c`, and from 247 covers 67.
    expect(dropTargetAt(248, BOXES, "d")).toBeNull();
    expect(dropTargetAt(247, BOXES, "d")).toEqual({ id: "c", side: "before" });
  });

  it("takes the furthest tab it covers, not the first", () => {
    // Far enough right that `c` is barely touched and `d` is most of the way covered.
    expect(dropTargetAt(300, BOXES, "a")).toEqual({ id: "d", side: "after" });
    // And at the end of the strip, where the drag is held: right on top of the last tab.
    expect(dropTargetAt(316, BOXES, "a")).toEqual({ id: "d", side: "after" });
  });

  it("takes both at once when one wide tab covers two narrow ones", () => {
    const narrow: TabBox[] = [
      { id: "a", left: 0, width: 200 },
      { id: "b", left: 202, width: 60 },
      { id: "c", left: 264, width: 60 },
    ];
    expect(dropTargetAt(190, narrow, "a")).toEqual({ id: "c", side: "after" });
  });

  it("goes to the very front, where the strip holds it against the first tab", () => {
    expect(dropTargetAt(10, BOXES, "d")).toEqual({ id: "a", side: "before" });
  });

  it("offers nothing to a tab at rest, or nudged less than two thirds of the way", () => {
    expect(dropTargetAt(112, BOXES, "b")).toBeNull(); // exactly where it is laid out
    expect(dropTargetAt(150, BOXES, "b")).toBeNull(); // 36px into `c`
    expect(dropTargetAt(80, BOXES, "b")).toBeNull(); // 30px into `a`
  });

  /* A strip of tabs that are not all one width, which is every REST strip: `GET` beside a short
     name and `DELETE` beside a long one are nowhere near the same size. `a` spans 0..40, `b`
     42..242 and `c` 244..444. */
  const MIXED: TabBox[] = [
    { id: "a", left: 0, width: 40 },
    { id: "b", left: 42, width: 200 },
    { id: "c", left: 244, width: 200 },
  ];

  it("carries a narrow tab past a wide one, which it can never cover two thirds of", () => {
    /* With `a` lifted out, `b` starts at 2 and its middle is at 102; a sixth of `a` — the
       narrower of the two — is 6.7 further. This is the case that could not be dragged at all
       while the rule was about how much of `b` was covered: 40px of tab has no two thirds of a
       200px one to cover, however far it is taken. */
    expect(dropTargetAt(108, MIXED, "a")).toBeNull();
    expect(dropTargetAt(109, MIXED, "a")).toEqual({ id: "b", side: "after" });
    // And on past the second wide one, to the end of the strip.
    expect(dropTargetAt(311, MIXED, "a")).toEqual({ id: "c", side: "after" });
  });

  it("carries a wide tab past a narrow one, on the narrow one's measure", () => {
    /* `b` lifted out leaves `a` where it is: middle at 20, less a sixth of the narrower of the
       two — `a` again — which is 6.7. The narrow tab decides it whichever of the two is the one
       in hand, so `b` clears `a` in as much travel as `a` needs to clear `b`. */
    expect(dropTargetAt(14, MIXED, "b")).toBeNull();
    expect(dropTargetAt(13, MIXED, "b")).toEqual({ id: "a", side: "before" });
  });

  it("leaves a tab where a move has just put it, wherever the hand is", () => {
    /* The move in the first case above, applied — `a` is now after `b` — with the hand still
       exactly where it was when it asked for it. Asked again, the answer has to be "nowhere":
       anything else and the two tabs swap back and forth for as long as the hand is held there. */
    const swapped: TabBox[] = [
      { id: "b", left: 0, width: 200 },
      { id: "a", left: 202, width: 40 },
      { id: "c", left: 244, width: 200 },
    ];
    expect(dropTargetAt(109, swapped, "a")).toBeNull();
  });

  it("offers nothing on an empty strip, or for a tab that is no longer on it", () => {
    expect(dropTargetAt(50, [], "a")).toBeNull();
    expect(dropTargetAt(200, BOXES, "zzz")).toBeNull();
  });
});
