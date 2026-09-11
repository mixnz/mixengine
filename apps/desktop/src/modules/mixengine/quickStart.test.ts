import { describe, expect, it } from "vitest";
import type { SiteSummary } from "@mixengine/api";

import { canStart, shouldOfferQuickStart } from "./quickStart";

/** Một site, đủ field để đếm. Nội dung không quan trọng: câu hỏi là *có hay không*. */
const a_site = { domain: "blog.test" } as unknown as SiteSummary;

describe("shouldOfferQuickStart", () => {
  it("offers on a home with no sites", () => {
    expect(shouldOfferQuickStart([])).toBe(true);
  });

  it("does not offer once a site exists", () => {
    expect(shouldOfferQuickStart([a_site])).toBe(false);
  });

  /* `null` là "chưa đọc xong", không phải "rỗng" — mời trên nó sẽ làm thẻ loé lên trước mặt người
     đã có site, mỗi lần mở tab. */
  it("does not offer before the listing has arrived", () => {
    expect(shouldOfferQuickStart(null)).toBe(false);
  });
});

describe("canStart", () => {
  it("needs both a name and a folder", () => {
    expect(canStart("blog", "/projects/blog")).toBe(true);
    expect(canStart("", "/projects/blog")).toBe(false);
    expect(canStart("blog", "")).toBe(false);
  });

  /* Khoảng trắng không phải một cái tên. Luật slug thật vẫn là của daemon — đây chỉ quyết định nút
     có bấm được không. */
  it("does not count whitespace as either", () => {
    expect(canStart("   ", "/projects/blog")).toBe(false);
    expect(canStart("blog", "   ")).toBe(false);
  });
});
