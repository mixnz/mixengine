import { describe, expect, it } from "vitest";

import { resolve } from "../../../i18n";
import { EN, VI } from "../../../i18n/dicts";

/**
 * Cổng vào tab khi không tìm thấy daemon in ra chỗ nó đã tìm — T111.
 *
 * `MixEngineTab` gọi `t("mixengine.gate.notInstalled", { searched })`, và `interpolate` chỉ thay
 * `{{searched}}`. Một bản dịch đánh rơi chỗ giữ chỗ ấy không làm hỏng build và không làm hỏng test
 * nào khác: nó chỉ lặng lẽ giấu mất câu trả lời mà cả màn hình này tồn tại để đưa ra. Đây là chỗ
 * duy nhất nói không.
 */
describe("the not-installed gate", () => {
  it("carries in every language the placeholder the tab fills with where it looked", () => {
    for (const dict of [EN, VI]) {
      expect(resolve(dict, "mixengine.gate.notInstalled")).toContain("{{searched}}");
    }
  });
});
