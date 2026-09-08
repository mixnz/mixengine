/**
 * MD5, vì `crypto.subtle` cố tình không có nó và ta vẫn cần: `MD5()` của MySQL và checksum của
 * gần như mọi bản tải về đều là nó. Bảy chục dòng không đáng để kéo một thư viện về.
 *
 * MD5 **không an toàn cho mật khẩu**. Nó ở đây để đối chiếu và để đọc dữ liệu có sẵn, không phải
 * để sinh ra cái gì mới.
 */

/* Số bit dịch trái mỗi vòng, và bảng hằng K[i] = floor(|sin(i+1)| * 2^32) — cả hai lấy từ RFC 1321. */
const S = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14,
  20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6,
  10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];

const K = new Uint32Array(64);
for (let i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32);

/** Một word 32-bit thành 8 chữ hex, little-endian — MD5 in ra theo thứ tự byte ngược. */
function hexLE(word: number): string {
  let out = "";
  for (let i = 0; i < 4; i++) out += ((word >>> (i * 8)) & 0xff).toString(16).padStart(2, "0");
  return out;
}

export function md5(bytes: Uint8Array): string {
  const len = bytes.length;
  // Đệm tới bội của 64 byte, chừa 8 byte cuối cho độ dài tính bằng bit.
  const padded = new Uint8Array((((len + 8) >> 6) + 1) << 6);
  padded.set(bytes);
  padded[len] = 0x80;

  const view = new DataView(padded.buffer);
  const bits = len * 8;
  view.setUint32(padded.length - 8, bits >>> 0, true);
  view.setUint32(padded.length - 4, Math.floor(bits / 2 ** 32), true);

  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;

  for (let offset = 0; offset < padded.length; offset += 64) {
    const M = new Uint32Array(16);
    for (let i = 0; i < 16; i++) M[i] = view.getUint32(offset + i * 4, true);

    let A = a0;
    let B = b0;
    let C = c0;
    let D = d0;

    for (let i = 0; i < 64; i++) {
      let F: number;
      let g: number;
      if (i < 16) {
        F = (B & C) | (~B & D);
        g = i;
      } else if (i < 32) {
        F = (D & B) | (~D & C);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        F = B ^ C ^ D;
        g = (3 * i + 5) % 16;
      } else {
        F = C ^ (B | ~D);
        g = (7 * i) % 16;
      }

      F = (F + A + K[i] + M[g]) >>> 0;
      A = D;
      D = C;
      C = B;
      B = (B + ((F << S[i]) | (F >>> (32 - S[i])))) >>> 0;
    }

    a0 = (a0 + A) >>> 0;
    b0 = (b0 + B) >>> 0;
    c0 = (c0 + C) >>> 0;
    d0 = (d0 + D) >>> 0;
  }

  return hexLE(a0) + hexLE(b0) + hexLE(c0) + hexLE(d0);
}
