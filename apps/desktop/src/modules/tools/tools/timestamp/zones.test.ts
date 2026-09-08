import { describe, expect, it } from "vitest";
import { allZones, canonicalZone, preferredZone, zoneOffset } from "./zones";

describe("canonicalZone", () => {
  it("đổi tên cũ của IANA sang tên hiện hành", () => {
    expect(canonicalZone("Asia/Saigon")).toBe("Asia/Ho_Chi_Minh");
    expect(canonicalZone("Asia/Calcutta")).toBe("Asia/Kolkata");
    expect(canonicalZone("Europe/Kiev")).toBe("Europe/Kyiv");
    expect(canonicalZone("America/Buenos_Aires")).toBe("America/Argentina/Buenos_Aires");
    expect(canonicalZone("Asia/Rangoon")).toBe("Asia/Yangon");
  });

  it("để nguyên tên đã chuẩn", () => {
    expect(canonicalZone("Asia/Ho_Chi_Minh")).toBe("Asia/Ho_Chi_Minh");
    expect(canonicalZone("Europe/London")).toBe("Europe/London");
    expect(canonicalZone("UTC")).toBe("UTC");
  });
});

describe("allZones", () => {
  const zones = allZones();

  it("dùng tên chuẩn, không còn tên cũ", () => {
    expect(zones).toContain("Asia/Ho_Chi_Minh");
    expect(zones).not.toContain("Asia/Saigon");
    expect(zones).not.toContain("Asia/Calcutta");
    expect(zones).not.toContain("Europe/Kiev");
  });

  it("không có mục trùng, và đã sắp xếp", () => {
    expect(new Set(zones).size).toBe(zones.length);
    expect([...zones].sort()).toEqual(zones);
  });

  it("mọi tên trong danh sách đều dùng được với Intl", () => {
    for (const zone of zones) {
      expect(() => new Intl.DateTimeFormat("en", { timeZone: zone }).format(0)).not.toThrow();
    }
  });
});

describe("zoneOffset", () => {
  const at = Date.parse("2026-01-15T00:00:00Z");

  it("in ra chênh lệch so với UTC", () => {
    expect(zoneOffset("Asia/Ho_Chi_Minh", at)).toBe("+07:00");
    expect(zoneOffset("UTC", at)).toBe("+00:00");
  });

  it("giữ được phần lẻ nửa tiếng và 45 phút", () => {
    expect(zoneOffset("Asia/Kolkata", at)).toBe("+05:30");
    expect(zoneOffset("Asia/Kathmandu", at)).toBe("+05:45");
  });

  it("in dấu âm cho phía tây", () => {
    expect(zoneOffset("America/New_York", at)).toBe("-05:00");
  });

  it("theo mùa chứ không cố định — cùng một vùng, hai thời điểm, hai chênh lệch", () => {
    const summer = Date.parse("2026-07-15T00:00:00Z");
    expect(zoneOffset("America/New_York", summer)).toBe("-04:00");
  });

  it("không ngã với một vùng không có thật", () => {
    expect(zoneOffset("Khong/Co_That", at)).toBe("");
  });
});

describe("preferredZone", () => {
  const at = Date.parse("2026-01-15T00:00:00Z");

  /* Windows chỉ có `SE Asia Standard Time` cho cả Bangkok, Hà Nội và Jakarta, và ICU quy ID thô ấy
     về `Asia/Bangkok`. Một máy đặt tiếng Việt vì thế mặc định thành Bangkok — cùng +07:00 nên
     không nhìn ra, mà vẫn là sai nước. */
  it("đổi sang vùng của nước trong locale khi vùng của máy không thuộc nước đó", () => {
    expect(preferredZone("Asia/Bangkok", ["vi-VN"], at)).toBe("Asia/Ho_Chi_Minh");
  });

  it("để nguyên khi vùng của máy vốn đã thuộc nước đó", () => {
    expect(preferredZone("Asia/Bangkok", ["th-TH"], at)).toBe("Asia/Bangkok");
    expect(preferredZone("America/New_York", ["en-US"], at)).toBe("America/New_York");
    expect(preferredZone("Europe/Berlin", ["de-DE"], at)).toBe("Europe/Berlin");
  });

  /* Điều kiện phải trùng chênh lệch: máy đặt London mà locale tiếng Việt là người đang ở London,
     không phải một máy bị Windows quy sai vùng. */
  it("không đổi khi chênh lệch không trùng", () => {
    expect(preferredZone("Europe/London", ["vi-VN"], at)).toBe("Europe/London");
  });

  it("để nguyên khi locale không nói nước nào", () => {
    expect(preferredZone("Asia/Bangkok", ["vi"], at)).toBe("Asia/Bangkok");
    expect(preferredZone("Asia/Bangkok", [""], at)).toBe("Asia/Bangkok");
  });

  it("không ngã với locale hỏng", () => {
    expect(preferredZone("Asia/Bangkok", ["khong-phai-locale!!"], at)).toBe("Asia/Bangkok");
  });

  /* Đây là tình huống thật trên WebView2: `resolvedOptions().locale` đi theo ngôn ngữ hiển thị
     của webview và ra `en-US`, còn vùng thật của người dùng chỉ lộ ra ở `navigator.languages`. */
  it("đi tiếp xuống nguồn sau khi nguồn đầu không cứu được", () => {
    expect(preferredZone("Asia/Bangkok", ["en-US", "vi-VN"], at)).toBe("Asia/Ho_Chi_Minh");
  });

  it("bỏ qua thẻ rỗng và thẻ hỏng giữa danh sách", () => {
    expect(preferredZone("Asia/Bangkok", ["", "hong!!", "vi", "vi-VN"], at)).toBe(
      "Asia/Ho_Chi_Minh",
    );
  });

  /* Nguồn đầu đã khẳng định vùng của máy là đúng nước, nên nguồn sau không được lật lại: một máy
     Thái có `navigator.languages` gồm cả tiếng Việt vẫn phải ở Bangkok. */
  it("dừng ngay khi một nguồn xác nhận vùng của máy là đúng nước", () => {
    expect(preferredZone("Asia/Bangkok", ["th-TH", "vi-VN"], at)).toBe("Asia/Bangkok");
  });

  it("giữ nguyên khi không nguồn nào nói được nước", () => {
    expect(preferredZone("Asia/Bangkok", [], at)).toBe("Asia/Bangkok");
  });

  it("luôn trả về một vùng có trong danh sách", () => {
    const zones = allZones();
    for (const locale of ["vi-VN", "th-TH", "en-US", "de-DE", "ja-JP"]) {
      expect(zones).toContain(preferredZone("Asia/Bangkok", [locale], at));
    }
  });
});
