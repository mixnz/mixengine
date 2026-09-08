import type { RegexRun } from "./match";
import type { RegexRequest } from "./worker";

/**
 * Chạy regex trong một Worker, có hạn giờ.
 *
 * `(a+)+$` gặp một chuỗi 30 ký tự là vòng lặp không lối ra. Trên luồng chính thì đó là mất cả cửa
 * sổ app — không phải một tool chậm, mà một cửa sổ không vẽ lại được nữa. Đây là tool duy nhất
 * trong module mà đầu vào của người dùng làm được việc đó, nên là tool duy nhất cần Worker.
 *
 * Một lần chạy tại một thời điểm: Panel gọi hàm này từ một nút bấm.
 */

const TIMEOUT_MS = 1000;

let worker: Worker | null = null;

function ensure(): Worker {
  // Cách Vite hiểu sẵn — không cần cấu hình gì thêm.
  worker ??= new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
  return worker;
}

export function runInWorker(request: RegexRequest): Promise<RegexRun | "timeout"> {
  const active = ensure();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      // Worker sẽ không bao giờ trả lời: giết nó và để lần sau dựng cái mới.
      active.onmessage = null;
      active.terminate();
      worker = null;
      resolve("timeout");
    }, TIMEOUT_MS);

    active.onmessage = (event: MessageEvent<RegexRun>) => {
      clearTimeout(timer);
      resolve(event.data);
    };
    active.postMessage(request);
  });
}
