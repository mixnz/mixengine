import { describe, expect, it } from "vitest";
import { nanoid, ulid, uuidv4, uuidv7 } from "./ids";

const bytes = (fill: number, length: number) => new Uint8Array(length).fill(fill);

describe("uuidv4", () => {
  it("đặt đúng version và variant", () => {
    const id = uuidv4(bytes(0xff, 16));
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

describe("uuidv7", () => {
  it("đặt đúng version và variant", () => {
    const id = uuidv7(Date.parse("2026-08-28T00:00:00Z"), bytes(0x00, 10));
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("mã hoá thời gian ở 48 bit đầu, nên sắp chuỗi là sắp theo thời gian", () => {
    const early = uuidv7(1_000_000_000_000, bytes(0xff, 10));
    const late = uuidv7(1_000_000_001_000, bytes(0x00, 10));
    expect(early < late).toBe(true);
  });
});

describe("ulid", () => {
  it("dài 26 ký tự và chỉ dùng bảng chữ Crockford", () => {
    const id = ulid(Date.parse("2026-08-28T00:00:00Z"), bytes(0x00, 16));
    expect(id).toHaveLength(26);
    expect(id).toMatch(/^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{26}$/);
  });

  it("sắp chuỗi là sắp theo thời gian", () => {
    expect(ulid(1_000_000_000_000, bytes(0xff, 16)) < ulid(1_000_000_001_000, bytes(0x00, 16))).toBe(
      true,
    );
  });
});

describe("nanoid", () => {
  it("một byte thành một ký tự, trong bảng chữ của nanoid", () => {
    const id = nanoid(bytes(0x00, 21));
    expect(id).toHaveLength(21);
    expect(id).toMatch(/^[A-Za-z0-9_-]{21}$/);
  });
});
