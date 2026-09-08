import { Store } from "@tauri-apps/plugin-store";
import { invoke } from "@tauri-apps/api/core";
import type { SavedTarget, SshConfig } from "./types";
import { mergeSshSecrets, splitSshSecrets, type SshSecrets } from "../../core/ssh";

/**
 * Danh sách đích đã lưu, chia làm hai chỗ.
 *
 * `terminal-hosts.json` giữ cái một đích *là* — tên, và tuỳ loại: shell cùng thư mục bắt đầu, hay
 * địa chỉ, cổng, người dùng, đường dẫn khoá — và nó là văn bản thường có chủ đích: đó là danh sách
 * những chỗ mình hay mở, đọc và chép được thì tiện. Cái mở được cửa thì đi vào kho thông tin đăng
 * nhập của hệ điều hành, qua ba lệnh `secrets_*` mà module db cũng dùng.
 *
 * `runOnConnect` ở lại trong file cùng với tên: nó là mấy dòng lệnh mở màn, không phải bí mật —
 * và chú thích dưới ô ấy trong form nói thẳng ra như vậy, vì một người tưởng nó được giấu sẽ đặt
 * `export TOKEN=…` vào đó.
 *
 * Nhánh `local` không có gì để giấu, nên nó không đụng tới kho thông tin đăng nhập ở cả ba đường:
 * lưu, đọc và xoá.
 *
 * Tên file giữ nguyên từ hồi danh sách chỉ có máy chủ. Đổi tên file là bỏ lại danh sách của mọi
 * người đang dùng ở bản cũ, và cái tên ấy không ai nhìn thấy.
 *
 * Id là uuid do module này sinh, nên nó không bao giờ đụng id của một kết nối database — hai bên
 * chia nhau một kho nhưng không chia nhau khoá nào.
 *
 * Chỗ chia là chuyện riêng của file này: cái đi vào và đi ra là một `SavedTarget` đầy đủ.
 */

let storePromise: Promise<Store> | null = null;

function getStore(): Promise<Store> {
  if (!storePromise) {
    storePromise = Store.load("terminal-hosts.json");
  }
  return storePromise;
}

/* Những gì không được nằm trong `terminal-hosts.json`, và cách chẻ ra rồi ghép lại: `core/ssh.ts`,
   vì module db chẻ đúng cùng một thứ cho tunnel của nó. Tên cũ giữ lại cho những chỗ đã import. */
export type HostSecrets = SshSecrets;

/**
 * Một entry trên đĩa, đọc phòng thủ, hoặc `null` khi nó không phải một cái nào cả.
 *
 * Mọi thứ tới đây là JSON một phiên bản nào đó của app đã ghi — kể cả bản không biết `kind` là gì.
 * Entry thiếu `kind` đọc là `ssh`: hồi ấy danh sách chỉ có máy chủ, nên đó không phải phỏng đoán.
 *
 * `cwd` vắng mặt và `cwd` là `null` là một thứ, đúng như bên `tabState.ts`: mở shell ở thư mục mặc
 * định của nó.
 */
export function parseSavedTarget(value: unknown): SavedTarget | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const entry = value as Record<string, unknown>;
  if (typeof entry.id !== "string" || entry.id === "") return null;
  if (typeof entry.name !== "string") return null;
  const runOnConnect = typeof entry.runOnConnect === "string" ? entry.runOnConnect : undefined;

  if (entry.kind === "local") {
    if (typeof entry.shellName !== "string" || entry.shellName === "") return null;
    const cwd = typeof entry.cwd === "string" ? entry.cwd : null;
    return { id: entry.id, name: entry.name, kind: "local", shellName: entry.shellName, cwd, runOnConnect };
  }

  // `undefined` cũng vào đây: xem chú thích trên hàm.
  if (entry.kind !== undefined && entry.kind !== "ssh") return null;
  const config = parseSshConfig(entry.config);
  if (config === null) return null;
  return { id: entry.id, name: entry.name, kind: "ssh", config, runOnConnect };
}

/**
 * Phần `config` của một entry ssh, đọc từng trường một, hoặc `null` khi không còn gì để vẽ.
 *
 * Trước đây chỗ này là một `as SshConfig` — một lời hứa với trình biên dịch, không phải một phép
 * kiểm. Một entry sửa tay thiếu `auth` đi lọt qua, rồi `mergeSecrets` đọc `config.auth.type` và
 * ném ra giữa `Promise.all` của `loadSavedTargets`: **cả danh sách** biến mất trong suốt phiên
 * làm việc, đúng ngược với điều `loadStored` hứa ngay bên trên nó.
 *
 * Chỉ `host` là không đoán được — không có nó thì không có dòng nào để vẽ. Còn lại đều có mặc
 * định đúng, theo đúng lẽ mà file này đã chọn ở chỗ khác: một máy chủ mà kho bí mật không còn gì
 * cho nó vẫn hiện ra với ô mật khẩu trống. Một `auth` thiếu hoặc lạ đọc thành mật khẩu rỗng vì
 * cùng lẽ ấy — dòng ấy sửa lại được trong form, còn vứt đi thì mất luôn cả tên và địa chỉ.
 */
