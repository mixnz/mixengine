import { describe, expect, it } from "vitest";
import { buildSplitRows, computeLineSegments, diffLines, diffSegments, type DiffOptions } from "./diff";

const plain: DiffOptions = { ignoreWhitespace: false, ignoreCase: false };

const kinds = (left: string, right: string, options: DiffOptions = plain): string[] => {
  const result = diffLines(left, right, options);
  return result.ok ? result.lines.map((line) => `${line.kind[0]}:${line.text}`) : [result.reason];
};

describe("diffLines", () => {
  it("gọi hai đoạn giống nhau là giống nhau", () => {
    expect(kinds("a\nb", "a\nb")).toEqual(["s:a", "s:b"]);
  });

  it("thấy dòng thêm vào", () => {
    expect(kinds("a\nc", "a\nb\nc")).toEqual(["s:a", "a:b", "s:c"]);
  });

  it("thấy dòng bị xoá", () => {
    expect(kinds("a\nb\nc", "a\nc")).toEqual(["s:a", "r:b", "s:c"]);
  });

  it("đếm số dòng thêm và xoá", () => {
    const result = diffLines("a\nb", "a\nc\nd", plain);
    expect(result.ok && result.added).toBe(2);
    expect(result.ok && result.removed).toBe(1);
  });

  it("đánh số dòng theo từng bên", () => {
    const result = diffLines("a\nb", "a", plain);
    expect(result.ok && result.lines[1]).toEqual({
      kind: "remove",
      leftNo: 2,
      rightNo: null,
      text: "b",
    });
  });

  it("bỏ qua khoảng trắng khi được yêu cầu", () => {
    expect(kinds("a  b", "a b", { ignoreWhitespace: true, ignoreCase: false })).toEqual(["s:a  b"]);
  });

  it("bỏ qua hoa thường khi được yêu cầu", () => {
    expect(kinds("Abc", "abc", { ignoreWhitespace: false, ignoreCase: true })).toEqual(["s:Abc"]);
  });

  // Cắt đầu đuôi giống nhau là thứ làm tool dùng được với file thật: mười dòng khác nhau giữa
  // hai file 50 nghìn dòng thì bảng LCS chỉ còn 10×10.
  it("chạy được với file rất dài khi phần khác nhau nhỏ", () => {
    const head = Array.from({ length: 30_000 }, (_, i) => `dòng ${i}`).join("\n");
    const result = diffLines(`${head}\nX`, `${head}\nY`, plain);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.added).toBe(1);
    expect(result.removed).toBe(1);
  });

  it("từ chối khi phần khác nhau vượt quá giới hạn", () => {
    const left = Array.from({ length: 2100 }, (_, i) => `l${i}`).join("\n");
    const right = Array.from({ length: 2100 }, (_, i) => `r${i}`).join("\n");
    expect(diffLines(left, right, plain)).toEqual({ ok: false, reason: "tooLarge" });
  });

  // Chốt lại invariant mà `computeLineSegments`/`buildSplitRows` dựa vào: một cụm thay đổi luôn xuất
  // hết remove rồi mới đến add, không xen kẽ. Nếu ai đó đổi tie-break (`>=` → `>`) trong `diffLines`,
  // test này gãy trước, thay vì để hai hàm kia âm thầm ghép sai cặp.
  it("một cụm thay đổi xuất hết remove rồi mới đến add", () => {
    expect(kinds("a\nb\nc", "a\nx\ny\nc")).toEqual(["s:a", "r:b", "a:x", "a:y", "s:c"]);
  });
});

