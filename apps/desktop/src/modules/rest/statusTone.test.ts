import { describe, expect, it } from "vitest";
import { statusTone } from "./statusTone";

describe("statusTone", () => {
  it("draws each class of status in its tone", () => {
    expect(statusTone(200)).toBe("success");
    expect(statusTone(204)).toBe("success");
    expect(statusTone(301)).toBe("neutral");
    expect(statusTone(404)).toBe("warning");
    expect(statusTone(503)).toBe("danger");
  });

  it("leaves an informational status uncoloured", () => {
    expect(statusTone(101)).toBe("neutral");
  });
});
