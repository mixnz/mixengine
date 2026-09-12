import { describe, expect, it } from "vitest";
import { exit, OPEN } from "./dialogExit";

const reply = () => {};
const answered = exit(OPEN, { type: "answer", reply });
const delivered = exit(answered, { type: "delivered" });

describe("answer", () => {
  it("starts the exit and holds the reply", () => {
    expect(answered.closing).toBe(true);
    expect(answered.answer).toBe(reply);
  });

  /* A dialog listens for Escape on `window` and has an overlay of its own, so a second answer
     arriving while the first is still animating out is ordinary rather than exotic. The state
     comes straight back — the same object, which is how the hook reads "ignored" — so the dialog
     tells its caller one thing. */
  it("keeps the first answer and ignores the second", () => {
    expect(exit(answered, { type: "answer", reply: () => {} })).toBe(answered);
  });
});

describe("asked", () => {
  /* The bug this machine was pulled out of the hook for. A caller that keeps the dialog mounted —
     to ask again with what the daemon just refused — used to be left with it `closing` for ever:
     `opacity: 0`, `pointer-events: none`, holding the modal count, and showing the refusal on a
     surface nobody can see. The way out was reloading the app. */
  it("reopens a dialog that has been asked something new", () => {
    expect(exit(delivered, { type: "asked" })).toEqual(OPEN);
  });

  /* **Not while the answer is still on its way.** Reopening here would drop the reply the timer is
     about to hand over, and the confirmed action would simply never run. A dialog re-rendered
     mid-animation for reasons of its own is exactly that case. */
  it("leaves an answer that has not been handed over yet alone", () => {
    expect(exit(answered, { type: "asked" })).toBe(answered);
  });

  /* So the hook's effect, which fires this on every render that changes the question, settles. */
  it("changes nothing for a dialog nobody has answered", () => {
    expect(exit(OPEN, { type: "asked" })).toBe(OPEN);
  });
});

describe("delivered", () => {
  it("marks the answer as handed over, and leaves the dialog closed", () => {
    expect(delivered.closing).toBe(true);
    expect(delivered.answer).toBe(reply);
    expect(exit(delivered, { type: "delivered" })).toBe(delivered);
  });
});
