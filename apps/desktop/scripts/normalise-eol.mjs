#!/usr/bin/env node
/**
 * Đổi CRLF sang LF trong các file đang theo dõi bởi git.
 *
 * Nó **không** đụng tới nội dung git lưu: `.gitattributes` của repo là `* text=auto eol=lf`, nên
 * git đã chuẩn hoá về LF trên đường vào index từ trước rồi. Cái script này sửa là **cây làm việc**
 * — file trên đĩa — để trình soạn thảo và mọi công cụ đọc file trực tiếp đều thấy cùng một thứ, và
 * để git thôi cảnh báo "CRLF will be replaced by LF" mỗi lần `git add`.
 *
 * CRLF lọt vào chủ yếu do công cụ ghi file ở chế độ text trên Windows — `open(p, "w")` của Python
 * là ví dụ kinh điển, nó dịch mọi `\n` thành `\r\n` mà không nói gì.
 *
 * Việc nhận diện file nào cần sửa giao hết cho git qua `git ls-files --eol`, thay vì tự đoán:
 *
 *     i/lf    w/crlf  attr/text=auto eol=lf   src/a.ts     <- sửa
 *     i/-text w/-text attr/text=auto eol=lf   logo.png     <- binary, bỏ qua
 *     i/lf    w/lf    attr/text=auto eol=lf   src/b.ts     <- đã đúng
 *
 * Nhờ vậy file nhị phân tự loại mình ra, và một file được `.gitattributes` đánh dấu `-text` cũng
 * được tôn trọng chứ không bị sửa bừa.
 *
 * Dùng:
 *   node scripts/normalise-eol.mjs              # cả repo
 *   node scripts/normalise-eol.mjs src scripts  # chỉ trong mấy đường dẫn này
 *   node scripts/normalise-eol.mjs --check      # chỉ liệt kê, không sửa; thoát 1 nếu còn file lệch
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const checkOnly = args.includes("--check");
const paths = args.filter((arg) => arg !== "--check");

const git = (...rest) =>
  execFileSync("git", rest, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });

/** File theo dõi bởi git mà cây làm việc đang là CRLF hoặc lẫn lộn hai kiểu. */
function crlfFiles() {
  return git("ls-files", "--eol", "--", ...paths)
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      // `i/… w/… attr/…` rồi một TAB rồi đường dẫn. `attr/` có thể chứa khoảng trắng, nên cắt ở
      // TAB chứ không cắt ở khoảng trắng.
      const tab = line.indexOf("\t");
      return { flags: line.slice(0, tab), path: line.slice(tab + 1) };
    })
    .filter(({ flags }) => /\bw\/(crlf|mixed)\b/.test(flags))
    .map(({ path }) => path);
}

/** Bỏ mọi CR đứng ngay trước LF. Làm ở mức byte để không có bảng mã nào xen vào giữa — file có thể
 *  là UTF-8, và một vòng chuyển sang chuỗi rồi ngược lại là một cơ hội để hỏng. */
function stripCr(buffer) {
  const out = Buffer.allocUnsafe(buffer.length);
  let n = 0;
  for (let i = 0; i < buffer.length; i++) {
    if (buffer[i] === 0x0d && buffer[i + 1] === 0x0a) continue;
    out[n++] = buffer[i];
  }
  return out.subarray(0, n);
}

const files = crlfFiles();

if (files.length === 0) {
  console.log("Mọi file đều đã là LF.");
  process.exit(0);
}

if (checkOnly) {
  console.log(`${files.length} file còn CRLF:`);
  for (const file of files) console.log(`  ${file}`);
  process.exit(1);
}

for (const file of files) writeFileSync(file, stripCr(readFileSync(file)));

console.log(`Đã đổi ${files.length} file sang LF:`);
for (const file of files) console.log(`  ${file}`);
