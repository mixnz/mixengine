/**
 * So sánh hai đoạn văn bản theo dòng.
 *
 * LCS là O(n×m) cả thời gian lẫn bộ nhớ, và bộ nhớ mới là chỗ đau: một bảng 5000×5000 ô 4 byte là
 * 95 MB cho một lần bấm. Nên **cắt phần đầu và phần đuôi giống nhau trước**, rồi mới chạy LCS trên
 * phần giữa, và chặn phần giữa lại. Mười dòng khác nhau giữa hai file 50 nghìn dòng thì bảng chỉ
 * còn 10×10.
 */

export interface DiffLine {
  kind: "same" | "add" | "remove";
  /** Số dòng ở mỗi bên, hoặc `null` nếu dòng không tồn tại bên đó. */
  leftNo: number | null;
  rightNo: number | null;
  text: string;
}

export interface DiffOptions {
  ignoreWhitespace: boolean;
  ignoreCase: boolean;
}

export type DiffResult =
  | { ok: true; lines: DiffLine[]; added: number; removed: number }
  | { ok: false; reason: "tooLarge" };

/** 2000×2000 ô 4 byte là 16 MB — chấp nhận được cho một lần bấm. */
const MAX_MIDDLE = 2000;

function keyOf(line: string, options: DiffOptions): string {
  const text = options.ignoreWhitespace ? line.replace(/\s+/g, " ").trim() : line;
  return options.ignoreCase ? text.toLowerCase() : text;
}

export function diffLines(left: string, right: string, options: DiffOptions): DiffResult {
  const a = left.split("\n");
  const b = right.split("\n");
  const ka = a.map((line) => keyOf(line, options));
  const kb = b.map((line) => keyOf(line, options));

  let head = 0;
  while (head < a.length && head < b.length && ka[head] === kb[head]) head += 1;

  let tail = 0;
  while (
    tail < a.length - head &&
    tail < b.length - head &&
    ka[a.length - 1 - tail] === kb[b.length - 1 - tail]
  ) {
    tail += 1;
  }

  const midA = a.length - head - tail;
  const midB = b.length - head - tail;
  if (midA > MAX_MIDDLE || midB > MAX_MIDDLE) return { ok: false, reason: "tooLarge" };

  // Bảng LCS chạy ngược từ cuối, nên ô (i, j) là độ dài chuỗi chung của hai phần đuôi.
  const width = midB + 1;
  const table = new Uint32Array((midA + 1) * width);
  const at = (i: number, j: number): number => i * width + j;
  for (let i = midA - 1; i >= 0; i -= 1) {
    for (let j = midB - 1; j >= 0; j -= 1) {
      table[at(i, j)] =
        ka[head + i] === kb[head + j]
          ? table[at(i + 1, j + 1)]! + 1
          : Math.max(table[at(i + 1, j)]!, table[at(i, j + 1)]!);
    }
  }

  const lines: DiffLine[] = [];
  let added = 0;
  let removed = 0;

  for (let k = 0; k < head; k += 1) {
    lines.push({ kind: "same", leftNo: k + 1, rightNo: k + 1, text: a[k]! });
  }

  let i = 0;
  let j = 0;
  while (i < midA && j < midB) {
    if (ka[head + i] === kb[head + j]) {
      lines.push({ kind: "same", leftNo: head + i + 1, rightNo: head + j + 1, text: a[head + i]! });
      i += 1;
      j += 1;
    } else if (table[at(i + 1, j)]! >= table[at(i, j + 1)]!) {
      lines.push({ kind: "remove", leftNo: head + i + 1, rightNo: null, text: a[head + i]! });
      removed += 1;
      i += 1;
    } else {
      lines.push({ kind: "add", leftNo: null, rightNo: head + j + 1, text: b[head + j]! });
      added += 1;
      j += 1;
    }
  }
  while (i < midA) {
    lines.push({ kind: "remove", leftNo: head + i + 1, rightNo: null, text: a[head + i]! });
    removed += 1;
    i += 1;
  }
  while (j < midB) {
    lines.push({ kind: "add", leftNo: null, rightNo: head + j + 1, text: b[head + j]! });
    added += 1;
    j += 1;
  }

  for (let k = 0; k < tail; k += 1) {
    const li = a.length - tail + k;
    const ri = b.length - tail + k;
    lines.push({ kind: "same", leftNo: li + 1, rightNo: ri + 1, text: a[li]! });
  }

  return { ok: true, lines, added, removed };
}

