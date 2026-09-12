import { describe, expect, it } from "vitest";
import { afterRefusal } from "./forceStep";

describe("afterRefusal", () => {
  /* The daemon names what is in the way — which site declares the service, which project pins the
     runtime — so the dialog asks again with that sentence rather than one of its own. */
  it("asks again with the refusal when force has not been offered yet", () => {
    expect(afterRefusal(false, "mariadb@main is declared by shop.test")).toEqual({
      ask: "force",
      hint: "mariadb@main is declared by shop.test",
    });
  });

  /* There is no third question. `service.delete` refuses a running service above the branch force
     is allowed to cross, so a forced attempt can be refused for a reason force will never get
     past — and the answer to that is to show it, not to ask a third time. */
  it("has nothing left to ask once force was refused as well", () => {
    expect(afterRefusal(true, "mariadb@main is running")).toEqual({
      ask: "none",
      error: "mariadb@main is running",
    });
  });
});
