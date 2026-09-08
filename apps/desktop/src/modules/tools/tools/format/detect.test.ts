import { describe, expect, it } from "vitest";
import { detectFormat } from "./detect";

describe("detectFormat", () => {
  it("đoán theo ký tự đầu tiên khác khoảng trắng", () => {
    expect(detectFormat('  {"a":1}')).toBe("json");
    expect(detectFormat("[1,2]")).toBe("json");
    expect(detectFormat("\n<a/>")).toBe("xml");
    expect(detectFormat("SELECT 1")).toBe("sql");
  });

  it("trả null khi không có gì để đoán", () => {
    expect(detectFormat("   \n ")).toBeNull();
  });
});