export interface DiffSegment {
  text: string;
  changed: boolean;
}

/**
 * Dưới ngưỡng này thì phần đầu/đuôi chung chỉ là trùng hợp giữa hai dòng không liên quan (VD hai câu
 * SQL khác hẳn nhau nhưng cùng bắt đầu `SELECT` và cùng kết `;`) — tô riêng đoạn giữa lúc đó gây hiểu
 * lầm hơn là tô nguyên dòng như trước, nên trả `null` để nơi gọi render nguyên dòng.
 */
const MIN_SEGMENT_SIMILARITY = 0.3;

function segmentKey(ch: string, ignoreCase: boolean): string {
  return ignoreCase ? ch.toLowerCase() : ch;
}

/**
 * Tô riêng đoạn khác nhau giữa một dòng bị xoá và dòng được thêm tương ứng, bằng đúng trick cắt
 * đầu/đuôi giống nhau ở trên nhưng ở mức ký tự (code point, qua `Array.from`, để không cắt vỡ một
 * ký tự Unicode hai code unit).
 *
 * Bỏ qua `ignoreWhitespace`: quy đổi lại vị trí sau khi gộp khoảng trắng không đáng công sức, nên khi
 * tuỳ chọn đó bật thì trả `null` luôn — nơi gọi render nguyên dòng.
 */
export function diffSegments(
  leftText: string,
  rightText: string,
  options: DiffOptions
): { left: DiffSegment[]; right: DiffSegment[] } | null {
  if (options.ignoreWhitespace) return null;

  const a = Array.from(leftText);
  const b = Array.from(rightText);
  const ka = a.map((ch) => segmentKey(ch, options.ignoreCase));
  const kb = b.map((ch) => segmentKey(ch, options.ignoreCase));

  let head = 0;
  while (head < a.length && head < b.length && ka[head] === kb[head]) head += 1;

  const remaining = Math.min(a.length, b.length) - head;
  let tail = 0;
  while (tail < remaining && ka[a.length - 1 - tail] === kb[b.length - 1 - tail]) tail += 1;

  const longest = Math.max(a.length, b.length);
  if (longest === 0 || (head + tail) / longest < MIN_SEGMENT_SIMILARITY) return null;

  const build = (chars: string[]): DiffSegment[] => {
    const segments: DiffSegment[] = [];
    if (head > 0) segments.push({ text: chars.slice(0, head).join(""), changed: false });
    const midEnd = chars.length - tail;
    if (midEnd > head) segments.push({ text: chars.slice(head, midEnd).join(""), changed: true });
    if (tail > 0) segments.push({ text: chars.slice(midEnd).join(""), changed: false });
    return segments;
  };

  return { left: build(a), right: build(b) };
}

interface DiffRun {
  removes: DiffLine[];
  adds: DiffLine[];
}

/**
 * Gom các dòng không phải "same" liền nhau thành từng cụm. Do cách chọn nhánh khi bằng điểm ở trên
 * (`>=` ưu tiên remove), một cụm luôn là một khối remove rồi mới đến một khối add — nhưng hàm này
 * không dựa vào thứ tự đó để đúng: nó tách theo `kind` bất kể remove/add có xen kẽ nhau hay không.
 */
function findRuns(lines: DiffLine[]): DiffRun[] {
  const runs: DiffRun[] = [];
  let i = 0;
  while (i < lines.length) {
    if (lines[i]!.kind === "same") {
      i += 1;
      continue;
    }
    const removes: DiffLine[] = [];
    const adds: DiffLine[] = [];
    while (i < lines.length && lines[i]!.kind !== "same") {
      const line = lines[i]!;
      if (line.kind === "remove") removes.push(line);
      else adds.push(line);
      i += 1;
    }
    runs.push({ removes, adds });
  }
  return runs;
}

