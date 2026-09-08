import { describe, expect, it } from "vitest";
import { DEFAULT_FONT_SIZE } from "./fontSize";
import {
  DEFAULT_FONT_FAMILY,
  DEFAULT_SETTINGS,
  MAX_SCROLLBACK,
  MIN_SCROLLBACK,
  clampScrollback,
  sanitizeSettings,
  withLegacyFontSize,
} from "./settings";

describe("clampScrollback", () => {
  it("keeps a sensible number as it is", () => {
    expect(clampScrollback(20000)).toBe(20000);
  });

  it("stops at both ends", () => {
    expect(clampScrollback(0)).toBe(MIN_SCROLLBACK);
    expect(clampScrollback(-40)).toBe(MIN_SCROLLBACK);
    expect(clampScrollback(10_000_000)).toBe(MAX_SCROLLBACK);
  });

  /* Ô nhập là `type="number"` nhưng cái đi vào đây là `Number(text)` của một ô người dùng gõ tay,
     và một ô trống ra `NaN`. */
  it("falls back to the default for a value that is not a number", () => {
    expect(clampScrollback(Number.NaN)).toBe(DEFAULT_SETTINGS.scrollback);
    expect(clampScrollback(Number.POSITIVE_INFINITY)).toBe(DEFAULT_SETTINGS.scrollback);
  });

  it("keeps the count whole", () => {
    expect(clampScrollback(1200.7)).toBe(1201);
  });
});

describe("sanitizeSettings", () => {
  it("gives every default when there is nothing stored", () => {
    expect(sanitizeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(sanitizeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(sanitizeSettings({})).toEqual(DEFAULT_SETTINGS);
  });

  /* Ca thật sự đáng test: một file viết ra bởi bản trước, thiếu đúng những trường bản này mới
     thêm. Trường có phải giữ, trường thiếu phải bù. */
  it("fills in only what an older file is missing", () => {
    const settings = sanitizeSettings({ fontSize: 18, scrollback: 12000 });
    expect(settings.fontSize).toBe(18);
    expect(settings.scrollback).toBe(12000);
    expect(settings.fontFamily).toBe(DEFAULT_FONT_FAMILY);
    expect(settings.cursorStyle).toBe(DEFAULT_SETTINGS.cursorStyle);
    expect(settings.rightClickPastes).toBe(false);
    expect(settings.titleShowsTargetName).toBe(DEFAULT_SETTINGS.titleShowsTargetName);
  });

  /* Chưa ai chạm vào cài đặt thì tab vẫn mang tên đích đã lưu: đó là cái người mở năm phiên tới
     năm máy chủ cần, và `deploy@10.0.0.7` năm lần thì không. */
  it("names a tab after its saved target until told otherwise", () => {
    expect(sanitizeSettings({}).titleShowsTargetName).toBe(true);
  });

  /* Mặc định bật, nên `false` trong file là một câu người dùng đã nói — không phải một trường
     thiếu. Nó phải sống sót, đúng như `cursorBlink: false` sống sót. */
  it("keeps a setting the user turned off", () => {
    expect(sanitizeSettings({ titleShowsTargetName: false }).titleShowsTargetName).toBe(false);
  });

  it("keeps every field a full file gives it", () => {
    const stored = {
      fontFamily: "Cascadia Mono, monospace",
      fontSize: 16,
      scrollback: 9000,
      cursorStyle: "bar",
      cursorBlink: false,
      defaultShell: "pwsh",
      defaultCwd: "C:\\work",
      rightClickPastes: true,
      titleShowsTargetName: true,
    };
    expect(sanitizeSettings(stored)).toEqual(stored);
  });

  /* File này người dùng sửa được bằng tay, và một giá trị lạ ở đây là một terminal không vẽ nổi
     con trỏ chứ không phải một dòng log. */
  it("refuses a cursor style xterm does not have", () => {
    expect(sanitizeSettings({ cursorStyle: "spiral" }).cursorStyle).toBe(
      DEFAULT_SETTINGS.cursorStyle,
    );
  });

  it("refuses junk in every other field too", () => {
    const settings = sanitizeSettings({
      fontFamily: "   ",
      fontSize: "abc",
      scrollback: -5,
      cursorBlink: "yes",
      defaultShell: "",
      defaultCwd: 42,
      rightClickPastes: "on",
      titleShowsTargetName: 1,
    });
    expect(settings.fontFamily).toBe(DEFAULT_FONT_FAMILY);
    expect(settings.fontSize).toBe(DEFAULT_FONT_SIZE);
    expect(settings.scrollback).toBe(MIN_SCROLLBACK);
    expect(settings.cursorBlink).toBe(DEFAULT_SETTINGS.cursorBlink);
    expect(settings.defaultShell).toBeNull();
    expect(settings.defaultCwd).toBeNull();
    expect(settings.rightClickPastes).toBe(false);
    expect(settings.titleShowsTargetName).toBe(DEFAULT_SETTINGS.titleShowsTargetName);
  });
});

describe("withLegacyFontSize", () => {
  /* Cỡ chữ ở đợt trước nằm trong localStorage. Người dùng đã chỉnh nó không được thấy màn hình
     nhảy về mặc định chỉ vì chỗ cất đổi. */
  it("takes the old localStorage size when the file has none", () => {
    expect(withLegacyFontSize(undefined, "20").fontSize).toBe(20);
    expect(withLegacyFontSize({ scrollback: 8000 }, "20").fontSize).toBe(20);
  });

  it("leaves the file alone once the file has a size of its own", () => {
    expect(withLegacyFontSize({ fontSize: 11 }, "20").fontSize).toBe(11);
  });

  it("clamps the old value like any other", () => {
    expect(withLegacyFontSize({}, "900").fontSize).toBe(32);
  });

  it("ignores an old value that is not a number, or none at all", () => {
    expect(withLegacyFontSize({}, "abc").fontSize).toBe(DEFAULT_FONT_SIZE);
    expect(withLegacyFontSize({}, null).fontSize).toBe(DEFAULT_FONT_SIZE);
  });

  it("carries the rest of the file through untouched", () => {
    expect(withLegacyFontSize({ scrollback: 8000 }, "20").scrollback).toBe(8000);
  });
});
