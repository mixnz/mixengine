import { describe, expect, it } from "vitest";

import { eventArrived, noReadsYet, readBegan, readLanded } from "./readOrder";

describe("readLanded", () => {
  /* Đúng bug "Stop all rồi một service kẹt ở Đang tắt": hai `reload()` chạy song song, cái khởi
     hành trước đọc được trạng thái cũ, và nếu response của nó về sau thì nó ghi đè snapshot mới.
     Bảng đứng lại ở `stopping` cho tới khi có người bấm Làm mới. */
  it("refuses a snapshot that started before one already applied", () => {
    const first = readBegan(noReadsYet());
    const second = readBegan(first.order);

    const newer = readLanded(second.order, second.seq);
    expect(newer.apply).toBe(true);

    const older = readLanded(newer.order, first.seq);
    expect(older.apply).toBe(false);
  });
});

describe("eventArrived", () => {
  /* Một sự kiện bay tới trong lúc `service.list` đang trên đường về mang tin từ *trước* lúc daemon
     đọc danh sách — client không có cách nào phân biệt nó với một tin mới hơn. Nên snapshot vừa
     đáp không còn đáng tin một mình: phải đọc thêm một lần nữa. Không có bước này thì một
     `stopping` tới trễ ghi đè `stopped`, và vì `stopped` là chuyển trạng thái cuối, không còn sự
     kiện nào sửa lại nó. */
  it("asks for one more read when an event landed mid-flight", () => {
    const started = readBegan(noReadsYet());
    const raced = eventArrived(started.order);

    const landed = readLanded(raced, started.seq);
    expect(landed.apply).toBe(true);
    expect(landed.readAgain).toBe(true);
  });

  /* Một sự kiện lúc không có `reload` nào đang bay thì không có gì để đua: hàng đã đổi theo stream
     và đó là câu trả lời đúng. Đọc lại ở đây là biến mỗi lần bấm Start thành một lượt RPC thừa. */
  it("does not ask for a read when no read was in flight", () => {
    const quiet = eventArrived(noReadsYet());
    const started = readBegan(quiet);
    expect(readLanded(started.order, started.seq).readAgain).toBe(false);
  });

  /* Hai `reload` cùng bay (quay lại tab đúng lúc một `resync` tới) và một sự kiện chen vào giữa:
     chỉ **một** lượt đọc thêm được xin, lúc cái cuối cùng đáp. Xin mỗi lần một cái đáp là biến một
     sự kiện thành N lượt RPC, và mỗi lượt đó lại là một cửa sổ cho sự kiện kế chen vào. */
  it("asks for exactly one more read however many were in flight", () => {
    const first = readBegan(noReadsYet());
    const second = readBegan(first.order);
    const raced = eventArrived(second.order);

    const firstLanded = readLanded(raced, first.seq);
    expect(firstLanded.readAgain).toBe(false);

    const secondLanded = readLanded(firstLanded.order, second.seq);
    expect(secondLanded.readAgain).toBe(true);

    /* Và lượt đọc thêm đó, nếu không có sự kiện nào nữa, không sinh ra lượt thứ ba. */
    const again = readBegan(secondLanded.order);
    expect(readLanded(again.order, again.seq).readAgain).toBe(false);
  });
});
