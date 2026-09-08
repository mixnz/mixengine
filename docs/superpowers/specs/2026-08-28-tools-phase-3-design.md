# Module Tools — Giai đoạn 3: chuyển đổi và văn bản

Ngày: 2026-08-28

Spec con của [module Tools](2026-08-28-tools-module-design.md). Giai đoạn 1 và 2 đã ship: bộ khung,
`registry.ts`, và sáu tool. Mục 5 của spec mẹ phác giai đoạn 3 bằng năm gạch đầu dòng và nói rõ
"mỗi giai đoạn có spec riêng khi tới lượt". Đây là spec đó.

Tiêu chí nhận tool không đổi, và vẫn là thứ quyết định mọi cắt bỏ bên dưới:

> Chỉ nhận tool nằm trên đường đi của một dev đang làm việc với DB, API hoặc server.

## Mục tiêu

Sau giai đoạn này:

- Module có **12 tool**, và nhóm `infra` — trống rỗng từ ngày đầu — có cư dân đầu tiên.
- Sáu tool mới chạy được: format & minify, chuyển đổi định dạng, sinh schema từ JSON, `.env`, diff,
  và regex tester.
- Dependency mới của cả giai đoạn là **đúng một**: `js-yaml`. Không chạm Rust.
- Không file nào ngoài `src/modules/tools/` đổi, trừ `CHANGELOG.md` và `package.json`.

## Phi mục tiêu

Ba cái đầu thừa hưởng nguyên văn từ spec mẹ, và giai đoạn này không xin ngoại lệ nào:

- **Không chạy gì cả.** Mọi tool in ra để copy.
- **Không lưu nội dung người dùng gõ.** Tool `.env` là chỗ người ta dán mật khẩu DB thật; nó vẫn
  chỉ sống trong bộ nhớ của tab, như mọi tool khác.
- **Không bắc cầu sang module khác.** Không có nút "chạy `CREATE TABLE` này ở tab db".

Thêm ba cái của riêng giai đoạn này:

- **Không prettier.** Xem mục 9.
- **Không đoán kiểu cho giá trị CSV.** `007` là chuỗi `"007"`, không phải số 7. Xem 4.3.
- **Không sắp xếp khoá khi diff JSON.** Xem mục 7.

## Hiện trạng

Những gì giai đoạn 1 và 2 để lại và spec này dựa vào:

| Chỗ | Dùng để làm gì |
| --- | --- |
| `tools/registry.ts` | Sáu dòng nữa. Vẫn là chỗ duy nhất `ToolsTab` học được tool nào tồn tại |
| `tools/tool.ts` | `ToolDefinition` không đổi. `Panel` vẫn không nhận prop nào |
| `tools/components/CopyField` | Một dòng kết quả chỉ đọc kèm nút chép, có sẵn chế độ `multiline` |
| `tools/tools/case/caseConvert.ts` | `convert(text, style)` — mục 5 dùng lại để đặt tên cột và field |
| `tools/tools/timestamp/time.ts` | Nhận diện chuỗi ISO 8601 — mục 5 dùng lại để đoán cột thời gian |
| `components/Select`, `Input`, `Textarea`, `ErrorBanner` | Đã đủ cho cả sáu Panel |
| `sql-formatter` | Đã là dependency từ module db |
| `TOOL_GROUPS` | Năm nhóm đã có sẵn. Giai đoạn này không thêm nhóm nào |

Và một điều đáng nói ra: **giai đoạn này không cần đụng vào file nào ngoài module.** Không icon mới
(`ToolList` in nhãn chứ không in icon), không nhóm i18n mới (`toolbox` đã được nối vào `dicts.ts` ở
giai đoạn 1), không dòng nào trong `shell/registry.ts`. Đó chính là thứ mà `ToolDefinition` một
trường `Panel` không prop được thiết kế để mua, và giai đoạn 3 là lần đầu nó được trả tiền về.

## 1. Sáu tool từ năm mục

