/**
 * Snippet của cheatsheet: một lệnh có chỗ trống, và cách điền vào chỗ trống đó.
 *
 * Phần điền tham số là **chức năng**, không phải chỗ chứa — đó là thứ phân biệt tool này với một
 * file ghi chú, và là lý do nó qua được tiêu chí nhận tool của module.
 */

export interface Snippet {
  id: string;
  title: string;
  /** Nhóm để xếp danh sách: `mysql`, `postgres`, `docker`, `ssh`… Chuỗi tự do. */
  group: string;
  /** Lệnh, với tham số viết `{{tên}}`. */
  template: string;
}

const PARAM = /\{\{([A-Za-z0-9_]+)\}\}/g;

/** Tên các tham số, theo thứ tự xuất hiện lần đầu, không lặp. */
export function paramsOf(template: string): string[] {
  const names: string[] = [];
  for (const match of template.matchAll(PARAM)) {
    const name = match[1]!;
    if (!names.includes(name)) names.push(name);
  }
  return names;
}

/**
 * Thay `{{tên}}` bằng giá trị.
 *
 * Tên không có giá trị — hoặc có giá trị rỗng — thì **giữ nguyên `{{tên}}`**: một ô chưa điền phải
 * nhìn thấy được trong đầu ra, chứ không biến mất thành khoảng trắng rồi để người dùng chép đi một
 * lệnh thiếu mất một đối số.
 *
 * **Không bọc ngoặc hộ.** Không phải mọi tham số đều đứng ở vị trí một đối số shell, và bọc thêm ở
 * chỗ template đã bọc rồi thì hỏng theo cách khó thấy hơn hẳn cách nó đang hỏng.
 */
export function fill(template: string, values: Record<string, string>): string {
  return template.replace(PARAM, (whole, name: string) => {
    const value = values[name];
    return value === undefined || value === "" ? whole : value;
  });
}

/** Một snippet đang được soạn: mọi thứ trừ `id`, thứ chỉ danh sách mới đặt được. */
export type SnippetDraft = Omit<Snippet, "id">;

/**
 * Id không đụng nhau, không cần `crypto.randomUUID`.
 *
 * Danh sách này là của một người trên một máy và dài vài chục mục; thứ duy nhất id phải làm là
 * phân biệt hai mục thêm liền nhau, và một bộ đếm chạy sau mốc thời gian làm được đúng thế.
 */
let counter = 0;
function nextId(): string {
  counter += 1;
  return `s${Date.now().toString(36)}${counter.toString(36)}`;
}

export function addSnippet(list: Snippet[], draft: SnippetDraft): Snippet[] {
  return [...list, { ...draft, id: nextId() }];
}

export function updateSnippet(list: Snippet[], id: string, draft: SnippetDraft): Snippet[] {
  return list.map((snippet) => (snippet.id === id ? { ...draft, id } : snippet));
}

export function removeSnippet(list: Snippet[], id: string): Snippet[] {
  return list.filter((snippet) => snippet.id !== id);
}

function isSnippet(value: unknown): value is Snippet {
  if (typeof value !== "object" || value === null) return false;
  const it = value as Record<string, unknown>;
  return (
    typeof it.id === "string" &&
    it.id !== "" &&
    typeof it.title === "string" &&
    typeof it.group === "string" &&
    typeof it.template === "string"
  );
}

/**
 * Đọc thứ lấy từ đĩa lên thành một danh sách snippet.
 *
 * Kiểm shape và chỉ shape, như `parseToolsTabState` làm — và nằm ở đây chứ không trong
 * `snippetsStore.ts` vì đây là phần thuần, tức là phần test được. Một file do bản cũ ghi ra, hoặc
 * một file bị sửa tay, làm mất mục hỏng chứ không làm hỏng cả tool.
 */
export function readSnippets(value: unknown): Snippet[] {
  return Array.isArray(value) ? value.filter(isSnippet) : [];
}
