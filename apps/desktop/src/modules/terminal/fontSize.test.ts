import { describe, expect, it } from "vitest";
import { DEFAULT_FONT_SIZE, MAX_FONT_SIZE, MIN_FONT_SIZE, stepFontSize } from "./fontSize";

describe("stepFontSize", () => {
  it("moves one point at a time", () => {
    expect(stepFontSize(15, 1)).toBe(16);
    expect(stepFontSize(15, -1)).toBe(14);
  });

  // Giữ phím là gửi hàng chục lần liên tiếp; chạm đáy rồi thì nó phải đứng yên chứ không âm.
  it("stops at both ends instead of running past them", () => {
    expect(stepFontSize(MIN_FONT_SIZE, -1)).toBe(MIN_FONT_SIZE);
    expect(stepFontSize(MAX_FONT_SIZE, 1)).toBe(MAX_FONT_SIZE);
  });

  it("pulls a value from outside the range back into it", () => {
    expect(stepFontSize(500, 0)).toBe(MAX_FONT_SIZE);
    expect(stepFontSize(1, 0)).toBe(MIN_FONT_SIZE);
  });

  /* Cái đọc từ localStorage đi thẳng vào đây, và localStorage trả về chuỗi bất kỳ ai cũng sửa
     được — kể cả `"abc"`, ra `NaN`. */
  it("falls back to the default for a value that is not a number", () => {
    expect(stepFontSize(Number.NaN, 0)).toBe(DEFAULT_FONT_SIZE);
    expect(stepFontSize(Number.POSITIVE_INFINITY, 0)).toBe(DEFAULT_FONT_SIZE);
  });

  it("keeps the size whole", () => {
    expect(stepFontSize(13.4, 1)).toBe(14);
  });
});
