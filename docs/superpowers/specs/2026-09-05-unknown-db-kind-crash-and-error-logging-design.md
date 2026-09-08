# Kind lạ không được làm app trắng màn hình, và có log để chẩn đoán

Ngày: 2026-09-05

## Mục tiêu

- Một `SavedConnection` trong `connections.json` có `config.kind` mà **bản đang chạy không biết**
  — vì một bản mới hơn đã tạo nó, rồi máy quay lại bản cũ; hoặc vì bản dev tạo connection kind mới
  và bản ổn định cài song song đọc phải file đó — không còn làm app crash trắng màn hình lúc mở lên.
- App còn sống đủ để: tab khác vẫn dùng được, nút kiểm tra cập nhật trong Cài đặt vẫn bấm được (tự
  thoát khỏi tình huống bằng cách cập nhật lên bản mới biết kind đó), và có một màn hình báo lỗi
  thay vì một khung trắng không nói gì.
- Có một file log trên máy ghi lại lỗi này (và lỗi tương tự sau này), mở lên xem được ngay từ trong
  app — không phải đoán mò như lần này.

## Phi mục tiêu

- **Không đụng vào `connections.json`.** Không tự xoá, không tự "sửa" connection có kind lạ — đó là
  dữ liệu người dùng, và bản đang chạy không có quyền quyết định nó sai.
- **Không mở `DbKind` thành union hở** (kiểu `DbKind | (string & {})`). Giữ nguyên type chặt lúc
  biên dịch; việc cần làm là phòng thủ ở **runtime** tại đúng những chỗ đọc dữ liệu đã lưu, không
  phải nới lỏng type để che triệu chứng.
- **Không thêm crash reporting gửi đi xa** (Sentry, telemetry...). Chỉ ghi log ra file cục bộ trên
  máy người dùng; gửi cho ai đó là việc người dùng tự làm, giống cách bug này được tìm ra.
- **Không cố phục hồi lại trạng thái tab đang crash** (form đang gõ dở, kết nối đang mở). Mục tiêu
  là phần *còn lại* của app không chết theo, không phải là tab đó tự lành.
- **Không sửa gì ở phía Rust.** `connect_db` và mọi command khác đã tự chối một `kind` lạ ở bước
  deserialize (xem bảng dưới) — đây thuần là lỗi phía webview.

## Hiện trạng

