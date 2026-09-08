import { describe, expect, it } from "vitest";
import { minifySql } from "./sql";

describe("minifySql", () => {
  it("gom khoảng trắng và xuống dòng thành một dấu cách", () => {
    expect(minifySql("SELECT   a,\n       b\nFROM   t")).toBe("SELECT a, b FROM t");
  });

  // Gom khoảng trắng bên trong chuỗi là đổi dữ liệu, không phải làm gọn câu lệnh.
  it("không đụng vào khoảng trắng bên trong chuỗi", () => {
    expect(minifySql("SELECT  'a   b'  FROM t")).toBe("SELECT 'a   b' FROM t");
  });

  it("hiểu dấu nháy đôi bên trong chuỗi", () => {
    expect(minifySql("SELECT 'it''s   ok'   FROM t")).toBe("SELECT 'it''s   ok' FROM t");
  });

  it("giữ nguyên định danh trong dấu backtick và ngoặc kép", () => {
    expect(minifySql('SELECT `a  b`,  "c  d"  FROM t')).toBe('SELECT `a  b`, "c  d" FROM t');
  });

  // Nuốt nửa dòng comment là biến phần còn lại của câu lệnh thành comment.
  it("bỏ trọn comment một dòng", () => {
    expect(minifySql("SELECT a -- lấy cột a\nFROM t")).toBe("SELECT a FROM t");
  });

  it("bỏ comment khối", () => {
    expect(minifySql("SELECT /* ghi chú */ a FROM t")).toBe("SELECT a FROM t");
  });

  it("không nhầm dấu gạch trong chuỗi là comment", () => {
    expect(minifySql("SELECT '-- không phải comment' FROM t")).toBe(
      "SELECT '-- không phải comment' FROM t",
    );
  });
});