function parseSshConfig(value: unknown): SshConfig | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const config = value as Record<string, unknown>;
  if (typeof config.host !== "string" || config.host === "") return null;

  const port = config.port;
  const auth = typeof config.auth === "object" && config.auth !== null ? (config.auth as Record<string, unknown>) : {};

  return {
    host: config.host,
    // Cổng ssh mặc định. Một entry không nói cổng vẫn mở được; nói sai thì không.
    port: typeof port === "number" && Number.isInteger(port) && port > 0 && port <= 65535 ? port : 22,
    username: typeof config.username === "string" ? config.username : "",
    auth:
      auth.type === "privatekey"
        ? {
            type: "privatekey",
            key_path: typeof auth.key_path === "string" ? auth.key_path : "",
            passphrase: typeof auth.passphrase === "string" ? auth.passphrase : undefined,
          }
        : {
            type: "password",
            // Rỗng là chuyện thường chứ không phải chuyện hỏng: `splitSecrets` ghi ra đúng thế,
            // và mật khẩu thật nằm trong kho của hệ điều hành.
            password: typeof auth.password === "string" ? auth.password : "",
          },
  };
}

/** Cái ghi xuống file: một đích với phần bí mật đã lấy ra. Nhánh `local` đi qua nguyên vẹn. */
export function withoutSecrets(target: SavedTarget): SavedTarget {
  return target.kind === "ssh" ? { ...target, config: splitSshSecrets(target.config).config } : target;
}

function saveSecrets(id: string, secrets: HostSecrets): Promise<void> {
  return invoke<void>("secrets_save", { id, secrets });
}

function loadSecrets(id: string): Promise<HostSecrets> {
  return invoke<HostSecrets>("secrets_load", { id });
}

/**
 * Cái thật sự nằm trên đĩa, phần bí mật đã bị lấy ra từ trước.
 *
 * Entry nào không đọc được thì rơi ra khỏi danh sách chứ không làm hỏng cả lượt đọc — và vì mọi
 * lượt ghi đều đi qua đây trước, nó cũng biến mất khỏi file ngay lần lưu tiếp theo. Đó là điều
 * đúng: một dòng không vẽ được cũng không mở được, giữ lại chỉ là giữ một chỗ hỏng. Cái mà bản cũ
 * ghi ra thì đọc được — thiếu `kind` là `ssh`, xem `parseSavedTarget`.
 */
async function loadStored(): Promise<SavedTarget[]> {
  const store = await getStore();
  const raw = (await store.get<unknown[]>("hosts")) ?? [];
  return raw.map(parseSavedTarget).filter((entry): entry is SavedTarget => entry !== null);
}

async function persist(list: SavedTarget[]): Promise<void> {
  const store = await getStore();
  await store.set("hosts", list.map(withoutSecrets));
  await store.save();
}

/** Mọi đích đã lưu, phần bí mật đã ghép lại. Một máy chủ mà kho không còn gì cho nó vẫn về đây —
 *  chỉ là ô mật khẩu trống, và đó là điều đúng để hiện. */
export async function loadSavedTargets(): Promise<SavedTarget[]> {
  const stored = await loadStored();
  return Promise.all(
    stored.map(async (target) =>
      target.kind === "ssh"
        ? { ...target, config: mergeSshSecrets(target.config, await loadSecrets(target.id)) }
        : target,
    ),
  );
}

/**
 * Ghi bí mật của `target` vào kho của hệ điều hành, rồi cả danh sách — không bí mật nào — xuống
 * file. Những đích khác cũng bị lược: chúng vừa được trao đi với phần bí mật đã ghép vào.
 *
 * Nhánh `local` ghi một tập rỗng chứ không bỏ qua hẳn, và đó là chỗ dễ trượt: một dòng vốn là máy
 * chủ, sửa thành shell trên máy này, mà không đi qua đây thì mật khẩu cũ của nó nằm lại trong kho
 * của hệ điều hành mãi mãi — `removeSavedTarget` sau đó nhìn vào một entry `local` và không có lý
 * do gì để xoá. Tập rỗng là lệnh xoá, xem `secrets.rs`.
 */
async function persistTarget(list: SavedTarget[], target: SavedTarget): Promise<void> {
  await saveSecrets(target.id, target.kind === "ssh" ? splitSshSecrets(target.config).secrets : {});
  await persist(list);
}

export async function addSavedTarget(target: SavedTarget): Promise<SavedTarget[]> {
  const list = await loadSavedTargets();
  const next = [...list, target];
  await persistTarget(next, target);
  return next;
}

export async function updateSavedTarget(target: SavedTarget): Promise<SavedTarget[]> {
  const list = await loadSavedTargets();
  const next = list.map((entry) => (entry.id === target.id ? target : entry));
  await persistTarget(next, target);
  return next;
}

export async function removeSavedTarget(id: string): Promise<SavedTarget[]> {
  const list = await loadSavedTargets();
  const next = list.filter((entry) => entry.id !== id);
  /* Bí mật đi theo đích nó thuộc về; để lại là để một entry trong kho của hệ điều hành mà không còn
     gì gọi tên nó nữa. Hỏi không điều kiện, kể cả với một shell trên máy này: xoá cái không có ở
     đó không phải là lỗi (`secrets.rs`), còn đoán rằng nó chưa từng có gì thì sai đúng một trường
     hợp — một dòng từng là máy chủ. */
  await invoke<void>("secrets_delete", { id });
  await persist(next);
  return next;
}
