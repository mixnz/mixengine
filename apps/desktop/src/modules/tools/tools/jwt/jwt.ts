import { base64ToText } from "../encode/encode";

export interface JwtParts {
  header: unknown;
  payload: unknown;
  /** Nguyên trạng, chưa giải mã. Nó không được kiểm chứng — xem chú thích của `decodeJwt`. */
  signature: string;
}

export type JwtResult =
  | { ok: true; parts: JwtParts }
  | { ok: false; reason: "shape" | "base64" | "json" };

export interface JwtTimes {
  exp?: number;
  iat?: number;
  nbf?: number;
  /** `null` khi payload không có `exp` — "không biết" khác "còn hạn". */
  expired: boolean | null;
}

/**
 * Tách một JWT ra ba phần và đọc hai phần đầu.
 *
 * Trả về kết quả thay vì ném: ba lý do hỏng cần ba câu khác nhau trên màn hình, và một `catch`
 * gộp chung sẽ không phân biệt được base64 hỏng với JSON hỏng.
 *
 * **Không kiểm chữ ký.** Cần secret, và một chữ "hợp lệ" sai thì nguy hiểm hơn im lặng.
 */
export function decodeJwt(token: string): JwtResult {
  const parts = token.trim().split(".");
  if (parts.length !== 3 || parts.some((part) => part === "")) return { ok: false, reason: "shape" };

  let headerText: string;
  let payloadText: string;
  try {
    headerText = base64ToText(parts[0]);
    payloadText = base64ToText(parts[1]);
  } catch {
    return { ok: false, reason: "base64" };
  }

  try {
    return {
      ok: true,
      parts: {
        header: JSON.parse(headerText),
        payload: JSON.parse(payloadText),
        signature: parts[2],
      },
    };
  } catch {
    return { ok: false, reason: "json" };
  }
}

const numberClaim = (payload: Record<string, unknown>, key: string): number | undefined =>
  typeof payload[key] === "number" ? (payload[key] as number) : undefined;

/** `now` tính bằng mili; `exp`/`iat`/`nbf` của JWT tính bằng giây. */
export function claimTimes(payload: unknown, now: number): JwtTimes {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    return { expired: null };
  }
  const claims = payload as Record<string, unknown>;
  const exp = numberClaim(claims, "exp");
  return {
    exp,
    iat: numberClaim(claims, "iat"),
    nbf: numberClaim(claims, "nbf"),
    expired: exp === undefined ? null : exp * 1000 < now,
  };
}
