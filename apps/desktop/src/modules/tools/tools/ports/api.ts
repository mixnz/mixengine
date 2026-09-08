import { invoke } from "@tauri-apps/api/core";

/** Một cổng đang được nghe. Trùng với `ListeningPort` của `src-tauri/src/modules/tools/ports.rs`. */
export interface ListeningPort {
  port: number;
  /** `0.0.0.0`, `127.0.0.1`, `::` — phân biệt "mở ra ngoài" với "chỉ localhost". */
  address: string;
  pid: number;
  /** `null` khi không tra được tên tiến trình, thường là do thiếu quyền. */
  process: string | null;
}

/** Chỗ duy nhất trong module gọi `invoke`, tách khỏi Panel đúng như `src/modules/db/tools.ts` làm. */
export function listeningPorts(): Promise<ListeningPort[]> {
  return invoke<ListeningPort[]>("tools_listening_ports");
}
