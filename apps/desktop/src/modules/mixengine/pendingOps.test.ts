import { describe, expect, it } from "vitest";

import { describeOp, pendingFrom } from "./pendingOps";

/** Đúng hình dạng daemon gửi: `PendingOp` bọc `PrivilegedOp` trong field `op`. */
const hostsApply = {
  id: 7,
  requested_at: 1788651901982,
  description: "Add 1 name to the hosts file",
  op: { op: "hosts-apply", entries: [{ address: "127.0.0.1", name: "blog.test" }] },
};

describe("pendingFrom", () => {
  it("takes the whole queue out of the event", () => {
    const raw = JSON.stringify({
      type: "elevation_required",
      pending: [hostsApply, { id: 8, op: { op: "trust-ca-install" }, description: "Trust the CA" }],
    });
    expect(pendingFrom(raw)).toHaveLength(2);
  });

  /* Một lô rỗng vẫn là một `elevation_required`: nó nghĩa là "không còn gì chờ", khác hẳn "sự
     kiện này không nói về quyền quản trị". */
  it("tells an empty queue from an event about something else", () => {
    expect(pendingFrom(JSON.stringify({ type: "elevation_required", pending: [] }))).toEqual([]);
    expect(pendingFrom(JSON.stringify({ type: "resync", missed: 1 }))).toBeNull();
    expect(pendingFrom("not json")).toBeNull();
  });
});

describe("describeOp", () => {
  /* Loại thao tác nằm ở `op.op`, một tầng sâu hơn chỗ dễ đoán. Đọc nhầm tầng thì mọi hàng hiện
     `unknown` và người dùng được mời cho phép một danh sách không nói gì. */
  it("reads the kind out of the op the pending entry wraps", () => {
    expect(describeOp(hostsApply).kind).toBe("hosts-apply");
  });

  /* Câu của daemon là lời của bên biết thao tác đó làm gì. Viết lại nó ở MixDB là bịa ra một lời
     giải thích thứ hai. */
  it("carries the daemon's own sentence", () => {
    expect(describeOp(hostsApply).description).toBe("Add 1 name to the hosts file");
  });

  it("names the hosts lines it would write", () => {
    const detail = describeOp(hostsApply).detail;
    expect(detail).toContain("blog.test");
    expect(detail).toContain("127.0.0.1");
  });

  /* 13 biến thể, và một cái chưa biết vẫn phải hiện ra — giấu nó đi là xin quyền cho một thao tác
     người dùng không được xem. */
  it("still describes an op it has no special wording for", () => {
    expect(describeOp({ id: 1, op: { op: "audit-log-remove" } }).kind).toBe("audit-log-remove");
    expect(describeOp({}).kind).toBe("unknown");
    expect(describeOp(null).kind).toBe("unknown");
    expect(describeOp(null).description).toBe("");
  });

  /* `TrustPlan.der` là chứng chỉ DER trần — vài trăm số, mỗi số một dòng khi đổ nguyên qua
     `JSON.stringify`. Hộp thoại phải nói kích thước, không đổ cả mảng ra màn hình. */
  it("summarises a certificate's DER instead of dumping every byte", () => {
    const der = Array.from({ length: 402 }, (_, i) => i % 256);
    const described = describeOp({
      id: 3,
      op: { op: "trust-ca-install", plan: { method: "system-root", der } },
    });
    expect(described.detail).toBe("system-root\n402 bytes (DER)");
    expect(described.detail).not.toContain("[");
  });

  it("shows a plan or a target as it came", () => {
    const described = describeOp({ id: 2, op: { op: "port-access-grant", plan: { port: 443 } } });
    expect(described.detail).toContain("443");
  });

  /* Ghim đúng cái lỗi đã mắc: một `PrivilegedOp` trần — tầng bên trong — không phải thứ đi trên
     wire, và đọc nó như thể nó là `PendingOp` cho ra `unknown`. */
  it("does not mistake a bare privileged op for a pending entry", () => {
    expect(describeOp({ op: "hosts-apply", entries: [] }).kind).toBe("unknown");
  });
});
