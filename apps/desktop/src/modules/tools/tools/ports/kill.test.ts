import { describe, expect, it } from "vitest";
import { killByPid, killByPort } from "./kill";

describe("killByPid", () => {
  it("dùng kill -9 trên macOS và Linux", () => {
    expect(killByPid("macos", 123)).toBe("kill -9 123");
    expect(killByPid("linux", 123)).toBe("kill -9 123");
  });

  it("dùng taskkill trên Windows", () => {
    expect(killByPid("windows", 123)).toBe("taskkill /PID 123 /F");
  });
});

describe("killByPort", () => {
  it("tra PID qua lsof trên macOS và Linux", () => {
    expect(killByPort("linux", 3000)).toBe("lsof -ti:3000 | xargs kill -9");
  });

  it("tra PID qua netstat trên Windows", () => {
    expect(killByPort("windows", 3000)).toBe(
      `for /f "tokens=5" %a in ('netstat -ano ^| findstr :3000') do taskkill /PID %a /F`,
    );
  });
});
