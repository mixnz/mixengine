import { describe, expect, it } from "vitest";
import type { ListeningPort } from "./api";
import { matchesFilter } from "./filter";

const row = (over: Partial<ListeningPort> = {}): ListeningPort => ({
  port: 3000,
  address: "0.0.0.0",
  pid: 123,
  process: "node.exe",
  ...over,
});

describe("matchesFilter", () => {
  it("nhận mọi hàng khi ô lọc rỗng", () => {
    expect(matchesFilter(row(), "")).toBe(true);
    expect(matchesFilter(row(), "   ")).toBe(true);
  });

  it("khớp theo số cổng", () => {
    expect(matchesFilter(row({ port: 8080 }), "8080")).toBe(true);
  });

  // Gõ `80` ra cả 80, 8080 và 3080 — có ích khi chưa nhớ chính xác cổng.
  it("khớp cổng theo chuỗi con", () => {
    expect(matchesFilter(row({ port: 8080 }), "80")).toBe(true);
    expect(matchesFilter(row({ port: 3080 }), "80")).toBe(true);
  });

  it("khớp theo tên tiến trình", () => {
    expect(matchesFilter(row({ process: "postgres" }), "postgres")).toBe(true);
  });

  // Người ta gõ `node`, không gõ `Node.exe`.
  it("không phân biệt hoa thường ở tên tiến trình", () => {
    expect(matchesFilter(row({ process: "Node.exe" }), "node")).toBe(true);
    expect(matchesFilter(row({ process: "node.exe" }), "NODE")).toBe(true);
  });

  it("khớp một phần tên tiến trình", () => {
    expect(matchesFilter(row({ process: "com.docker.backend" }), "docker")).toBe(true);
  });

  it("không vỡ khi không tra được tên tiến trình", () => {
    expect(matchesFilter(row({ process: null }), "node")).toBe(false);
    expect(matchesFilter(row({ process: null, port: 3000 }), "3000")).toBe(true);
  });

  it("loại hàng không khớp cả cổng lẫn tên", () => {
    expect(matchesFilter(row({ port: 3000, process: "node.exe" }), "nginx")).toBe(false);
  });
});