| Tool | id | Nhóm | Nội dung |
| --- | --- | --- | --- |
| Format & Minify | `format` | `text` | SQL · JSON · XML |
| Chuyển đổi | `convert` | `data` | JSON ⇄ YAML ⇄ CSV → INSERT |
| Sinh schema | `schema` | `data` | JSON → CREATE TABLE / TS interface / Go struct |
| Biến môi trường | `env` | `infra` | `.env` ⇄ JSON ⇄ `export` ⇄ `docker -e` |
| Diff | `diff` | `text` | Hai đoạn text hoặc JSON |
| Regex | `regex` | `text` | Match, nhóm bắt, thay thế |

Mục "chuyển đổi dữ liệu" của spec mẹ tách làm hai tool. Chúng trông giống nhau — JSON vào, thứ khác
ra — nhưng là hai việc khác hẳn: một bên **đổi cách viết** của cùng một dữ liệu và đi được cả hai
chiều; một bên **suy ra kiểu** rồi sinh mã, một chiều, và phần khó nằm ở suy luận chứ không ở cú
pháp. Nhét chung một Panel thì hai nửa tranh nhau ô chọn định dạng, và bộ test của bên này lẫn vào
bên kia.

**YAML không có trong tool Format.** Format YAML bằng `js-yaml` là một vòng `load` rồi `dump`, và nó
**xoá sạch comment**. Với một `docker-compose.yml` thì comment là nửa giá trị của file, nên một nút
"format" ăn mất chúng là cái bẫy chứ không phải tiện ích. Trong tool Chuyển đổi thì mất comment là
chuyện hiển nhiên — không ai mong comment sống sót khi đổi YAML sang CSV. Cắt YAML khỏi Format cũng
làm tool này phủ đúng ba định dạng minify được, trùng khít câu "Minify chỉ cho JSON/SQL/XML" của spec
mẹ.

## 2. Trục JSON

Ba tool chuyển đổi — `convert`, `schema`, `env` — đều theo cùng một hình: **mọi định dạng vào đều
thành một giá trị JS, mọi định dạng ra đều sinh từ giá trị đó.**

```
  YAML ─┐                    ┌─ JSON
  CSV  ─┼─►  giá trị JS  ─►  ├─ YAML
  JSON ─┘                    ├─ CSV
                             └─ INSERT
```

Nhờ vậy tool Chuyển đổi có 3 bộ đọc cộng 4 bộ ghi chứ không phải 12 hàm dịch chéo, và thêm một định
dạng về sau là một bộ đọc hoặc một bộ ghi, không phải một hàng và một cột. Mỗi bộ đọc và mỗi bộ ghi
là một hàm thuần có test riêng; không hàm nào biết tên định dạng ở đầu kia.

Cái giá phải trả, ghi ra để không ai ngạc nhiên: đi qua trục là **mất mọi thứ trục không mang được**
— comment của YAML, thứ tự cột gốc của CSV khi các dòng có khoá lệch nhau, và độ chính xác của số
trong JSON. Cái cuối là lý do tool Format **không** dùng trục này. Xem 3.2.

## 3. Format & Minify (`format`)

Ba định dạng, một ô vào, một ô ra, hai nút: **Format** và **Minify**. Ô chọn thụt lề: 2 khoảng
trắng (mặc định), 4, hoặc tab.

Định dạng được **đoán** từ ký tự không phải khoảng trắng đầu tiên — `<` là XML, `{` hoặc `[` là
JSON, còn lại là SQL — và tool **nói ra nó đoán gì**, đúng như tool Timestamp làm với đơn vị. Đoán
im lặng mà sai thì người dùng không có cách nào biết. Ô chọn định dạng ghi đè cái đoán.

### 3.1 SQL

`sql-formatter`, đã là dependency. Ô chọn dialect: MySQL, PostgreSQL, SQLite, và SQL chuẩn.

Minify là một hàm gom khoảng trắng tự viết, và nó **phải hiểu chuỗi và comment**: gom khoảng trắng
bên trong `'chuỗi có   dấu cách'` là đổi dữ liệu, và nuốt dòng chứa `-- comment` mà không nuốt cả
phần đuôi của nó là biến phần còn lại của câu lệnh thành comment. Bộ test phủ đúng hai chỗ đó.

### 3.2 JSON không đi qua `JSON.parse`

Điểm thiết kế quan trọng nhất của tool này, và là chỗ nó tách khỏi trục ở mục 2.

