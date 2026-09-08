import { describe, expect, it } from "vitest";
import {
  detectFieldSpecs,
  maskRows,
  maskValue,
  parseFlatRows,
  type FieldMaskSpec,
} from "./mask";

describe("detectFieldSpecs", () => {
  it("đoán shape và kind mặc định theo tên cột", () => {
    const rows = [
      {
        id: 1,
        email: "a@b.com",
        phone: "0912345678",
        full_name: "Nguyễn Văn An",
        credit_card: "4111111111111111",
        cmnd: "079203001234",
        ngay_sinh: "1995-01-01",
        address: "123 Main St",
        note: "vip",
      },
    ];
    const byName = Object.fromEntries(detectFieldSpecs(rows).map((s) => [s.name, s]));
    expect(byName.id).toEqual({ name: "id", shape: "generic", kind: "none" });
    expect(byName.email).toEqual({ name: "email", shape: "email", kind: "partial" });
    expect(byName.phone).toEqual({ name: "phone", shape: "phone", kind: "partial" });
    expect(byName.full_name).toEqual({ name: "full_name", shape: "name", kind: "partial" });
    expect(byName.credit_card).toEqual({ name: "credit_card", shape: "card", kind: "partial" });
    expect(byName.cmnd).toEqual({ name: "cmnd", shape: "idNumber", kind: "partial" });
    expect(byName.ngay_sinh).toEqual({ name: "ngay_sinh", shape: "dob", kind: "redact" });
    expect(byName.address).toEqual({ name: "address", shape: "address", kind: "redact" });
    expect(byName.note).toEqual({ name: "note", shape: "generic", kind: "none" });
  });

  it("liệt kê cột theo thứ tự xuất hiện lần đầu, hợp từ nhiều dòng", () => {
    const rows = [{ b: 1 }, { a: 2, b: 3 }];
    expect(detectFieldSpecs(rows).map((s) => s.name)).toEqual(["b", "a"]);
  });
});

describe("maskValue", () => {
  it("none giữ nguyên giá trị và kiểu gốc", () => {
    expect(maskValue(42, "none", "generic")).toBe(42);
    expect(maskValue(null, "none", "generic")).toBeNull();
  });

  it("giá trị rỗng hoặc null không bị đổi, bất kể kind", () => {
    expect(maskValue(null, "redact", "generic")).toBeNull();
    expect(maskValue(undefined, "hash", "email")).toBeUndefined();
    expect(maskValue("", "partial", "name")).toBe("");
  });

  it("redact luôn thành ***", () => {
    expect(maskValue("bất kỳ giá trị nào", "redact", "generic")).toBe("***");
  });

  it("partial theo shape email giữ chữ đầu và cả domain", () => {
    expect(maskValue("jane.doe@example.com", "partial", "email")).toBe("j*******@example.com");
  });

  it("partial theo shape phone giữ 2 số cuối", () => {
    expect(maskValue("0912345678", "partial", "phone")).toBe("********78");
  });

  it("partial theo shape card giữ 4 số cuối", () => {
    expect(maskValue("4111111111111111", "partial", "card")).toBe("************1111");
  });

  it("partial theo shape idNumber giữ 4 số cuối", () => {
    expect(maskValue("079203001234", "partial", "idNumber")).toBe("********1234");
  });

  it("partial theo shape name viết tắt từng từ", () => {
    expect(maskValue("Nguyễn Văn An", "partial", "name")).toBe("N*** V*** A***");
  });

  it("partial theo shape generic giữ chữ đầu và cuối", () => {
    expect(maskValue("abcdefg", "partial", "generic")).toBe("a*****g");
    expect(maskValue("ab", "partial", "generic")).toBe("**");
  });

  it("hash tất định — cùng giá trị luôn ra cùng mã", () => {
    const first = maskValue("customer-42", "hash", "generic");
    const second = maskValue("customer-42", "hash", "generic");
    expect(first).toBe(second);
    expect(first).toMatch(/^h_[0-9a-f]{8}$/);
  });

  it("hash khác giá trị thì khác mã", () => {
    expect(maskValue("a", "hash", "generic")).not.toBe(maskValue("b", "hash", "generic"));
  });
});

describe("maskRows", () => {
  it("chỉ mask field có kind khác none, giữ nguyên các field còn lại", () => {
    const rows = [
      { id: 1, email: "a@b.com" },
      { id: 2, email: "c@d.com" },
    ];
    const specs: FieldMaskSpec[] = [
      { name: "id", shape: "generic", kind: "none" },
      { name: "email", shape: "email", kind: "redact" },
    ];
    expect(maskRows(rows, specs)).toEqual([
      { id: 1, email: "***" },
      { id: 2, email: "***" },
    ]);
  });

  it("hash giữ nhất quán khi cùng giá trị lặp lại ở nhiều dòng", () => {
    const rows = [{ key: "same" }, { key: "same" }, { key: "different" }];
    const specs: FieldMaskSpec[] = [{ name: "key", shape: "generic", kind: "hash" }];
    const [first, second, third] = maskRows(rows, specs);
    expect(first!.key).toBe(second!.key);
    expect(first!.key).not.toBe(third!.key);
  });
});

describe("parseFlatRows", () => {
  it("nhận mảng object phẳng", () => {
    expect(parseFlatRows([{ a: 1 }, { a: 2 }])).toEqual([{ a: 1 }, { a: 2 }]);
  });

  it("nhận một object đơn, bọc lại thành mảng một phần tử", () => {
    expect(parseFlatRows({ a: 1 })).toEqual([{ a: 1 }]);
  });

  it("từ chối object/mảng lồng bên trong — không âm thầm bỏ qua", () => {
    expect(parseFlatRows([{ a: 1, nested: { x: 1 } }])).toBeNull();
    expect(parseFlatRows([{ a: 1, tags: ["x"] }])).toBeNull();
  });

  it("không đọc được thì trả null", () => {
    expect(parseFlatRows("hello")).toBeNull();
    expect(parseFlatRows([1, 2, 3])).toBeNull();
    expect(parseFlatRows([])).toBeNull();
  });
});
