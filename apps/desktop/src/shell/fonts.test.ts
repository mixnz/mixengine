import { describe, expect, it } from "vitest";
import appCss from "./App.css?raw";

/**
 * Hai vai của chữ, khẳng định trên chính stylesheet.
 *
 * Không có gì để render ở đây, và không có gì trong này thấy được khi review. Trước đợt token này
 * `var(--font-mono)` đã được dùng ở bốn chỗ mà chưa bao giờ được định nghĩa: ba chỗ có `, monospace`
 * đỡ phía sau, chỗ thứ tư không có, nên rule của nó vô hiệu và chữ rơi về font kế thừa từ `:root`
 * — vốn tình cờ cũng là Fira Code. Nó đúng nhờ tai nạn, và cái tai nạn đó biến mất đúng lúc `:root`
 * chuyển sang sans. Triệu chứng duy nhất là một dialog đổi font, nên nó được khẳng định ở đây.
 *
 * `?raw` chỉ trả về nội dung thật vì `vite.config.ts` bật `test.css`: mặc định Vitest stub mọi
 * `.css` thành chuỗi rỗng, kể cả qua `?raw`. Đó là lý do case đầu tiên bên dưới tồn tại — một test
 * parse chuỗi rỗng thì xanh mà chưa đọc dòng nào, và `glass.test.ts` đã xanh đúng như thế suốt từ
 * ngày nó được viết.
 */

/** Mọi stylesheet dưới `src/`. `App.css` nằm trong đó và được lọc ra ở chỗ cần. */
const sheets = import.meta.glob("../**/*.css", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

describe("font tokens", () => {
  it("đọc được stylesheet, không phải một mớ rỗng", () => {
    const values = Object.values(sheets);
    expect(values.length).toBeGreaterThan(40);
    expect(values.every((css) => css.length > 0)).toBe(true);
    expect(appCss).toContain(":root");
  });

  it("định nghĩa cả hai vai trên :root", () => {
    expect(appCss).toMatch(/--font-ui:\s*[^;]+;/);
    expect(appCss).toMatch(/--font-mono:\s*[^;]+;/);
  });

  it("không stylesheet nào gọi tên font ngoài chỗ định nghĩa token", () => {
    const offenders = Object.entries(sheets)
      .filter(([path]) => !path.endsWith("/App.css"))
      .filter(([, css]) => /font-family:[^;]*(Fira Code|system-ui|sans-serif|monospace)/.test(css))
      .map(([path]) => path);
    expect(offenders).toEqual([]);
  });

  it("mọi var(--font-*) được dùng đều có định nghĩa", () => {
    const defined = new Set([...appCss.matchAll(/(--font-[\w-]+):/g)].map(([, name]) => name));
    const used = new Set(
      Object.values(sheets).flatMap((css) =>
        [...css.matchAll(/var\((--font-[\w-]+)/g)].map(([, name]) => name),
      ),
    );
    expect([...used].filter((name) => !defined.has(name))).toEqual([]);
  });
});