`JSON.parse` rồi `JSON.stringify` là hai dòng và **làm hỏng dữ liệu im lặng**, đúng với thứ người
dùng module này hay dán vào:

| Vào | `JSON.parse` + `stringify` cho ra | Vấn đề |
| --- | --- | --- |
| `1787875200123456789` | `1787875200123456800` | Snowflake id, `BIGINT` của MySQL — mất chính xác |
| `{"2":"a","1":"b"}` | `{"1":"b","2":"a"}` | Khoá dạng số bị JS sắp lại |
| `1.50` | `1.5` | Số tiền in ra khác lúc dán vào |
| `"\u0041"` | `"A"` | Escape bị mở, không còn giống nguồn |

Không cái nào trong bốn dòng đó báo lỗi. Người dùng chép kết quả đi và mang theo một id sai.

Nên JSON đi qua một **bộ tách token tự viết chỉ in lại khoảng trắng**: đọc chuỗi (kèm escape), số,
`true`/`false`/`null`, và các ký tự cấu trúc — rồi phát lại đúng từng token nguyên văn với thụt lề
mới. Số được giữ nguyên **lát cắt nguồn**, không bao giờ đi qua `Number`. Khoá giữ nguyên thứ tự
xuất hiện. Escape giữ nguyên như đã viết.

```ts
export interface JsonSyntaxError {
  /** Vị trí ký tự trong nguồn, và dòng/cột suy ra từ nó — Panel chỉ đúng chỗ. */
  index: number;
  line: number;
  column: number;
  message: string;
}

export type JsonResult =
  | { ok: true; output: string }
  | { ok: false; error: JsonSyntaxError };

export function formatJson(text: string, indent: string): JsonResult;
export function minifyJson(text: string): JsonResult;
```

Chừng 150 dòng, và minify là cùng bộ tách token với thụt lề rỗng — không phải hàm thứ hai. Cùng loại
lập luận với `md5.ts` tự viết ở giai đoạn 1: không kéo thư viện về, và đổi lại được đúng thứ thư viện
không cho.

Test: bốn dòng của bảng trên đi vào ra nguyên vẹn; JSON lồng nhiều tầng; mảng rỗng và object rỗng in
thành `[]` và `{}` chứ không xuống dòng; và vị trí lỗi đúng cho dấu phẩy thừa, khoá không ngoặc kép,
chuỗi chưa đóng.

### 3.3 XML

**Không dùng `DOMParser`.** Nó là API của trình duyệt và không tồn tại trong Node, mà vitest chạy
trong Node và repo cố ý không có jsdom — nên mọi test cho phần XML sẽ không chạy được. Một tool có
cùng loại bẫy im lặng như JSON ở 3.2 mà lại là tool duy nhất trong module không test được là cái giá
quá cao để đổi lấy vài chục dòng.

Thay vào đó: một bộ parse XML tự viết ra cây nhẹ, rồi một hàm in cây đó ra có thụt lề. Cùng hình với
bộ tách token JSON, cùng lý do.

```ts
export type XmlNode =
  | { kind: "element"; name: string; attrs: string; selfClosing: boolean; children: XmlNode[] }
  /** Comment, CDATA, processing instruction và doctype đi qua nguyên văn — không có gì để in lại. */
  | { kind: "text" | "comment" | "cdata" | "pi" | "doctype"; raw: string };
```

Đổi lại còn được thứ `DOMParser` không cho: lỗi có **vị trí**. Thẻ chưa đóng và thẻ đóng lệch tên
đều chỉ đúng chỗ, thay vì một phần tử `parsererror` với câu chữ khác nhau ở mỗi trình duyệt.

Comment, CDATA, processing instruction và doctype giữ nguyên trạng.

Một luật, vì phá nó là đổi tài liệu: **không thụt lề lại nội dung hỗn hợp.** Phần tử có cả text lẫn
phần tử con — `<p>xin <b>chào</b> bạn</p>` — thì khoảng trắng *là* dữ liệu, và thêm xuống dòng vào
giữa là đổi thứ trình đọc nhận được. Những phần tử này in nguyên một dòng. Chỉ phần tử toàn con hoặc
toàn text mới được thụt lề.

