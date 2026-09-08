import { describe, expect, it } from "vitest";
import { encodeQr } from "./qrcode";

describe("encodeQr", () => {
  it("sinh được grid vuông cho text ngắn", () => {
    const grid = encodeQr("hello", "M");
    expect(grid).not.toBeNull();
    expect(grid!.size).toBeGreaterThanOrEqual(21);
    expect((grid!.size - 21) % 4).toBe(0);
  });

  it("góc trên-trái luôn tối — module định vị (finder pattern) của mọi QR", () => {
    const grid = encodeQr("hello", "M")!;
    expect(grid.isDark(0, 0)).toBe(true);
  });

  it("text vượt sức chứa QR (kể cả version 40) trả về null thay vì ném lỗi", () => {
    const grid = encodeQr("a".repeat(5000), "H");
    expect(grid).toBeNull();
  });

  it("text dài hơn thì cần version (size) lớn hơn hoặc bằng", () => {
    const small = encodeQr("hi", "M")!;
    const big = encodeQr("hello world, this is a much longer piece of text to encode", "M")!;
    expect(big.size).toBeGreaterThanOrEqual(small.size);
  });
});
