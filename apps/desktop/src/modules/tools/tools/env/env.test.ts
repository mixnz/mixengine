import { describe, expect, it } from "vitest";
import { parseEnv, parseJsonEnv, toDockerArgs, toEnv, toExport, toJsonEnv } from "./env";

describe("parseEnv", () => {
  it("đọc cặp khoá và giá trị", () => {
    expect(parseEnv("A=1\nB=x")).toEqual([
      { key: "A", value: "1" },
      { key: "B", value: "x" },
    ]);
  });

  it("bỏ dòng trống và dòng comment", () => {
    expect(parseEnv("# ghi chú\n\nA=1")).toEqual([{ key: "A", value: "1" }]);
  });

  it("bỏ tiền tố export", () => {
    expect(parseEnv("export A=1")).toEqual([{ key: "A", value: "1" }]);
  });

  it("cắt comment phía sau giá trị không có ngoặc", () => {
    expect(parseEnv("A=1 # ghi chú")).toEqual([{ key: "A", value: "1" }]);
  });

  it("giữ dấu thăng nằm trong ngoặc", () => {
    expect(parseEnv('A="mật#khẩu"')).toEqual([{ key: "A", value: "mật#khẩu" }]);
  });

  it("để giá trị trong ngoặc đơn nguyên văn", () => {
    expect(parseEnv("A='dòng\\ncó gạch'")).toEqual([{ key: "A", value: "dòng\\ncó gạch" }]);
  });

  it("mở escape trong ngoặc kép", () => {
    expect(parseEnv('A="dòng\\nsau"')).toEqual([{ key: "A", value: "dòng\nsau" }]);
    expect(parseEnv('A="nói \\"chào\\""')).toEqual([{ key: "A", value: 'nói "chào"' }]);
  });

  it("nối giá trị trong ngoặc trải nhiều dòng", () => {
    expect(parseEnv('KEY="dòng một\ndòng hai"')).toEqual([
      { key: "KEY", value: "dòng một\ndòng hai" },
    ]);
  });

  it("giữ dấu bằng nằm trong giá trị", () => {
    expect(parseEnv("URL=postgres://u:p@h/db?a=b")).toEqual([
      { key: "URL", value: "postgres://u:p@h/db?a=b" },
    ]);
  });
});

describe("parseJsonEnv", () => {
  it("đọc object phẳng", () => {
    expect(parseJsonEnv('{"A":"1","B":2}')).toEqual([
      { key: "A", value: "1" },
      { key: "B", value: "2" },
    ]);
  });

  it("trả null khi không phải object", () => {
    expect(parseJsonEnv("[1]")).toBeNull();
    expect(parseJsonEnv("hỏng")).toBeNull();
  });
});

describe("bộ ghi", () => {
  const pairs = [
    { key: "A", value: "1" },
    { key: "B", value: "có dấu cách" },
  ];

  it("ghi .env, bọc ngoặc khi cần", () => {
    expect(toEnv(pairs)).toBe('A=1\nB="có dấu cách"');
  });

  it("ghi dạng export", () => {
    expect(toExport(pairs)).toBe('export A=1\nexport B="có dấu cách"');
  });

  it("ghi JSON", () => {
    expect(toJsonEnv(pairs)).toBe('{\n  "A": "1",\n  "B": "có dấu cách"\n}');
  });

  it("ghi tham số docker bọc theo luật shell", () => {
    expect(toDockerArgs(pairs)).toBe("-e A='1' -e B='có dấu cách'");
  });

  it("đóng, escape rồi mở lại dấu nháy đơn cho docker", () => {
    expect(toDockerArgs([{ key: "A", value: "it's" }])).toBe("-e A='it'\\''s'");
  });

  it("escape xuống dòng và ngoặc kép khi ghi .env", () => {
    expect(toEnv([{ key: "A", value: 'hai\ndòng "x"' }])).toBe('A="hai\\ndòng \\"x\\""');
  });
});
