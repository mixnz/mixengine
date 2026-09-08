/**
 * Những thao tác đang chờ quyền quản trị, đọc ra khỏi một sự kiện hoặc khỏi `elevation.status`.
 *
 * `elevation_required` mang **mọi** thao tác đang chờ, cũ nhất trước, mỗi cái kèm thứ nó sẽ đổi
 * cụ thể. UI hiện danh sách đó rồi mới gọi `elevation.grant`, thứ bật đúng một prompt cho cả lô.
 * Từ chối là một kết cục API mô hình hóa được, không phải một lỗi; `elevation.drop` là đường ra.
 *
 * Daemon **không bao giờ** tự bật prompt — chỉ client gọi `grant`. Đó chính là thứ làm cho "giải
 * thích trước khi xin" nói ra được thay vì là thứ phải sắp xếp sau.
 */

/** Một hàng của danh sách, đã rút gọn để vẽ. */
export interface DescribedOp {
  /** Loại thao tác — một trong 13 biến thể của `PrivilegedOp`. */
  kind: string;
  /** Câu daemon tự viết cho người đọc. Rỗng khi không có. */
  description: string;
  /** Đúng những gì nó sẽ đổi. Không dịch: đây là đường dẫn, địa chỉ và cổng thật. */
  detail: string;
}

/** `pending` của một `elevation_required`, hoặc `null` khi message nói về chuyện khác. */
export function pendingFrom(raw: string): unknown[] | null {
  try {
    const event = JSON.parse(raw) as { type?: unknown; pending?: unknown };
    if (event.type !== "elevation_required") return null;
    // Một lô rỗng vẫn là một câu trả lời: nó nghĩa là không còn gì chờ.
    return Array.isArray(event.pending) ? event.pending : [];
  } catch {
    return null;
  }
}

/**
 * Một `PendingOp` thành ba chuỗi để vẽ.
 *
 * **`PendingOp` bọc `PrivilegedOp`, không phải là nó.** Hình dạng thật là
 * `{ id, op: PrivilegedOp, description, requested_at }` — nên loại thao tác nằm ở `op.op`, một
 * tầng sâu hơn chỗ dễ đoán. Đọc nhầm tầng thì mọi hàng hiện `unknown`, và người dùng được mời cho
 * phép một danh sách không nói gì.
 *
 * `description` là câu daemon tự viết. Ưu tiên nó: nó là lời của bên biết thao tác đó làm gì, và
 * viết lại nó ở đây là MixDB tự bịa ra một lời giải thích thứ hai.
 */
export function describeOp(pending: unknown): DescribedOp {
  const row = (pending ?? {}) as { op?: unknown; description?: unknown };
  const description = typeof row.description === "string" ? row.description : "";

  const op = (row.op ?? {}) as {
    op?: unknown;
    entries?: unknown;
    plan?: unknown;
    target?: unknown;
  };
  const kind = typeof op.op === "string" ? op.op : "unknown";

  if (kind === "hosts-apply" && Array.isArray(op.entries)) {
    const lines = op.entries
      .map((entry) => {
        const line = entry as { address?: unknown; name?: unknown };
        return `${String(line.address ?? "")} ${String(line.name ?? "")}`.trim();
      })
      .filter(Boolean);
    return { kind, description, detail: lines.join("\n") };
  }

  // `TrustPlan.der` là chứng chỉ DER trần — vài trăm số, một dòng một số khi qua
  // `JSON.stringify(..., null, 2)`. Chỉ nói kích thước, không đổ nguyên mảng.
  if (kind === "trust-ca-install") {
    const plan = op.plan as { method?: unknown; der?: unknown } | undefined;
    const method = typeof plan?.method === "string" ? plan.method : "";
    const bytes = Array.isArray(plan?.der) ? plan.der.length : 0;
    return { kind, description, detail: [method, `${bytes} bytes (DER)`].filter(Boolean).join("\n") };
  }

  // Mọi biến thể còn lại hiện nguyên hình dạng của nó. Một thao tác không có lời lẽ riêng vẫn phải
  // hiện ra: giấu nó đi là xin quyền cho một thứ người dùng không được xem.
  const extra = op.plan ?? op.target;
  return {
    kind,
    description,
    detail: extra === undefined ? "" : JSON.stringify(extra, null, 2),
  };
}
