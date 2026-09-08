/**
 * Font nào trong danh sách thật sự có trên máy này.
 *
 * Không có API nào hỏi thẳng được. `document.fonts.check` thì trả `true` cho cả những tên không
 * tồn tại, còn `queryLocalFonts` đòi một lượt xin phép mà app không có chỗ nào để hỏi. Nên cách
 * duy nhất còn lại là cách mọi người vẫn dùng: đo một chuỗi mẫu bằng font ấy, rồi so với chính
 * chuỗi ấy đo bằng font dự phòng. Bằng nhau nghĩa là trình duyệt đã rơi về dự phòng — font không
 * có ở đây.
 *
 * Ba font dự phòng chứ không một: một font đơn cách có thể rộng đúng bằng `monospace` mặc định
 * của máy — nó *là* cái ấy — nhưng gần như không bao giờ rộng bằng cả `serif` lẫn `sans-serif`.
 *
 * Ở đây chứ không trong `fonts.ts` vì nó cần canvas; `fonts.ts` giữ phần quy tắc thuần mà test
 * với tới được.
 */

/** Trộn chữ hẹp với chữ rộng: hai font khác nhau khó lòng ra cùng một bề rộng cho cả cụm. */
const PROBE_TEXT = "mmmmmmmmmmlliWW0O";

/** To hẳn lên: mỗi khác biệt nhỏ về hình chữ thành vài pixel thay vì một phần pixel bị làm tròn. */
const PROBE_SIZE = 72;

const FALLBACKS = ["monospace", "serif", "sans-serif"] as const;

export async function installedFonts(candidates: readonly string[]): Promise<string[]> {
  /* Đợi font tải xong trước khi đo. Fira Code không phải font hệ thống mà là webfont đóng kèm app
     — xem `main.tsx` — nên đo sớm một nhịp là trình duyệt còn đang dùng font dự phòng, và cái font
     mặc định của chính terminal bị kết luận là "máy không có". */
  await document.fonts.ready;
  const ctx = document.createElement("canvas").getContext("2d");
  // Không đo được thì đừng đoán: trả danh sách rỗng, và hộp chọn sẽ chỉ còn font đang dùng.
  if (!ctx) return [];

  const baseline = FALLBACKS.map((fallback) => {
    ctx.font = `${PROBE_SIZE}px ${fallback}`;
    return ctx.measureText(PROBE_TEXT).width;
  });

  return candidates.filter((name) =>
    FALLBACKS.some((fallback, i) => {
      ctx.font = `${PROBE_SIZE}px "${name}", ${fallback}`;
      return ctx.measureText(PROBE_TEXT).width !== baseline[i];
    }),
  );
}
