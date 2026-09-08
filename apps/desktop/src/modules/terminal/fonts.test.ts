import { describe, expect, it } from "vitest";
import { DEFAULT_FONT_FAMILY } from "./settings";
import { TERMINAL_FONTS, familyOf, fontStack } from "./fonts";

describe("fontStack", () => {
  it("puts monospace behind the chosen font", () => {
    expect(fontStack("Cascadia Code")).toBe('"Cascadia Code", monospace');
  });

  /* Cái này là lý do hàm tồn tại: xterm nuốt lặng lẽ một `ctx.font` không phân tích được, giữ số
     đo ô chữ cũ, và màn hình cắt ngang mọi dòng khi cỡ chữ đổi. Không stack nào ra khỏi đây mà
     thiếu tên font. */
  it("never answers with a stack that has no font in it", () => {
    expect(fontStack("")).toBe(DEFAULT_FONT_FAMILY);
    expect(fontStack("   ")).toBe(DEFAULT_FONT_FAMILY);
  });

  it("trims and strips quotes that would break the stack", () => {
    expect(fontStack("  Consolas  ")).toBe('"Consolas", monospace');
    expect(fontStack('Fi"ra')).toBe('"Fira", monospace');
  });
});

describe("familyOf", () => {
  it("reads the font back out of a stack", () => {
    expect(familyOf('"Fira Code", monospace')).toBe("Fira Code");
    expect(familyOf("Consolas, monospace")).toBe("Consolas");
    expect(familyOf("monospace")).toBe("monospace");
  });

  it("falls back to the default font rather than to nothing", () => {
    expect(familyOf("")).toBe("Fira Code");
    expect(familyOf(", monospace")).toBe("Fira Code");
  });

  it("round-trips every font offered in the list", () => {
    for (const font of TERMINAL_FONTS) expect(familyOf(fontStack(font))).toBe(font);
  });
});
