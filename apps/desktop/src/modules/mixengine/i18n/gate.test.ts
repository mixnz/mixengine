import { describe, expect, it } from "vitest";

import { resolve } from "../../../i18n";
import { EN, VI } from "../../../i18n/dicts";

/**
 * Cổng vào tab khi không tìm thấy daemon nói ra chỗ nó đã tìm — T111.
 *
 * `VI` không được khai kiểu theo `EN` trong `i18n/dicts.ts`, nên một khoá có bên này mà thiếu bên
 * kia là thứ `tsc` không nói gì cả: `resolve` trả về chính chuỗi khoá, và người dùng tiếng Việt
 * nhìn thấy `mixengine.gate.lookedIn` giữa màn hình. Đây là chỗ duy nhất nói không.
 */
describe("the not-installed gate", () => {
  it("labels the list of directories in every language", () => {
    for (const dict of [EN, VI]) {
      const label = resolve(dict, "mixengine.gate.lookedIn");

      expect(label).not.toBe("mixengine.gate.lookedIn");
      expect(label.trim()).not.toBe("");
    }
  });

  /* Danh sách là một `<ul>` và không còn nội suy vào câu, nên câu không được mang chỗ giữ chỗ nào:
     một `{{searched}}` sót lại sẽ in ra đúng như thế, vì không ai truyền biến cho nó nữa. */
  it("states the fault in a sentence with nothing left to interpolate", () => {
    for (const dict of [EN, VI]) {
      expect(resolve(dict, "mixengine.gate.notInstalled")).not.toContain("{{");
    }
  });
});
