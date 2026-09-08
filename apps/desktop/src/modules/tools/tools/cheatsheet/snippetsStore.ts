import { createStore, jsonFile, useStore } from "../../../../core/jsonStore";
import { readSnippets, type Snippet } from "./snippets";

/**
 * Snippet do người dùng viết, còn lại giữa các phiên.
 *
 * **Chỉ template, không bao giờ giá trị tham số.** Giá trị sống trong state của tab rồi mất khi
 * đóng tab, như mọi tool khác trong module — và đó là chỗ mật khẩu đi qua. Ngoại lệ "cheatsheet
 * được lưu" của spec mẹ nằm gọn trong luật "không lưu nội dung người dùng gõ" đúng vì thế: thứ
 * được lưu là cái khuôn, không phải cái đổ vào khuôn.
 *
 * Bộ sẵn có không nằm ở đây — nó là hằng số trong `builtin.ts`.
 */

const DEFAULTS: Snippet[] = [];

/* Bộ kiểm shape nằm ở `snippets.ts` chứ không ở đây: nó là phần thuần, và phần thuần là phần test
   được. File này chỉ còn phần nối vào đĩa, thứ không có gì để test. */
const file = jsonFile<unknown>("tools-snippets.json", "snippets", DEFAULTS);
const store = createStore<Snippet[]>({
  defaults: DEFAULTS,
  load: async () => readSnippets(await file.load()),
  persist: file.persist,
});

export function useSnippets(): Snippet[] {
  return useStore(store);
}

/** Ghi ngầm phía sau. Một snippet không kịp xuống đĩa là một snippet mất, và đó là điều đáng tiếc
 *  chứ không đáng một hộp thoại lỗi chắn ngang màn hình. */
export function saveSnippets(next: Snippet[]): void {
  void store.save(next).catch(() => {});
}
