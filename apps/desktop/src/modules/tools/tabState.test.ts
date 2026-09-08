import { describe, expect, it } from "vitest";
import { parseToolsTabState } from "./tabState";

describe("parseToolsTabState", () => {
  it("nhận một toolId là chuỗi khác rỗng", () => {
    expect(parseToolsTabState({ toolId: "timestamp" })).toEqual({ toolId: "timestamp" });
  });

  it("trả null cho giá trị không phải object", () => {
    expect(parseToolsTabState(undefined)).toBeNull();
    expect(parseToolsTabState("timestamp")).toBeNull();
    expect(parseToolsTabState(null)).toBeNull();
    expect(parseToolsTabState(["timestamp"])).toBeNull();
  });

  it("trả null khi toolId thiếu, rỗng, hoặc không phải chuỗi", () => {
    expect(parseToolsTabState({})).toBeNull();
    expect(parseToolsTabState({ toolId: "" })).toBeNull();
    expect(parseToolsTabState({ toolId: 7 })).toBeNull();
  });

  it("bỏ qua mọi khoá lạ thay vì từ chối cả object", () => {
    expect(parseToolsTabState({ toolId: "jwt", input: "bí mật" })).toEqual({ toolId: "jwt" });
  });
});
