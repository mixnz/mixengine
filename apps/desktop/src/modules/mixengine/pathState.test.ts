import { describe, expect, it } from "vitest";
import type { PathReport } from "@mixengine/api";

import { pathOutcome, shouldOfferPathInstall } from "./pathState";

/** Một report, chỉ đủ field để trả lời câu hỏi đang hỏi. */
function report(on_path: boolean, changed: boolean[] = []): PathReport {
  return {
    directory: "C:\\Users\\me\\MixEngine\\bin",
    on_path,
    places: changed.map((flag, index) => ({ name: `place-${index}`, present: on_path, changed: flag })),
    commands: [],
  };
}

describe("shouldOfferPathInstall", () => {
  it("offers while the directory is not on the PATH", () => {
    expect(shouldOfferPathInstall(report(false))).toBe(true);
  });

  it("does not offer once it is", () => {
    expect(shouldOfferPathInstall(report(true))).toBe(false);
  });

  /* `null` là "chưa đọc xong" hoặc "đọc hỏng", không phải "chưa cài": mời trên nó sẽ làm thẻ loé lên
     trước mặt người đã cài từ lâu, mỗi lần mở tab. */
  it("does not offer before the report has arrived", () => {
    expect(shouldOfferPathInstall(null)).toBe(false);
  });
});

describe("pathOutcome", () => {
  it("says a new terminal is needed when this call wrote somewhere", () => {
    expect(pathOutcome(report(true, [false, true]))).toBe("changed");
  });

  /* Không nơi nào `changed` là daemon không ghi gì cả — nói "mở terminal mới" lúc đó là đòi một
     việc không thay đổi được gì. */
  it("says nothing changed when every place already agreed", () => {
    expect(pathOutcome(report(true, [false, false]))).toBe("unchanged");
  });
});
