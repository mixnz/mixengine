import { describe, expect, it } from "vitest";
import { likeToRegex } from "./like";

describe("likeToRegex", () => {
  it("đổi % thành .* và _ thành .", () => {
    expect(likeToRegex("a%b_c")).toBe("^a.*b.c$");
  });

  it("bỏ neo ở đầu khi mẫu mở đầu bằng %", () => {
    expect(likeToRegex("%abc")).toBe(".*abc$");
  });

  it("bỏ neo ở cuối khi mẫu kết thúc bằng %", () => {
    expect(likeToRegex("abc%")).toBe("^abc.*");
  });

  it("escape ký tự đặc biệt của regex — đây là chỗ một lỗi im lặng sinh ra", () => {
    expect(likeToRegex("a.b%")).toBe("^a\\.b.*");
    expect(likeToRegex("(x)%")).toBe("^\\(x\\).*");
    expect(likeToRegex("a+b")).toBe("^a\\+b$");
    expect(likeToRegex("100$")).toBe("^100\\$$");
  });

  it("mẫu chỉ có % khớp mọi thứ", () => {
    expect(likeToRegex("%")).toBe(".*");
  });

  it("mẫu không có ký tự đại diện là so bằng chính xác, không phải chứa", () => {
    expect(likeToRegex("abc")).toBe("^abc$");
  });
});
