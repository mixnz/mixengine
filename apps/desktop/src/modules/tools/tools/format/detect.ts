export type FormatKind = "json" | "xml" | "sql";

/**
 * Đoán định dạng theo ký tự đầu tiên khác khoảng trắng.
 *
 * Panel **nói ra** nó đoán gì, đúng như tool Timestamp làm với đơn vị: một cái đoán im lặng mà sai
 * thì người dùng không có cách nào biết. `null` nghĩa là không có gì để đoán.
 */
export function detectFormat(text: string): FormatKind | null {
  const head = text.trimStart();
  if (head === "") return null;
  const ch = head[0]!;
  if (ch === "<") return "xml";
  if (ch === "{" || ch === "[") return "json";
  return "sql";
}