Minify: bỏ node text chỉ có khoảng trắng nằm giữa các phần tử, không đụng vào text bên trong nội
dung hỗn hợp.

## 4. Chuyển đổi (`convert`)

Hai ô chọn — **Từ** ∈ {JSON, YAML, CSV} và **Sang** ∈ {JSON, YAML, CSV, SQL INSERT} — và trục ở mục
2 nằm giữa. Chọn hai bên bằng nhau thì tool nói thẳng là không có gì để làm.

Khi giá trị ở trục không hợp với định dạng ra, tool **không xuất kết quả một phần**, và nói đích
danh vì sao: "CSV cần một mảng các object phẳng; nhận được một object". Cùng một luật với tool
SQL→Mongo ở giai đoạn 2, và cùng một lý do — một bảng CSV thiếu mất cột lồng nhau trông y hệt một
bảng đúng.

### 4.1 YAML

`js-yaml`, `await import()` trong hàm chuyển đổi ở lần dùng đầu, giống hệt cách `node-sql-parser`
được nạp ở giai đoạn 2. `load` để đọc, `dump` với `noRefs` và không giới hạn độ rộng dòng để ghi.

`js-yaml` v4 theo YAML 1.2, nên `yes` và `no` vẫn là chuỗi chứ không thành boolean — cái bẫy nổi
tiếng của YAML 1.1 không có ở đây, và bộ test ghim điều đó lại phòng khi ai đó nâng phiên bản.

### 4.2 CSV

Tự viết, cả hai chiều, theo RFC 4180. Ô chọn dấu phân cách (`,` `;` tab `|`) và ô chọn có dòng tiêu
đề hay không.

Phần khó nằm ở dấu ngoặc kép, và nó là toàn bộ lý do không dùng `split(",")`: một trường có ngoặc
kép thì dấu phân cách, xuống dòng và cả ngoặc kép đôi `""` đều nằm được bên trong nó. Bộ test là một
bảng case phủ từng thứ đó, cộng CRLF, cộng trường rỗng ở đầu và cuối dòng.

Chiều ngược lại — mảng object thành CSV — lấy hợp các khoá của mọi phần tử làm cột, theo thứ tự xuất
hiện lần đầu; khoá thiếu ở một dòng thành ô rỗng.

### 4.3 Giá trị CSV luôn là chuỗi

Đọc CSV **không đoán kiểu**. `007` ra `"007"`, không phải `7`; `true` ra `"true"`.

Đây là quyết định, không phải sự lười. Mã bưu chính, mã sản phẩm, số điện thoại có số 0 đứng đầu —
đoán kiểu là mất số 0 đó, im lặng, và cột đã mất thì không lấy lại được ở đầu ra. Người biết cột nào
là số là người dùng, không phải tool.

### 4.4 SQL INSERT

Một chiều. Cần: ô tên bảng, ô chọn dialect (MySQL / PostgreSQL), và ô chọn "mỗi dòng một câu lệnh"
hay "một câu lệnh nhiều dòng giá trị".

Ánh xạ giá trị: `null` và `undefined` thành `NULL`; số và boolean in trần; object và mảng thành
chuỗi JSON; còn lại là chuỗi có ngoặc.

**Escape chuỗi khác nhau theo dialect, và đây là chỗ dịch sai mà chạy êm.**

- Cả hai: `'` thành `''`.
- MySQL còn coi `\` là ký tự escape trong chuỗi (mặc định, khi `NO_BACKSLASH_ESCAPES` tắt), nên `\`
  phải thành `\\`. Bỏ qua bước này thì một đường dẫn Windows `C:\new\table` vào DB thành một ký tự
  xuống dòng và một tab.
- PostgreSQL với `standard_conforming_strings` bật — mặc định từ 9.1 — thì **không** escape `\`. Làm
  thêm ở đây là ghi thừa một dấu `\` vào dữ liệu.

Cùng họ với chỗ `LIKE` sang `$regex` ở giai đoạn 2: escape sai không làm câu lệnh hỏng, nó làm câu
lệnh chạy và ra dữ liệu khác.

Đầu ra kèm một dòng nói rõ: đây là câu lệnh để đọc và dán tay, **không phải cách thay cho truy vấn
tham số hoá**. Tool không biết dữ liệu đến từ đâu, và một người dán output của nó vào code là một lỗ
SQL injection.

## 5. Sinh schema (`schema`)

JSON vào — một object, hoặc một mảng object làm mẫu — và ba đầu ra chọn bằng ô chọn: `CREATE TABLE`,
`interface` TypeScript, `struct` Go.

Phần đáng test không phải ba bộ sinh mã mà là **bước suy luận** trước chúng:

```ts
export type JsonType =
  | "string" | "number" | "integer" | "boolean" | "null" | "object" | "array" | "unknown";

