import { describe, expect, it } from "vitest";
import { scrollTopFor } from "./savedListScroll";

/* Một hộp cuộn cao 300, tiêu đề dính cao 40, hàng cao 50. Con số tròn để đọc ra ngay hàng nào đang
   ở đâu, không phải để giống một hộp thật. */
const view = { scrollTop: 0, height: 300 };
const HEADER = 40;

describe("scrollTopFor", () => {
  it("does not scroll a row already in full view below the header", () => {
    expect(scrollTopFor({ top: 60, height: 50 }, view, HEADER)).toBeNull();
  });

  /* Vùng nhìn thấy bắt đầu dưới tiêu đề dính, không phải ở mép trên hộp — không thì thứ được cuộn
     tới lại đúng là thứ bị che. */
  it("counts a row behind the sticky header as out of view", () => {
    expect(scrollTopFor({ top: 120, height: 50 }, { scrollTop: 100, height: 300 }, HEADER)).toBe(80);
  });

  it("brings a row above the viewport down to just under the header", () => {
    expect(scrollTopFor({ top: 500, height: 50 }, { scrollTop: 600, height: 300 }, HEADER)).toBe(460);
  });

  it("brings a row below the viewport up to its bottom edge", () => {
    expect(scrollTopFor({ top: 900, height: 50 }, view, HEADER)).toBe(650);
  });

  /* Một hàng cao hơn cả khung — tên dài xuống dòng, thêm huy hiệu chỉ đọc — thì phần đầu của nó là
     phần đáng thấy, nên nó canh theo mép trên. */
  it("aligns a row taller than the viewport to the top", () => {
    expect(scrollTopFor({ top: 900, height: 400 }, view, HEADER)).toBe(860);
  });

  /* Hàng đầu danh sách nằm một phần sau tiêu đề dính và không có chỗ nào để cuộn lên nữa. Cuộn lên
     số âm là không cuộn gì cả, nên đừng bắt trình duyệt làm. */
  it("gives up rather than scrolling past the top of the list", () => {
    expect(scrollTopFor({ top: 10, height: 50 }, view, HEADER)).toBeNull();
  });
});