| Chỗ | Sự thật |
| --- | --- |
| [`src/modules/db/icons.tsx:80`](../../../src/modules/db/icons.tsx#L80) | `DatabaseIcon` làm `BRAND_MARKS[kind]` không có fallback. `BRAND_MARKS` là `Record<DbKind, ...>` do **bản build đó** liệt kê — một kind mới hơn cho ra `mark = undefined`, dòng kế `mark.viewBox` ném `TypeError` ngay trong lúc render |
| [`src/modules/db/DbTab.tsx:627-670`](../../../src/modules/db/DbTab.tsx#L627) | Màn hình mặc định lúc mở app (chưa connect) render `<DatabaseIcon kind={c.config.kind} .../>` cho **từng connection đã lưu** — đây là màn hình đầu tiên người dùng thấy, nên là đường crash chắc chắn gặp nhất |
| [`src/i18n/index.tsx:24-30`](../../../src/i18n/index.tsx#L24) | `resolve()` gọi thẳng `key.split(".")`. `KIND_LABEL[kind]` với kind lạ trả `undefined`, và `t(undefined)` ném `TypeError: Cannot read properties of undefined (reading 'split')` — **crash thứ hai, độc lập với cái trên**, cũng nổ ngay tại `DbTab.tsx:645` |
| Toàn `src/` | Không có React Error Boundary nào — đã grep xác nhận. Một lỗi render không bắt được làm React unmount toàn bộ cây, ra màn hình trắng |
| [`src/shell/update.ts:183`](../../../src/shell/update.ts#L183) | `useUpdateCheck` là một hook sống *bên trong* `App`; effect kiểm tra update chỉ chạy sau khi `App` mount xong (`STARTUP_CHECK_DELAY_MS` = 6s sau đó). App crash trước khi mount xong thì cơ chế tự cập nhật **không bao giờ chạy** — đúng như quan sát "không tự cập nhật được để hết lỗi" |
| Toàn app | Không có `tauri-plugin-log`, không Sentry, không try/catch ghi file nào — không có gì để mở lên xem khi có crash, không riêng bug này |
| [`src-tauri/src/modules/db/models.rs:7-8`](../../../src-tauri/src/modules/db/models.rs#L7) | `DbKind` phía Rust là `#[serde(rename_all = "lowercase")]` enum kín, không có `#[serde(other)]`. Một `kind` lạ khiến `connect_db` (và mọi command nhận `ConnectionConfig`) **lỗi ngay ở bước deserialize**, trước khi chạm code nghiệp vụ — nghĩa là các chỗ đọc `KIND_LABEL[...]` *sau khi đã connect* (badge của tab, tiêu đề mặc định) không thực sự reachable với kind lạ; chỉ sửa cho nhất quán, không phải vì chúng tự crash được |

Hai crash (icon và label) độc lập nhau — sửa một cái không hết bug, phải sửa cả hai.

## Quyết định nền: Error Boundary theo từng tab, không theo cả App

`App.tsx` đã có sẵn một `<Suspense>` **cho từng tab** (`App.tsx:303-311`), với đúng lý do đang cần
ở đây: *"One boundary per tab and not one around the list: a tab still loading must not take the
panes beside it off screen while it does."* Error Boundary đặt ở cùng chỗ, cùng lý do — một tab vỡ
không được kéo tab bên cạnh, thanh tab, hay `useUpdateCheck` (sống ở `App`, ngoài mọi boundary) chết
theo. Đây chính là đường tự thoát: tab vỡ, nhưng nút "Kiểm tra ngay" trong Cài đặt vẫn bấm được vì
`App` chưa bao giờ ngừng render.

Một boundary nữa bọc ngoài cùng `<App />` trong `main.tsx`, làm lưới an toàn cuối — phòng khi lỗi
nằm ngoài một tab cụ thể (thanh tab, `TabStrip` chính nó). Ít khả năng xảy ra hơn, nhưng rẻ.

## 1. Phòng thủ tại nguồn: `DatabaseIcon` và `KIND_LABEL`

`src/modules/db/icons.tsx`:

```tsx
export function DatabaseIcon({ kind, size = "1em", className, ...rest }: DatabaseIconProps) {
  // BRAND_MARKS chỉ có các kind bản build này biết. Một connection do bản mới hơn lưu, đọc lại
  // bằng bản cũ, mang một kind không có trong bảng — không phải bug ở đây, là dữ liệu đi trước
  // code. sqlite's cylinder đã là icon "chung chung" của repo này (xem comment tại BRAND_MARKS.sqlite),
  // nên dùng lại làm fallback thay vì vẽ thêm icon "unknown" mới.
  const mark = BRAND_MARKS[kind] ?? BRAND_MARKS.sqlite;
  ...
}
```

`src/modules/db/connectionForm.ts`: thêm một hàm tra bảng an toàn, dùng ở mọi nơi thay cho việc đọc
thẳng `KIND_LABEL[...]`:

```ts
/** `KIND_LABEL[kind]`, nhưng không crash khi `kind` là một giá trị union `DbKind` của bản build
 *  này không thật sự liệt kê — dữ liệu từ `connections.json` chỉ được *gán kiểu* `DbKind`, không
 *  được xác minh lúc đọc. Xem docs/superpowers/specs/2026-09-05-unknown-db-kind-crash-and-error-logging-design.md. */
export function kindLabel(kind: DbKind): TranslationKey {
  return (KIND_LABEL as Partial<Record<string, TranslationKey>>)[kind] ?? "connection.kindUnknown";
}
```

Thêm khoá `connection.kindUnknown` vào `src/modules/db/i18n/{en,vi}.ts` (`"Unknown"` / `"Không rõ"`).

Đổi cả 6 chỗ đang đọc `KIND_LABEL[...]` trực tiếp sang gọi `kindLabel(...)`
([`DbTab.tsx:203,448,645`](../../../src/modules/db/DbTab.tsx#L203),
[`SqlWorkspace.tsx:556`](../../../src/modules/db/sql/SqlWorkspace.tsx#L556),
[`ConnectionForm.tsx:235`](../../../src/modules/db/components/ConnectionForm/ConnectionForm.tsx#L235),
[`QueryEditor.tsx:314`](../../../src/modules/db/components/QueryEditor/QueryEditor.tsx#L314)) — kể
cả ba chỗ không thực sự reachable với kind lạ (xem bảng Hiện trạng), để không còn *chỗ nào trong
repo* đọc thẳng `KIND_LABEL[kind đến từ dữ liệu]` nữa. Một hàm, mọi nơi, giống cách `isSqlKind` đã
là nguồn sự thật duy nhất cho "kind này có phải SQL không".

## 2. `resolve()` không được crash vì key không phải string

Lưới an toàn thứ hai, ở tầng thấp hơn — phòng cho *bất kỳ* bảng tra cứu nào khác trong app rơi vào
đúng dạng lỗi này sau này, không riêng `KIND_LABEL`:

`src/i18n/index.tsx`:

```ts
function resolve(dict: TranslationDict, key: TranslationKey): string {
  // key luôn là string lúc biên dịch, nhưng một Record<SomeUnion, TranslationKey> tra bằng giá trị
  // đọc từ đĩa có thể trả undefined lúc chạy — xem docs/superpowers/specs/2026-09-05-....md.
  if (typeof key !== "string") return String(key);
  const value = key.split(".").reduce<unknown>((acc, part) => {
    if (acc && typeof acc === "object" && part in acc) return (acc as Record<string, unknown>)[part];
    return undefined;
  }, dict);
  return typeof value === "string" ? value : key;
}
```

Đúng tinh thần đã ghi trong [i18n.md](../../../.agent/conventions/i18n.md): *"An unknown key
resolves to the key string itself rather than throwing"* — chỉ là quy tắc đó chưa tính tới trường
hợp bản thân `key` không phải string.

## 3. Error Boundary

`src/components/ErrorBoundary/ErrorBoundary.tsx` — component class (bắt buộc phải là class,
`componentDidCatch`/`getDerivedStateFromError` không có bản hook), theo đúng
[component-structure](../../../.agent/conventions/component-structure.md):

```tsx
interface Props {
  children: ReactNode;
  /** Bản gọn cho lưới an toàn ngoài cùng ở main.tsx, khác bản trong mỗi tab: không có gì để "thử
   *  tab khác" khi cả App vỡ, nên câu và nút phải khác. */
  variant?: "tab" | "app";
}
interface State {
  error: Error | null;
}

class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    void logError("react", error, info.componentStack);
  }

  render() {
    if (this.state.error) return <ErrorFallback variant={this.props.variant ?? "tab"} onReset={...} />;
    return this.props.children;
  }
}
```

`ErrorFallback` dùng `useTranslation`, hai khoá mới `error.crashedTab` / `error.crashedApp` ở
`src/i18n/{en,vi}.ts` (`error.*` dùng chung đã có sẵn theo quy ước). Nút *Thử lại* set lại state về
`{ error: null }` — đóng tab đó lại nếu vẫn vỡ thì người dùng tự đóng bằng nút X trên thanh tab, có
sẵn rồi.

Bọc trong `src/shell/App.tsx`, cạnh `<Suspense>` đang có (dòng 303):

```tsx
<ErrorBoundary key={tab.id}>
  <Suspense fallback={<LoadingOverlay />}>
    <Tab ... />
  </Suspense>
</ErrorBoundary>
```

`key={tab.id}`: đổi tab id (đóng tab vỡ, mở tab mới) phải là một boundary mới, không phải boundary
cũ còn nhớ `state.error`.

Bọc `<App />` trong `src/main.tsx` bằng `<ErrorBoundary variant="app">` — lưới an toàn ngoài cùng.

## 4. Lỗi ngoài React

`main.tsx`, trước `ReactDOM.createRoot(...)`:

```ts
window.addEventListener("error", (e) => void logError("window", e.error ?? e.message));
window.addEventListener("unhandledrejection", (e) => void logError("promise", e.reason));
```

Chỉ ghi log, không render gì — phần UI (không để app đứng im, không để trắng màn hình) là việc của
Error Boundary ở trên; hai handler này bắt phần Error Boundary không với tới được (lỗi trong một
`setTimeout`, một promise không ai `await`, ...).

## 5. Ghi log ra file — `tauri-plugin-log`

**Rust** (`src-tauri/Cargo.toml`, cùng nhóm với các `tauri-plugin-*` khác):

```toml
tauri-plugin-log = "2"
```

`src-tauri/src/lib.rs`, thêm vào chuỗi `.plugin(...)` đang có, cạnh `tauri_plugin_store`:

```rust
.plugin(
    tauri_plugin_log::Builder::new()
        .target(tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::LogDir { file_name: None }))
        .max_file_size(5_000_000) // ~5MB, đủ cho một phiên; cũ hơn thì rotate
        .build(),
)
```

`src-tauri/capabilities/default.json`: thêm `"log:default"` vào mảng `permissions`, cùng chỗ
`"updater:default"` đang đứng.

**Frontend**: thêm `@tauri-apps/plugin-log` (`^2`) vào `package.json`, cùng nhóm các
`@tauri-apps/plugin-*` khác.

`src/core/log.ts` — một hàm, dùng ở cả Error Boundary lẫn hai `window` handler ở mục 4:

```ts
import { error as pluginError } from "@tauri-apps/plugin-log";

/** Ghi một lỗi không bắt được ra file log của app, kèm nguồn (`react` | `window` | `promise`) và
 *  ngữ cảnh nếu có. Nuốt lỗi của chính việc ghi log — một crash log gãy không được phép thành
 *  crash thứ hai. */
export async function logError(source: string, error: unknown, context?: string): Promise<void> {
  try {
    const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
    await pluginError(`[${source}] ${message}${context ? `\n${context}` : ""}`);
  } catch {
    // Không còn gì làm được nữa — console là chỗ duy nhất còn lại, và chỉ dev mở devtools mới thấy.
    console.error(source, error);
  }
}
```

## 6. Mở thư mục log từ Cài đặt

Có file log mà không ai tìm ra thư mục thì cũng như không — đúng điều đang thiếu ở lần này.

`src/shell/components/SettingsModal/UpdateSection.tsx`, một hàng cạnh nút *Chính sách riêng tư*
đang có (dòng 107-116), cùng khuôn:

```tsx
import { appLogDir } from "@tauri-apps/api/path";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
...
<div className={styles.updateRow}>
  <span className={styles.hint}>{t("settings.logHint")}</span>
  <button type="button" className={styles.toolButton} onClick={() => void appLogDir().then(revealItemInDir)}>
    {t("settings.openLogFolder")}
  </button>
</div>
```

`revealItemInDir` đã nằm trong `tauri-plugin-opener`, đã cài, đã có quyền `opener:allow-open-url` —
cần thêm `opener:allow-reveal-item-in-dir` vào `capabilities/default.json`.

Hai khoá mới trong `src/i18n/{en,vi}.ts`: `settings.logHint`, `settings.openLogFolder`.

## Giao diện

| File | Việc |
| --- | --- |
| `src/modules/db/icons.tsx` | `DatabaseIcon` fallback về `BRAND_MARKS.sqlite` |
| `src/modules/db/connectionForm.ts` | Hàm `kindLabel()`, export cạnh `KIND_LABEL` |
| `src/modules/db/i18n/{en,vi}.ts` | `connection.kindUnknown` |
| `src/modules/db/DbTab.tsx`, `sql/SqlWorkspace.tsx`, `components/ConnectionForm/ConnectionForm.tsx`, `components/QueryEditor/QueryEditor.tsx` | Đổi `KIND_LABEL[x]` → `kindLabel(x)`, 6 chỗ |
| `src/i18n/index.tsx` | `resolve()` chịu được `key` không phải string |
| `src/components/ErrorBoundary/` | `ErrorBoundary.tsx`, `ErrorFallback.tsx` (hoặc gộp chung file), `.module.css`, `index.ts` — theo [component-structure](../../../.agent/conventions/component-structure.md) |
| `src/i18n/{en,vi}.ts` | `error.crashedTab`, `error.crashedApp`, `error.tryAgain`, `settings.logHint`, `settings.openLogFolder` |
| `src/core/log.ts` | `logError()` |
| `src/main.tsx` | Boundary ngoài cùng, hai `window` listener của mục 4 |
| `src/shell/App.tsx` | Boundary quanh mỗi tab, cạnh `<Suspense>` |
| `src/shell/components/SettingsModal/UpdateSection.tsx` | Nút "Mở thư mục log" |
| `src-tauri/Cargo.toml`, `src-tauri/src/lib.rs`, `src-tauri/capabilities/default.json` | `tauri-plugin-log`, permission `log:default` và `opener:allow-reveal-item-in-dir` |
| `package.json` | `@tauri-apps/plugin-log` |

## Kiểm thử

**`npm test`** — phần thuần:

- `kindLabel()`: trả đúng khoá cho một kind hợp lệ; trả `"connection.kindUnknown"` cho một chuỗi ép
  kiểu `as DbKind` mà `KIND_LABEL` không có (mô phỏng đúng dữ liệu từ bản mới hơn).
- `resolve()` (hoặc `t()` qua `I18nProvider` test hiện có, nếu có): không throw khi key là
  `undefined`/không phải string.
- `DatabaseIcon`: render với một `kind` ép kiểu không có trong `BRAND_MARKS`, không throw, ra đúng
  `viewBox` của `BRAND_MARKS.sqlite`.

**Bằng tay** (`npm run dev:app`):

1. Sửa tay một dòng trong `connections.json` của profile dev thành
   `"kind": "totally-unknown-kind"`, mở lại app — sidebar phải lên bình thường, connection đó có
   icon chung chung và nhãn "Không rõ" thay vì trắng màn hình.
2. Thử bấm vào connection đó — form load lên (kind lạ không có trong danh sách chọn kind, form cứ
   hiện những gì `formFrom` đọc được); bấm Connect thì lỗi hiện ra như một `ErrorBanner` bình
   thường (từ chối phía Rust ở bước deserialize), không phải trắng màn hình.
3. Mở Cài đặt → mục cập nhật vẫn hoạt động, bấm "Kiểm tra ngay" vẫn chạy được — chứng minh crash cũ
   (nếu ép cho một tab thật sự vỡ, ví dụ tạm thời throw trong `render()` của một component) không
   còn kéo `useUpdateCheck` chết theo.
4. Bấm "Mở thư mục log" trong Cài đặt → đúng thư mục mở ra, có file log, trong đó có dòng ghi lại
   lỗi ở bước 1/3 nếu đã ép crash thật (ví dụ throw có chủ đích trong một component để test riêng
   Error Boundary, rồi bỏ đi).
5. `cargo check` (không cần build đầy đủ) sau khi thêm `tauri-plugin-log`, xác nhận biên dịch được.

## Thứ tự commit

1. `fix(db): stop an unrecognised connection kind from blanking the app` — mục 1 và 2, tự nó đã hết
   bug, chưa có Error Boundary hay log.
2. `feat(shell): add an error boundary around each tab` — mục 3.
3. `feat(shell): log uncaught errors and crashes to a file` — mục 4, 5, 6.

Mỗi commit một dòng CHANGELOG theo [quy ước](../../../.agent/conventions/changelog.md), cả ba dưới
`### Fixed` (commit 1, bug có thật ở bản đã phát hành) và `### Added` (commit 2, 3, khả năng mới).

## Rủi ro và đánh đổi

- **`tauri-plugin-log` là dependency Rust mới** — cần `cargo check`/build lại toàn bộ sau khi thêm,
  tốn thời gian biên dịch một lần. Đổi lại là cách chuẩn, đã được Tauri maintain, thay vì tự viết
  ghi file tay (mở file, khoá ghi đồng thời, xoay vòng theo dung lượng).
- **Error Boundary chỉ bắt được lỗi trong lúc render/lifecycle của React**, không bắt lỗi trong event
  handler (`onClick` ném lỗi) hay trong code bất đồng bộ — đó là lý do mục 4 (window/unhandledrejection)
  tồn tại song song, không thay thế nhau.
- **`BRAND_MARKS.sqlite` làm fallback cho kind lạ** nghĩa là một kind mới trông giống SQLite trong
  sidebar cho tới khi người dùng cập nhật app — chấp nhận được, vì mục tiêu chỉ là "không trắng màn
  hình", không phải "hiển thị đúng logo của một kind bản này chưa từng biết".
- **Log file nằm trên máy người dùng, không tự gửi đi đâu cả.** Muốn debug một bug người dùng report
  thì vẫn phải xin họ tự mở thư mục log (giờ có nút) và gửi file — không tự động hơn được nếu không
  thêm crash reporting, việc đã loại ở Phi mục tiêu.