export interface Field {
  /** Khoá đúng như trong JSON. Việc đổi tên là của bộ sinh mã, không phải của bước suy luận. */
  name: string;
  /** Mọi kiểu đã thấy ở khoá này qua các phần tử mẫu. */
  types: JsonType[];
  /** Khoá vắng mặt ở ít nhất một phần tử của mảng mẫu. */
  optional: boolean;
  /** Với object: các trường con. Với mảng: hình dạng của phần tử. */
  children?: Field[];
}

export function inferSchema(value: unknown): Field[];
```

Luật hợp nhất khi mẫu là một mảng: hợp các khoá của mọi phần tử; khoá vắng ở phần tử nào thì
`optional`; `integer` gặp `number` thì nới thành `number`; gặp `null` thì thành nullable chứ không
thành `unknown`; mảng rỗng và `null` đơn độc thì `unknown` — và ba bộ sinh mã đều in ra thứ dễ thấy
(`TEXT`, `unknown`, `any`) chứ không đoán bừa.

**Đặt tên dùng lại `convert()` của tool Đổi kiểu chữ** — `snake_case` cho cột SQL, `PascalCase` cho
field Go, giữ nguyên cho TypeScript. Đây là lần đầu hai tool trong module gọi nhau, và nó đi đúng
chiều: logic thuần gọi logic thuần, không Panel nào biết Panel nào.

**Đoán cột thời gian** dùng lại phần nhận diện ISO 8601 của `timestamp/time.ts`: chuỗi trông như
`2026-08-28T00:00:00Z` thành cột thời gian chứ không thành `VARCHAR(255)`.

Ánh xạ sang SQL:

| Suy ra | MySQL | PostgreSQL |
| --- | --- | --- |
| `string` | `VARCHAR(255)` | `VARCHAR(255)` |
| `string` trông như ISO 8601 | `DATETIME` | `TIMESTAMPTZ` |
| `integer` | `BIGINT` | `BIGINT` |
| `number` | `DOUBLE` | `DOUBLE PRECISION` |
| `boolean` | `TINYINT(1)` | `BOOLEAN` |
| `object` / `array` | `JSON` | `JSONB` |
| chỉ thấy `null` | `TEXT` | `TEXT` |

`BIGINT` chứ không `INT` vì mẫu chỉ là mẫu, và một cột `INT` tràn ở bản ghi thứ hai tỉ là chuyện sửa
lúc production. Object lồng nhau thành **một cột JSON**, không trải phẳng thành `a_b_c`: trải phẳng
là một quyết định về mô hình dữ liệu, và tool không có đủ thông tin để thay người dùng quyết.

TypeScript in interface lồng, `?` cho `optional`, `| null` cho nullable, và bọc ngoặc kép khoá nào
không phải định danh hợp lệ. Go in struct lồng, tag `json:"khoá_gốc"`, con trỏ cho nullable, `[]T`
cho mảng.

## 6. Biến môi trường (`env`)

Bốn dạng, đọc được hai, ghi được bốn:

| Dạng | Đọc | Ghi |
| --- | --- | --- |
| `.env` (kể cả có `export `) | có | có |
| JSON phẳng | có | có |
| `export KEY=VALUE` | — | có |
| `-e KEY=VALUE` cho docker | — | có |

Trục là `EnvPair[]` — một danh sách có thứ tự, không phải `Record`, vì thứ tự dòng trong `.env` là
thứ người viết cố ý và đảo nó là làm phiền người đọc lần sau.

Đọc `.env` là chỗ nhiều luật vụn, và mỗi luật là một dòng test: bỏ dòng trống và dòng `#`; bỏ tiền
tố `export ` nếu có; giá trị không ngoặc thì cắt khoảng trắng cuối và cắt phần `# comment` phía sau;
giá trị trong ngoặc đơn là nguyên văn; giá trị trong ngoặc kép thì `\n`, `\t`, `\"`, `\\` được mở;
và giá trị trong ngoặc được phép trải nhiều dòng.