describe("diffSegments", () => {
  it("tô đúng đoạn khác nhau ở giữa", () => {
    const result = diffSegments("SELECT * FROM users WHERE id = 1", "SELECT * FROM users WHERE id = 2", plain);
    expect(result).toEqual({
      left: [
        { text: "SELECT * FROM users WHERE id = ", changed: false },
        { text: "1", changed: true },
      ],
      right: [
        { text: "SELECT * FROM users WHERE id = ", changed: false },
        { text: "2", changed: true },
      ],
    });
  });

  it("tô đoạn khác nhau ở đầu", () => {
    const result = diffSegments("foo bar baz", "quux bar baz", plain);
    expect(result).toEqual({
      left: [
        { text: "foo", changed: true },
        { text: " bar baz", changed: false },
      ],
      right: [
        { text: "quux", changed: true },
        { text: " bar baz", changed: false },
      ],
    });
  });

  it("tô đoạn khác nhau ở cuối", () => {
    const result = diffSegments("bar baz foo", "bar baz quux", plain);
    expect(result).toEqual({
      left: [
        { text: "bar baz ", changed: false },
        { text: "foo", changed: true },
      ],
      right: [
        { text: "bar baz ", changed: false },
        { text: "quux", changed: true },
      ],
    });
  });

  it("không chặn overlap giữa đầu và đuôi khi một chuỗi là tiền tố của chuỗi kia", () => {
    const result = diffSegments("foo", "foobar", plain);
    expect(result).toEqual({
      left: [{ text: "foo", changed: false }],
      right: [
        { text: "foo", changed: false },
        { text: "bar", changed: true },
      ],
    });
  });

  it("trả null khi hai dòng không đủ giống nhau — tránh tô nhầm phần trùng hợp", () => {
    expect(diffSegments("SELECT id FROM a;", "DELETE FROM b WHERE x = 1;", plain)).toBeNull();
  });

  it("trả null khi bật ignoreWhitespace", () => {
    expect(diffSegments("a  b", "a b c", { ignoreWhitespace: true, ignoreCase: false })).toBeNull();
  });

  it("tôn trọng ignoreCase khi so khớp đầu/đuôi", () => {
    const result = diffSegments("Hello World", "hello there", { ignoreWhitespace: false, ignoreCase: true });
    expect(result).toEqual({
      left: [
        { text: "Hello ", changed: false },
        { text: "World", changed: true },
      ],
      right: [
        { text: "hello ", changed: false },
        { text: "there", changed: true },
      ],
    });
  });

  it("không cắt vỡ ký tự Unicode hai code unit", () => {
    const result = diffSegments("chào 😀 bạn", "chào 😀😀 bạn", plain);
    expect(result).not.toBeNull();
    // Ghép lại phải ra đúng chuỗi gốc — nếu cắt vỡ surrogate pair, join() sẽ ra ký tự lỗi khác độ dài.
    expect(result!.left.map((s) => s.text).join("")).toBe("chào 😀 bạn");
    expect(result!.right.map((s) => s.text).join("")).toBe("chào 😀😀 bạn");
  });
});

describe("computeLineSegments", () => {
  it("gắn segment cho đúng cặp remove/add ghép được, để trống dòng lẻ", () => {
    const result = diffLines("a\nfoo\nc", "a\nfoobar\nc", plain);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const map = computeLineSegments(result.lines, plain);
    const removeLine = result.lines.find((l) => l.kind === "remove")!;
    const addLine = result.lines.find((l) => l.kind === "add")!;
    expect(map.get(removeLine)).toEqual([{ text: "foo", changed: false }]);
    expect(map.get(addLine)).toEqual([
      { text: "foo", changed: false },
      { text: "bar", changed: true },
    ]);
  });

  it("không gắn gì khi cặp không đủ giống nhau", () => {
    const result = diffLines("a\nSELECT id FROM a;\nc", "a\nDELETE FROM b WHERE x = 1;\nc", plain);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(computeLineSegments(result.lines, plain).size).toBe(0);
  });
});

describe("buildSplitRows", () => {
  it("xếp dòng same vào một hàng ở cả hai bên", () => {
    const result = diffLines("a\nb", "a\nb", plain);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const rows = buildSplitRows(result.lines, plain);
    expect(rows).toEqual([
      {
        left: { kind: "same", no: 1, text: "a", segments: null },
        right: { kind: "same", no: 1, text: "a", segments: null },
      },
      {
        left: { kind: "same", no: 2, text: "b", segments: null },
        right: { kind: "same", no: 2, text: "b", segments: null },
      },
    ]);
  });

  it("ghép cặp remove/add cùng số lượng thành hàng replaced", () => {
    const result = diffLines("foo", "foobar", plain);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const rows = buildSplitRows(result.lines, plain);
    expect(rows).toEqual([
      {
        left: { kind: "remove", no: 1, text: "foo", segments: [{ text: "foo", changed: false }] },
        right: {
          kind: "add",
          no: 1,
          text: "foobar",
          segments: [
            { text: "foo", changed: false },
            { text: "bar", changed: true },
          ],
        },
      },
    ]);
  });

  it("để trống bên kia khi số dòng remove và add lệch nhau", () => {
    const result = diffLines("a\nb", "a\nx\ny", plain);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const rows = buildSplitRows(result.lines, plain);
    // "a" giống nhau, "b" bị ghép với "x" (cặp đầu tiên), "y" là add lẻ ra → bên trái để trống.
    expect(rows).toEqual([
      {
        left: { kind: "same", no: 1, text: "a", segments: null },
        right: { kind: "same", no: 1, text: "a", segments: null },
      },
      {
        left: { kind: "remove", no: 2, text: "b", segments: null },
        right: { kind: "add", no: 2, text: "x", segments: null },
      },
      { left: { kind: "blank" }, right: { kind: "add", no: 3, text: "y", segments: null } },
    ]);
  });
});