/**
 * Với mỗi cụm remove/add, ghép theo vị trí (remove thứ k với add thứ k) để tính đoạn khác nhau — số
 * dư (khi remove và add không cùng số lượng) không được ghép, giữ nguyên render cả dòng.
 *
 * Trả về map từ `DiffLine` (theo tham chiếu, cùng mảng `lines` truyền vào) sang các segment của
 * riêng dòng đó, dùng cho view Unified: mỗi dòng vẫn render trên hàng riêng, chỉ đoạn khác nhau bên
 * trong được tô đậm hơn.
 */
export function computeLineSegments(lines: DiffLine[], options: DiffOptions): Map<DiffLine, DiffSegment[]> {
  const map = new Map<DiffLine, DiffSegment[]>();
  for (const run of findRuns(lines)) {
    const pairCount = Math.min(run.removes.length, run.adds.length);
    for (let k = 0; k < pairCount; k += 1) {
      const removeLine = run.removes[k]!;
      const addLine = run.adds[k]!;
      const result = diffSegments(removeLine.text, addLine.text, options);
      if (result === null) continue;
      map.set(removeLine, result.left);
      map.set(addLine, result.right);
    }
  }
  return map;
}

/**
 * Một ô trong view Split. `"blank"` là bên không có dòng tương ứng (phần dư khi remove và add lệch
 * số lượng) — không có số dòng, không có chữ. `kind` phân biệt "same" (không tô màu) với
 * "remove"/"add" (tô nền đỏ/xanh), để nơi render không phải đoán qua việc so `no`/`text`.
 */
export type SplitCell =
  | { kind: "blank" }
  | { kind: "same" | "remove" | "add"; no: number; text: string; segments: DiffSegment[] | null };

export interface SplitRow {
  left: SplitCell;
  right: SplitCell;
}

const BLANK_CELL: SplitCell = { kind: "blank" };

function cellOf(
  kind: "same" | "remove" | "add",
  no: number,
  text: string,
  segments: DiffSegment[] | null
): SplitCell {
  return { kind, no, text, segments };
}

/**
 * Dựng các hàng cho view Split (2 cột song song kiểu GitHub): dòng "same" chiếm một hàng ở cả hai
 * bên, một cặp remove/add ghép được chiếm một hàng "replaced", phần dư (remove hoặc add lẻ ra) chiếm
 * một hàng chỉ có một bên — bên kia để trống.
 */
export function buildSplitRows(lines: DiffLine[], options: DiffOptions): SplitRow[] {
  const rows: SplitRow[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (line.kind === "same") {
      rows.push({
        left: cellOf("same", line.leftNo!, line.text, null),
        right: cellOf("same", line.rightNo!, line.text, null),
      });
      i += 1;
      continue;
    }

    const removes: DiffLine[] = [];
    const adds: DiffLine[] = [];
    while (i < lines.length && lines[i]!.kind !== "same") {
      const current = lines[i]!;
      if (current.kind === "remove") removes.push(current);
      else adds.push(current);
      i += 1;
    }

    const pairCount = Math.min(removes.length, adds.length);
    for (let k = 0; k < pairCount; k += 1) {
      const removeLine = removes[k]!;
      const addLine = adds[k]!;
      const result = diffSegments(removeLine.text, addLine.text, options);
      rows.push({
        left: cellOf("remove", removeLine.leftNo!, removeLine.text, result?.left ?? null),
        right: cellOf("add", addLine.rightNo!, addLine.text, result?.right ?? null),
      });
    }
    for (let k = pairCount; k < removes.length; k += 1) {
      rows.push({ left: cellOf("remove", removes[k]!.leftNo!, removes[k]!.text, null), right: BLANK_CELL });
    }
    for (let k = pairCount; k < adds.length; k += 1) {
      rows.push({ left: BLANK_CELL, right: cellOf("add", adds[k]!.rightNo!, adds[k]!.text, null) });
    }
  }
  return rows;
}