Ghi thì bọc ngoặc khi giá trị có khoảng trắng, `#`, ngoặc kép, hoặc xuống dòng. Riêng dạng docker
bọc theo luật shell — ngoặc đơn, và dấu nháy đơn bên trong được đóng, escape, mở lại — vì đầu ra của
nó được dán vào một dòng lệnh thật.

Đây là tool duy nhất của giai đoạn mà người dùng gần như chắc chắn dán mật khẩu vào. Nó không lưu gì
cả, như mọi tool khác trong module, và mục "phi mục tiêu" ở trên là chỗ điều đó được ghim.

## 7. Diff (`diff`)

Hai ô vào, một danh sách kết quả. Thuật toán là LCS theo dòng, tự viết, chừng 80 dòng.

```ts
export interface DiffLine {
  kind: "same" | "add" | "remove";
  /** Số dòng ở mỗi bên, hoặc null nếu dòng không tồn tại bên đó. */
  leftNo: number | null;
  rightNo: number | null;
  text: string;
}

export type DiffResult =
  | { ok: true; lines: DiffLine[]; added: number; removed: number }
  | { ok: false; reason: "tooLarge" };
```

LCS là O(n×m) cả thời gian lẫn bộ nhớ, và bộ nhớ mới là chỗ đau: một bảng 5000×5000 ô 4 byte là
**95 MB** cho một lần bấm. Nên hai bước, theo đúng thứ tự:

1. **Cắt phần đầu và phần đuôi giống nhau** trước khi chạy LCS. Mười dòng khác nhau giữa hai file 50
   nghìn dòng thì bảng chỉ còn 10×10. Đây là thứ làm tool dùng được với file thật, và nó là chừng
   mười dòng code.
2. **Chặn phần giữa ở 2000 dòng mỗi bên** — 16 MB, chấp nhận được — và trả `tooLarge` kèm một câu
   giải thích khi vượt.

Không chặn thì hai file thật sự khác nhau hoàn toàn làm treo cả cửa sổ, và trong một app desktop thì
đó là mất tab chứ không phải chờ lâu.

Ba ô đánh dấu: bỏ qua khoảng trắng, bỏ qua hoa thường, và **so sánh như JSON** — ô cuối chạy cả hai
bên qua `formatJson` ở 3.2 trước khi diff, nên hai đoạn JSON viết một dòng và viết thụt lề không còn
khác nhau. Bên nào không parse được thì báo, không diff.

**Không sắp xếp khoá.** Đổi thứ tự khoá *là* một khác biệt thật, và một tool nói "hai cái này giống
nhau" trong khi chúng khác nhau thì tệ hơn một tool ồn ào. Nếu về sau có ai thấy phiền thì thêm một ô
đánh dấu nữa, không phải đổi mặc định.

## 8. Regex (`regex`)

Ô mẫu, các cờ `g` `i` `m` `s` `u` bằng ô đánh dấu, ô văn bản thử, và ô thay thế. Ra: số lượng match,
văn bản có tô match, bảng nhóm bắt (kể cả nhóm có tên), và bản xem trước sau khi thay thế.

### 8.1 Regex chạy trong Worker

Một mẫu như `(a+)+$` gặp chuỗi 30 ký tự là vòng lặp không lối ra. Trên luồng chính thì đó là **mất
cả cửa sổ app** — không phải một tool chậm, mà một cửa sổ Tauri không vẽ lại được nữa và người dùng
phải giết tiến trình. Regex là tool duy nhất trong module mà đầu vào của người dùng có thể làm việc
đó, nên nó là tool duy nhất cần biện pháp.

`src/modules/tools/tools/regex/worker.ts`, nạp bằng
`new Worker(new URL("./worker.ts", import.meta.url), { type: "module" })` — cách Vite hiểu sẵn,
không cần cấu hình. Panel gửi `{ pattern, flags, subject, replacement }` và đặt hạn **1 giây**; hết
giờ thì `terminate()`, dựng worker mới, và báo: mẫu này quá tốn, nhiều khả năng là backtracking.

