import {
  addSavedTarget,
  loadSavedTargets,
  removeSavedTarget,
  updateSavedTarget,
} from "./savedTargets";
import type { SavedTarget } from "./types";
import { createStore, useStore, useStoreLoaded } from "../../core/jsonStore";

/**
 * Danh sách đích đã lưu, dùng chung bởi mọi tab.
 *
 * Đọc một lần: mỗi tab tự đọc thì mỗi tab tốn một lượt đọc file cộng một lượt hỏi kho thông tin
 * đăng nhập cho mỗi máy chủ, và một đích lưu ở tab này sẽ không thấy ở tab kia cho tới lần mở app
 * sau. Danh sách là một thứ trên đĩa, nên nó là một thứ trong bộ nhớ.
 *
 * Cơ chế nằm ở `core/jsonStore.ts` — đọc một lần, thay cả cụm, `loaded` tách khỏi giá trị. Ở đây
 * chỉ còn phần riêng của danh sách này: nó không tự đọc file, mà đi qua `savedTargets.ts`, nơi giữ
 * ranh giới giữa `terminal-hosts.json` và kho thông tin đăng nhập của hệ điều hành.
 */

/* Không có `persist`: mọi lượt ghi đi qua `savedTargets.ts`, thứ vừa ghi vừa trả về danh sách mới.
   Ảnh chụp là cái nó trả về, không phải cái store tự dựng lấy. */
const store = createStore<SavedTarget[]>({ defaults: [], load: loadSavedTargets });

/** Danh sách dùng chung, giữ đồng bộ giữa mọi tab gọi nó. */
export function useSavedTargets(): SavedTarget[] {
  return useStore(store);
}

/** Đã đọc xong file chưa. Danh sách rỗng lúc chưa đọc và danh sách rỗng khi không có đích nào là
 *  hai thứ khác nhau, mà nhìn vào danh sách thì không phân biệt được. Ai coi "không có trong danh
 *  sách" là "đã bị xoá" — một tab đang khôi phục đích nó mở dở — phải hỏi cái này trước. */
export function useSavedTargetsLoaded(): boolean {
  return useStoreLoaded(store);
}

/* Ghi thì đi qua module vẫn ghi từ trước — nó là chỗ giữ ranh giới giữa `terminal-hosts.json` và
   kho thông tin đăng nhập — và danh sách nó trả về thành ảnh chụp mới. */

export async function addTarget(target: SavedTarget): Promise<void> {
  store.publish(await addSavedTarget(target));
}

export async function updateTarget(target: SavedTarget): Promise<void> {
  store.publish(await updateSavedTarget(target));
}

export async function removeTarget(id: string): Promise<void> {
  store.publish(await removeSavedTarget(id));
}
