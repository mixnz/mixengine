import { runRegex, type RegexRun } from "./match";

export interface RegexRequest {
  pattern: string;
  flags: string;
  subject: string;
  replacement: string;
}

/**
 * Đúng hai thứ file này cần từ scope của worker.
 *
 * `self` được lib `dom` khai là `Window`, còn `DedicatedWorkerGlobalScope` thì thuộc lib
 * `webworker` — và bật lib đó lên là đụng độ khai báo với `dom` trên toàn project. Khai đúng phần
 * dùng tới rẻ hơn nhiều so với việc đó.
 */
interface WorkerScope {
  onmessage: ((event: MessageEvent<RegexRequest>) => void) | null;
  postMessage: (message: RegexRun) => void;
}

const scope = self as unknown as WorkerScope;

scope.onmessage = (event: MessageEvent<RegexRequest>) => {
  const { pattern, flags, subject, replacement } = event.data;
  scope.postMessage(runRegex(pattern, flags, subject, replacement));
};
