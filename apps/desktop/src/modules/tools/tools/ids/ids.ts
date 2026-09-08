export type IdKind = "uuidv4" | "uuidv7" | "ulid" | "nanoid";

export const ID_KINDS: IdKind[] = ["uuidv4", "uuidv7", "ulid", "nanoid"];

/** Số byte ngẫu nhiên mỗi kiểu cần. Panel xin đúng chừng này từ `crypto.getRandomValues`. */
export const RANDOM_BYTES: Record<IdKind, number> = {
  uuidv4: 16,
  uuidv7: 10,
  ulid: 16,
  nanoid: 21,
};

const hex = (b: Uint8Array) => Array.from(b, (n) => n.toString(16).padStart(2, "0")).join("");

const dash = (h: string) =>
  `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;

/*
 * Mọi hàm ở đây nhận `now` và `rnd` làm tham số thay vì tự gọi `Date.now()` và
 * `crypto.getRandomValues()`. Đó là lý do chúng test được — và cũng là lý do test khẳng định được
 * cái quan trọng nhất của v7 với ULID: sắp theo chuỗi là sắp theo thời gian.
 */

export function uuidv4(rnd: Uint8Array): string {
  const b = rnd.slice(0, 16);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  return dash(hex(b));
}

export function uuidv7(now: number, rnd: Uint8Array): string {
  const b = new Uint8Array(16);
  // 48 bit thời gian ở đầu, big-endian — đó là thứ làm v7 sắp được theo thời gian.
  for (let i = 0; i < 6; i++) b[i] = Math.floor(now / 2 ** (8 * (5 - i))) & 0xff;
  b.set(rnd.slice(0, 10), 6);
  b[6] = (b[6] & 0x0f) | 0x70;
  b[8] = (b[8] & 0x3f) | 0x80;
  return dash(hex(b));
}

/** Bảng chữ Crockford base32: không có I, L, O, U — những chữ dễ đọc nhầm thành chữ số. */
const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export function ulid(now: number, rnd: Uint8Array): string {
  let time = "";
  let left = now;
  for (let i = 0; i < 10; i++) {
    time = CROCKFORD[left % 32] + time;
    left = Math.floor(left / 32);
  }
  // 256 chia hết cho 32, nên `& 31` trên một byte là phân bố đều — không có lệch nào phải sửa.
  let random = "";
  for (let i = 0; i < 16; i++) random += CROCKFORD[rnd[i] & 31];
  return time + random;
}

const NANO_ALPHABET = "useandom-26T198340PX75pxJACKVERYMINDBUSHWOLF_GQZbfghjklqvwyzrict";

export function nanoid(rnd: Uint8Array): string {
  let out = "";
  for (let i = 0; i < rnd.length; i++) out += NANO_ALPHABET[rnd[i] & 63];
  return out;
}
