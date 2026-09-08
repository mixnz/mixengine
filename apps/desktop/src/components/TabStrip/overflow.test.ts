import { describe, expect, it } from "vitest";
import { overflowState, scrollStep } from "./overflow";

describe("overflowState", () => {
  it("says nothing is hidden when every tab fits", () => {
    expect(overflowState({ scrollLeft: 0, scrollWidth: 400, clientWidth: 400 })).toEqual({
      overflowing: false,
      atStart: true,
      atEnd: true,
    });
  });

  it("marks the far left as the start, with tabs hidden to the right", () => {
    expect(overflowState({ scrollLeft: 0, scrollWidth: 900, clientWidth: 400 })).toEqual({
      overflowing: true,
      atStart: true,
      atEnd: false,
    });
  });

  it("marks the far right as the end, with tabs hidden to the left", () => {
    expect(overflowState({ scrollLeft: 500, scrollWidth: 900, clientWidth: 400 })).toEqual({
      overflowing: true,
      atStart: false,
      atEnd: true,
    });
  });

  it("sees tabs hidden both ways in the middle", () => {
    expect(overflowState({ scrollLeft: 250, scrollWidth: 900, clientWidth: 400 })).toEqual({
      overflowing: true,
      atStart: false,
      atEnd: false,
    });
  });

  /* `scrollWidth` và `clientWidth` là số nguyên đã làm tròn còn `scrollLeft` thì không, nên một
     dải tab cuộn hết cỡ vẫn hay đứng cách mép cuối một phần pixel. Gọi phần ấy là "còn tab bị ẩn"
     là để một mũi tên sáng lên mà bấm vào không đi đâu cả. */
  it("does not call a fraction of a pixel a hidden tab", () => {
    expect(overflowState({ scrollLeft: 499.6, scrollWidth: 900, clientWidth: 400 }).atEnd).toBe(true);
    expect(overflowState({ scrollLeft: 0.4, scrollWidth: 900, clientWidth: 400 }).atStart).toBe(true);
    expect(overflowState({ scrollLeft: 0, scrollWidth: 401, clientWidth: 400 }).overflowing).toBe(false);
  });
});

describe("scrollStep", () => {
  /* Gần một khung, chừa lại một phần để mắt còn bắt được chỗ vừa rời đi — bấm một cái nhảy trọn
     một khung thì không biết mình đang ở đâu nữa. */
  it("moves most of a screenful", () => {
    expect(scrollStep(400)).toBe(320);
  });

  it("still moves a strip narrower than a single tab", () => {
    expect(scrollStep(0)).toBe(1);
  });
});