Mẫu sai cú pháp thì `SyntaxError` từ `new RegExp` được in nguyên văn — thông báo của engine đã chỉ
đúng chỗ, viết lại chỉ làm mờ đi.

### 8.2 Match rỗng

Cái bẫy thứ hai, và nó nằm trong chính vòng lặp thu match: một mẫu khớp rỗng — `/(?=a)/g`, `/a*/g` —
làm `lastIndex` đứng yên và `exec` trả về mãi mãi. Vòng lặp phải tự đẩy `lastIndex` lên một khi
match rỗng. Bộ test có cả hai mẫu đó.

## 9. Dependency và bundle

`js-yaml` cộng `@types/js-yaml`. Hết.

Nạp bằng `await import("js-yaml")` bên trong hàm chuyển đổi, không phải ở đầu file Panel — nên nó
xuống đĩa ở lần đầu ai đó thực sự đổi YAML, không phải lúc mở tab. Đúng cách `node-sql-parser` được
nạp ở giai đoạn 2.

Bốn thứ **không** kéo về, và lý do:

- **prettier** — bản phác của spec mẹ định dùng nó cho JS/TS/CSS/HTML/MD. Nhưng format một file JS
  là việc editor đã làm rồi, nên nó trượt tiêu chí nhận tool; và nó sẽ là dependency lớn nhất repo
  từng thêm, cho phần giá trị thấp nhất giai đoạn. Repo hiện không có prettier ở bất kỳ đâu, kể cả
  devDependency.
- **thư viện CSV** — phần khó là ngoặc kép lồng, và nó là 60 dòng đáng test.
- **thư viện diff** — LCS theo dòng là 80 dòng.
- **thư viện XML** — bộ parse ở 3.3 là 150 dòng, và nó chạy được trong test, khác với `DOMParser`.
- **jsdom** — phi mục tiêu của spec mẹ, và 3.3 đã bỏ thứ duy nhất cần tới nó.

## 10. Việc ngoài `src/modules/tools/`

- `package.json` — `js-yaml` và `@types/js-yaml`.
- `CHANGELOG.md` — một dòng dưới `## [Unreleased]`.

Không có mục thứ ba. Không icon, không nhóm i18n, không dòng nào trong `shell/registry.ts` — sáu
tool mới là sáu thư mục cộng sáu dòng trong `tools/registry.ts`, đúng như `ToolDefinition` hứa ở
giai đoạn 1.

## 11. Thứ tự làm

Mười bốn task. Format đi trước vì `formatJson` là thứ tool Diff dùng lại ở task 13.

| # | Task | Test |
| --- | --- | --- |
| 1 | `formatJson` / `minifyJson` — bộ tách token | Bảng bốn dòng ở 3.2, JSON lồng, vị trí lỗi |
| 2 | XML: parse ra cây, in có thụt lề, minify | Nội dung hỗn hợp, CDATA, thẻ đóng lệch |
| 3 | SQL minify, đoán định dạng | Chuỗi và comment trong SQL |
| 4 | Panel `format` + registry + i18n | — |
| 5 | CSV đọc/ghi | Bảng case RFC 4180 |
| 6 | YAML qua `js-yaml`, trục chuyển đổi | `yes` vẫn là chuỗi |
| 7 | Bộ sinh INSERT | Escape theo từng dialect |
| 8 | Panel `convert` + registry + i18n | — |
| 9 | `inferSchema` | Hợp nhất khoá, nới kiểu, optional |
| 10 | Ba bộ sinh mã | Ánh xạ ở mục 5, đặt tên, lồng nhau |
| 11 | Panel `schema` + registry + i18n | — |
| 12 | `.env` đọc/ghi bốn dạng + Panel + registry + i18n | Bảng luật ở mục 6 |
| 13 | `diffLines` + Panel + registry + i18n | Cắt đầu đuôi, `tooLarge`, so sánh như JSON |
| 14 | Regex worker + Panel + registry + i18n + CHANGELOG | Match rỗng, hạn 1 giây |
