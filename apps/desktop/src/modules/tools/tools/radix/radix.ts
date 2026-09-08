/**
 * Đổi qua lại giữa nhị phân, bát phân, thập phân và thập lục — bằng `bigint` xuyên suốt, không
 * `Number`.
 *
 * ID kiểu bigint hay snowflake trong DB thường vượt `Number.MAX_SAFE_INTEGER`; `parseInt`/`Number`
 * làm tròn sai ở đó mà không báo lỗi. `bigint` thì không có trần.
 */

export type Base = "bin" | "oct" | "dec" | "hex";

export const BASES: Base[] = ["bin", "oct", "dec", "hex"];

const RADIX: Record<Base, number> = { bin: 2, oct: 8, dec: 10, hex: 16 };

const CHARSET: Record<Base, RegExp> = {
  bin: /^[01]+$/,
  oct: /^[0-7]+$/,
  dec: /^[0-9]+$/,
  hex: /^[0-9a-fA-F]+$/,
};

const PREFIX: Record<Exclude<Base, "dec">, RegExp> = {
  bin: /^0[bB]/,
  oct: /^0[oO]/,
  hex: /^0[xX]/,
};

const HEX_DIGITS = "0123456789abcdef";

/** `BigInt(string)` không nhận cả tiền tố lẫn dấu trừ cùng lúc, nên đây tự cộng dồn theo hệ số. */
function magnitudeToBigInt(digits: string, base: Base): bigint {
  const radix = BigInt(RADIX[base]);
  let value = 0n;
  for (const ch of digits.toLowerCase()) {
    value = value * radix + BigInt(HEX_DIGITS.indexOf(ch));
  }
  return value;
}

/** Soi tiền tố (`0x`/`0b`/`0o`) trước, thập phân là hệ mặc định khi không có tiền tố nào khớp. */
export function detectBase(input: string): Base | null {
  const trimmed = input.trim();
  const body = trimmed.startsWith("-") ? trimmed.slice(1) : trimmed;
  if (body === "") return null;
  if (PREFIX.hex.test(body) && CHARSET.hex.test(body.slice(2))) return "hex";
  if (PREFIX.bin.test(body) && CHARSET.bin.test(body.slice(2))) return "bin";
  if (PREFIX.oct.test(body) && CHARSET.oct.test(body.slice(2))) return "oct";
  if (CHARSET.dec.test(body)) return "dec";
  return null;
}

/** Số âm chỉ được đọc ở thập phân — hệ khác không có quy ước hai's complement ở đây. */
export function parseValue(input: string, base: Base): bigint | null {
  const trimmed = input.trim();
  if (trimmed === "" || trimmed === "-") return null;
  const negative = trimmed.startsWith("-");
  const rest = negative ? trimmed.slice(1) : trimmed;
  if (negative && base !== "dec") return null;
  const digits = base === "dec" ? rest : rest.replace(PREFIX[base as Exclude<Base, "dec">] ?? /^$/, "");
  if (digits === "" || !CHARSET[base].test(digits)) return null;
  const magnitude = magnitudeToBigInt(digits, base);
  return negative ? -magnitude : magnitude;
}

export interface RadixOutputs {
  bin: string;
  oct: string;
  dec: string;
  hex: string;
}

/** Nhóm 4 kí tự một từ bên phải sang, phần lẻ (nếu có) nằm ở nhóm đầu tiên bên trái. */
function groupBinary(digits: string): string {
  const chunks: string[] = [];
  let end = digits.length;
  while (end > 0) {
    const start = Math.max(0, end - 4);
    chunks.unshift(digits.slice(start, end));
    end = start;
  }
  return chunks.join(" ");
}

export function formatOutputs(value: bigint): RadixOutputs {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const sign = negative ? "-" : "";
  return {
    bin: sign + groupBinary(abs.toString(2)),
    oct: sign + abs.toString(8),
    dec: value.toString(10),
    hex: sign + "0x" + abs.toString(16),
  };
}
