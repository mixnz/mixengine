# Một nơi nhận phím tắt Ctrl/Cmd

Ngày: 2026-08-18

## Mục tiêu

Hôm nay mỗi chord `Ctrl/Cmd` sống trong `useEffect` của chính component dùng nó, và mỗi nơi tự đoán
lấy ngữ cảnh: một prop `active` truyền tay, một `document.querySelector('[role="dialog"]')`, một
`menu !== null`. Không nơi nào biết app có bao nhiêu phím tắt.

Sau refactor:

- **Toàn bộ chord `Ctrl/Cmd` được khai báo ở một chỗ, dạng dữ liệu** — id lệnh, chord mặc định, nhãn
  i18n, nhóm ngữ cảnh.
- **Đúng một `keydown` trên `window`** phân giải phím và gọi handler đang bật.
- **Settings có pane "Phím tắt"** liệt kê tất cả, sinh ra từ chính danh mục mà dispatcher dùng — nên
  bảng không thể nói khác hành vi.
- **Người dùng không nhận ra gì đã đổi.** Mọi phím làm đúng việc nó đang làm hôm nay.
- Thêm một phím tắt là một dòng dữ liệu cộng một `useShortcut`.
- Nền cho việc **cho người dùng đổi phím** ở đợt sau: id lệnh bất biến, chord tách khỏi handler, nhóm
  ngữ cảnh sẵn để trả lời "hai lệnh này có va nhau không".

## Phi mục tiêu

Ghi ra để không bị kéo vào:

- **Không làm remap trong đợt này.** Không store, không widget bắt phím, không báo trùng, không nút
  khôi phục mặc định. Đợt này chỉ có bảng đọc.
- **Không đụng phím không phải chord `Ctrl/Cmd`.** `Escape`, mũi tên, `Enter`/`Delete` trong lưới và
  sidebar ở nguyên chỗ cũ. Chúng là hành vi chuẩn của widget, không ai remap.
- **Không kéo keymap CodeMirror ra ngoài.** Undo, redo, search, autocomplete, `Mod+Shift+F` vẫn do
  editor tự xử.
- **Không đổi hành vi.** Kể cả những hành vi đáng ngờ — xem mục 3.
- **Không thêm jsdom hay test component.** Repo cố ý chỉ test logic thuần; thiết kế này chiều theo
  điều đó chứ không xin ngoại lệ.
- **Không tách component `<Kbd>` dùng chung.** Hai chỗ vẽ `<kbd>` chưa thành quy luật.

## Hiện trạng

Toàn bộ chord `Ctrl/Cmd` trong app:

| Chord | Việc | Ai giữ | Cách tự gác ngữ cảnh |
| --- | --- | --- | --- |
| `Mod+T` | Tab mới | `shell/App.tsx` | không gác gì |
| `Mod+W` | Đóng tab | `shell/App.tsx` | không gác gì |
| `Mod+A` | *nuốt*, để webview không bôi đen giao diện | `shell/App.tsx` | `isTextEntry` |
| `Mod+A` | Chọn mọi dòng | `SqlTable.tsx` | `active` + `menu` + dò `[role="dialog"]` + `isTextEntry` |
| `Mod+F` | Nhảy vào ô lọc | `SqlTable.tsx` | như trên |
| `Mod+R` | Bấm nút reload của pane đang xem | `core/reload.ts`, 5 pane đăng ký | `active` + dialog của pane, mỗi call site tự ghi |
| `Mod+Shift+F` | Format SQL | keymap CodeMirror | editor có focus |
| `Mod+Click` | Nhảy tới định nghĩa | `SqlEditor/lookup.ts` | chuột, không phải chord |
| `Mod+Shift+R`, `F5` | *bị nuốt* trong bản đóng gói | `core/reload.ts` | không phải lệnh |

Ba vấn đề:

1. **Ngữ cảnh bị đoán, mỗi nơi một kiểu.** Dòng `document.querySelector('[role="dialog"]')` trong
   [`SqlTable.tsx`](../../../src/modules/db/components/SqlTable/SqlTable.tsx) là chỗ lộ rõ nhất —
   comment ngay tại đó thừa nhận "component này không có state nào biết về các dialog đó".
2. **Không liệt kê được.** Không làm được bảng phím tắt, không phát hiện được chord trùng.
3. **Thứ tự chạy ngầm định.** `Mod+A` đúng nhờ `App.tsx` mount trước `SqlTable`, không nhờ luật nào.

Verification hiện có: `npm run build` (`tsc` strict + `vite build`), `npm test` (vitest, 10 file,
**toàn bộ là logic thuần — không có jsdom, không có test component**).

## 1. Mô hình dữ liệu

Thuần dữ liệu, không React, không DOM.

```ts
// src/core/shortcuts/types.ts

/** Chord không chứa ctrl/meta: modifier chính luôn do hasPrimaryModifier quyết định. */
export interface Chord {
  /** Thường hoá về chữ thường, so với e.key.toLowerCase(). */
  key: string;
  shift?: boolean;
  alt?: boolean;
}

export interface ShortcutDef {
  /** Bất biến. Đây là thứ remap sẽ gắn vào, và là thứ useShortcut gọi tên. */
  id: string;
  chord: Chord;
  labelKey: TranslationKey;
  /** Bỏ qua khi con trỏ đang ở nơi người dùng gõ chữ — xem core/textEntry. */
  whenTyping?: "ignore";
  /** Vẫn chạy khi có modal mở. Mặc định là không. */
  inModal?: true;
  /** Không handler nào bật thì vẫn preventDefault. Mặc định là để phím đi tiếp. */
  unhandled?: "swallow";
  /** Chỉ liệt kê trong bảng, dispatcher không đụng tới. Dành cho phím của CodeMirror. */
  owner?: "editor";
}

/** Nhóm hiện thành một mục trong bảng phím tắt. Gom trong dữ liệu nên không tồn tại
 *  được một scope thiếu nhãn. */
export interface ShortcutGroup {
  scope: string;
  labelKey: TranslationKey;
  defs: ShortcutDef[];
}
```

### Vì sao `Chord` không có `ctrl`/`meta`

[`core/platform.ts`](../../../src/core/platform.ts) tồn tại để giữ đúng một luật: chord là `⌘` trên
Mac và `Ctrl` ở nơi khác, và **modifier còn lại đang giữ là thứ loại chord đó ra**. `e.ctrlKey ||
e.metaKey` là câu trả lời rộng rãi và sai — nó khiến `Ctrl+A` chọn mọi dòng trên Mac, nơi `Ctrl` là
phím mở menu chuột phải.

Nếu `Chord` cho phép ghi `ctrl` hay `meta`, thì màn hình remap ở đợt sau sẽ là chỗ đầu tiên phá luật
đó. Registry chỉ nói `"A"`, `"Shift+F"`; modifier chính là ngầm định và không ai gán được.

### Danh mục

```ts
// src/shell/shortcuts.ts
export const SHELL_SHORTCUTS: ShortcutGroup[] = [
  {
    scope: "app",
    labelKey: "shortcuts.scope.app",
    defs: [
      { id: "app.newTab",   chord: { key: "t" }, labelKey: "shortcuts.newTab",   inModal: true },
      { id: "app.closeTab", chord: { key: "w" }, labelKey: "shortcuts.closeTab", inModal: true },
      { id: "pane.reload",  chord: { key: "r" }, labelKey: "shortcuts.reload" },
    ],
  },
];

// src/modules/db/shortcuts.ts
export const DB_SHORTCUTS: ShortcutGroup[] = [
  {
    scope: "db.data",
    labelKey: "sqlTable.shortcutScope",
    defs: [
      { id: "grid.selectAll", chord: { key: "a" }, labelKey: "sqlTable.shortcutSelectAll",
        whenTyping: "ignore", unhandled: "swallow" },
      { id: "grid.focusFilter", chord: { key: "f" }, labelKey: "sqlTable.shortcutFilter" },
    ],
  },
  {
    scope: "db.query",
    labelKey: "query.shortcutScope",
    defs: [
      { id: "editor.format", chord: { key: "f", shift: true }, labelKey: "query.shortcutFormat",
        owner: "editor" },
    ],
  },
];
```

`Mod+Shift+R` và `F5` **không** vào danh mục: chúng không phải lệnh mà là thứ bị nuốt.
`isBlockedReload` giữ nguyên.

`Mod+Click` cũng không vào: nó là cử chỉ chuột. Nếu muốn nó xuất hiện trong bảng thì đó là một dòng
chỉ-để-đọc thêm sau, không phải một `ShortcutDef`.

> **Danh mục là toàn cục, kể cả phần của module.** Dispatcher thấy mọi group bất kể tab nào đang mở,
> nên `unhandled: "swallow"` trên `grid.selectAll` — một def do module db sở hữu — nuốt `Mod+A` ở
> khắp app, kể cả trên tab của một module tương lai. Đó **đúng là hành vi hôm nay**: `App.tsx` nuốt
> `Mod+A` vô điều kiện ngoài ô nhập liệu. Chỗ hơi ngược là quyền đó nay nằm trong dữ liệu của db chứ
> không của shell. Nếu về sau thấy vướng, cách sửa là tách một def `app.blockSelectAll` của shell chỉ
> mang `unhandled: "swallow"`, không phải đổi cơ chế.

## 2. Runtime

Bốn file trong `src/core/shortcuts/`:

| File | Nội dung | Test |
| --- | --- | --- |
| `types.ts` | như trên | — |
| `decide.ts` | hàm thuần: toàn bộ luật | ✅ `decide.test.ts` |
| `store.ts` | singleton: danh mục, handler đang đăng ký, độ sâu modal | — |
| `useShortcut.ts` | `useShortcut`, `useShortcutDispatcher` | — |

Singleton ở tầng module chứ không phải React Context — giống `core/reload.ts` hôm nay, không thêm
provider nào bọc `App`.

### Quyết định là một hàm thuần

```ts
// src/core/shortcuts/decide.ts
export interface Press {
  key: string;      // đã toLowerCase
  shift: boolean;
  alt: boolean;
  mod: boolean;     // kết quả của hasPrimaryModifier
  typing: boolean;  // kết quả của isTextEntry
}

export type Decision =
  | { do: "run"; id: string }
  | { do: "swallow" }
  | { do: "nothing" };

export function decide(
  press: Press,
  groups: ShortcutGroup[],
  /** enabled: id của các handler đang bật, **theo thứ tự bật** — mới nhất ở cuối. Là mảng chứ
   *  không phải Set, vì bước 6 cần thứ tự để phá hoà một cách xác định. */
  ctx: { modalDepth: number; enabled: string[] },
): Decision;
```

Luật, theo thứ tự:

1. `!press.mod` → `nothing`.
2. `cands` = mọi def khớp chord (`key`, `shift`, `alt`). **Danh sách, không phải một** — xem mục 4.
3. Bỏ khỏi `cands` mọi def `owner: "editor"`.
4. `modalDepth > 0` → bỏ mọi def không `inModal`.
5. `press.typing` → bỏ mọi def `whenTyping: "ignore"`.
6. `live` = các id trong `ctx.enabled` mà có def tương ứng trong `cands`, **giữ thứ tự của
   `ctx.enabled`** (không phải thứ tự danh mục).
   - đúng 1 → `{ do: "run", id }`.
   - 2+ → **lỗi thật**: chạy phần tử cuối — cái được bật gần nhất — và `console.warn` khi
     `import.meta.env.DEV`.
   - 0 → có def nào trong `cands` mang `unhandled: "swallow"` thì `swallow`, không thì `nothing`.

Thứ tự phải lấy từ `ctx.enabled` chứ không từ `cands`: danh mục là dữ liệu tĩnh, nó không biết gì về
việc handler nào vừa lên màn hình. Lấy nhầm nguồn thì "cái bật gần nhất" thành một câu vô nghĩa và
việc phá hoà trở nên tuỳ hứng theo thứ tự khai báo.

Không DOM, không React, không thời gian. Test được toàn bộ bằng vitest.

### Phần chạm DOM

`useShortcutDispatcher(groups)` cài **đúng một** listener ở bubble phase, do shell gọi một lần trong
`App`:

```ts
function onKeyDown(e: KeyboardEvent) {
  // CodeMirror khai preventDefault: true trên keymap của nó và nằm trên chính element editor,
  // nên nó luôn chạy trước listener ở window. Editor có focus thì editor thắng.
  if (e.defaultPrevented) return;

  const d = decide(
    { key: e.key.toLowerCase(), shift: e.shiftKey, alt: e.altKey,
      mod: hasPrimaryModifier(e), typing: isTextEntry(e.target) },
    groups,
    // enabledIds(): string[] theo thứ tự bật, mới nhất ở cuối
    { modalDepth: store.modalDepth, enabled: store.enabledIds() },
  );

  if (d.do === "nothing") return;
  e.preventDefault();
  if (d.do === "run") store.run(d.id);
}
```

`preventDefault` gọi tập trung là một cải thiện an toàn thật, không chỉ là gọn hơn.
[`platform.ts`](../../../src/core/platform.ts) ghi rõ: trên Mac, chính `preventDefault` là thứ giữ
`⌘W` ở lại tab thay vì để menu AppKit đóng cửa sổ. Hôm nay mỗi handler phải tự nhớ; quên một chỗ là
mất phím vào hệ điều hành. Sau refactor thì không quên được.

### Hook đăng ký

```ts
useShortcut(id: string, handler: () => void, enabled: boolean): void
```

Nuốt luôn nghi thức đang bị chép ba lần trong repo — `useRef(handler); latest.current = handler` cộng
`useEffect` gác `active` cộng bind/unbind `window`. Handler vẫn được đọc tại thời điểm bấm phím, nên
đóng gói state tự do y như hiện tại.

Tham số thứ tư `when?: () => boolean` **chưa viết trong đợt này** — xem mục 4.

## 3. Ngữ cảnh đến từ ba nguồn, không nguồn nào là đoán

**`enabled`** — component tự biết mình có đang hiển thị hay không. Giữ nguyên như hôm nay:
`active && mode === "data"`. React state, đúng thứ React giỏi.

**`modalDepth`** — [`useDialogExit`](../../../src/components/dialogMotion.ts) thêm một `useEffect`
tăng khi mount, giảm khi unmount. **Cả 10 dialog trong app đều gọi hook này**, nên không file dialog
nào phải sửa. `ContextMenu.tsx` thêm một dòng tương tự, và `menu !== null` trong `SqlTable` biến mất
theo.

`Select` **không** đếm: nó dùng `role="listbox"` và hôm nay cũng không bị tính là dialog. Không hồi
quy.

**`typing`** — `isTextEntry` giữ nguyên, chỉ chuyển từ lời gọi rải rác thành cờ trong dữ liệu.

### Hành vi được giữ nguyên dù đáng ngờ

`Mod+T` và `Mod+W` hôm nay **vẫn chạy** khi có dialog mở — `App.tsx` không gác gì. Registry lần đầu
làm câu hỏi đó hiện ra thành một cờ phải điền, và câu trả lời trong đợt này là `inModal: true`:
**giữ nguyên**. Refactor mà đổi hành vi là refactor khó tin.

Nếu sau này thấy "đóng tab khi đang hỏi *Drop table?*" là sai, đó là một thay đổi riêng, và lúc đó nó
chỉ là sửa một cờ trong một dòng dữ liệu.

## 4. Hai lệnh dùng chung một chord

Chưa xảy ra hôm nay, nhưng đã nằm trong lộ trình: `Mod+A` có thể vừa là "chọn mọi dòng" trong lưới
SQL, vừa là "chọn mọi key" trong danh sách Redis.

**Cách đúng là hai lệnh riêng cùng chord mặc định**, không phải một lệnh tự rẽ nhánh theo focus:

| | Một lệnh rẽ theo focus | Hai lệnh, chung chord |
| --- | --- | --- |
| Bảng phím tắt | một dòng, giấu mất việc nó làm hai việc | hai dòng, mỗi dòng nói rõ ngữ cảnh |
| Remap | đổi một phím là đổi cả hai hành vi | mỗi lệnh gán phím riêng được |
| Logic focus | mỗi handler tự chế | một chỗ, một luật |

**Làm ngay:** bước 2 của `decide` trả về **danh sách** ứng viên. Đổi `.find` thành `.filter`. Gần như
miễn phí bây giờ, nhưng nếu chốt "một chord ⇒ một lệnh" thì sau này phải sửa cả lõi phân giải lẫn
logic báo trùng của màn hình remap.

**Chưa làm:** vị từ `when`. `enabled` là state React nên tách được tab với tab, pane với pane, nhưng
không tách được "con trỏ đang ở khối nào" — focus đổi mà React không render lại. Trường hợp *cùng màn
hình* cần một vị từ chạy tại lúc bấm phím:

```ts
useShortcut("grid.selectAll", fn, active && mode === "data",
            () => gridRef.current?.contains(document.activeElement) ?? false);
```

Tách hai tầng vì gộp lại thì phải re-render mỗi `focusin` — trả giá liên tục cho câu hỏi mỗi phút mới
hỏi một lần. Nhưng hôm nay chưa chord nào cần, nên nó là **tham số thứ tư tùy chọn thêm vào sau,
không đụng call site nào**. Ship code chưa ai dùng là thứ đợt này tránh.

> **Cảnh báo dùng.** Một chord mang hai nghĩa tùy focus chỉ dễ hiểu khi người dùng *nhìn thấy* được
> focus đang ở đâu. Không có viền focus rõ ràng cho hai khối đó thì phím trở thành "tùy hên xui" và
> người dùng học không nổi. Còn chord trống thì cho mỗi hành động một phím riêng vẫn tốt hơn. Đây là
> lưới an toàn cho lúc hết phím, không phải công cụ mặc định.

## 5. Bảng phím tắt và ranh giới module

### Module góp phím

```ts
// src/shell/module.ts — thêm đúng một trường, y hệt settings? đã có
export interface ModuleDefinition {
  settings?: ModuleSettingsSection;
  shortcuts?: ShortcutGroup[];
}

// src/shell/shortcuts.ts
export const ALL_SHORTCUTS = [...SHELL_SHORTCUTS, ...MODULES.flatMap((m) => m.shortcuts ?? [])];
```

**`core/shortcuts/` không có danh mục của riêng nó.** Nó là cơ chế thuần; shell bơm dữ liệu xuống khi
dựng dispatcher. Đây không phải chi tiết vụn: luật tầng ở
[frontend.md](../../../.agent/architecture/frontend.md) cho `core/` import `components/` và `i18n/`
mà thôi, nên `core/shortcuts` tự đi lấy danh sách là phá ranh giới ngay. Và đây cũng không phải event
bus giữa các module — nó là dịch vụ dùng chung ở `core/`, đúng loại mà `core/reload.ts` đã là.

### Pane Settings

Thêm một mục `shortcuts` vào `SECTIONS` của
[`SettingsModal`](../../../src/shell/components/SettingsModal/SettingsModal.tsx), **sau Appearance,
trước phần của module** — nó nói về toàn app, không về một module.

Cần `KeyboardIcon` mới trong `src/icons/icons.tsx` (chưa có), theo
[quy ước icon](../../../.agent/conventions/icons.md): nét vẽ trên lưới 24×24, export theo thứ tự chữ
cái trong `index.ts`.

Mỗi nhóm một tiêu đề; mỗi dòng là nhãn cộng chord vẽ bằng
[`shortcutLabel()`](../../../src/core/platform.ts) trong `<kbd>`. Chính hàm đang sinh tooltip hôm
nay, nên bảng và tooltip không thể nói khác nhau về cùng một phím.

Dòng `owner: "editor"` hiện **y như mọi dòng khác**, không dấu hiệu riêng. Cờ `owner` vẫn nằm trong
dữ liệu, nhưng UI chỉ dùng tới nó khi có remap — lúc đó nó mới mang nghĩa "dòng này không đổi được".
Bảng đợt này chỉ để đọc, nên phân biệt chúng là vẽ thứ chưa ai cần.

### i18n

[`dicts.ts`](../../../src/i18n/dicts.ts) có một kiểm tra ở tầng type: ngoài `error`, **không hai từ
điển nào được đặt trùng tên nhóm cấp một** — trùng là hỏng build. Nên:

- Shell sở hữu nhóm mới `shortcuts`: tiêu đề pane, nhãn nhóm `app`, nhãn lệnh của shell.
- Module db **không** mở nhóm `shortcuts` của riêng nó. Nhãn của nó nằm trong nhóm nó đã sở hữu:
  `sqlTable.*`, `query.*`.

Đây là điểm cộng: nhãn "Chọn mọi dòng" nằm cạnh phần chữ còn lại của lưới, đúng chỗ người dịch đang
nhìn.

## 6. Chia đợt

Bảy bước, mỗi bước kết thúc bằng `npm run build` xanh.

| # | Việc | Đổi hành vi? |
| --- | --- | --- |
| 1 | `types.ts`, `decide.ts`, `decide.test.ts` | không — chưa nối gì |
| 2 | `store.ts`, `useShortcut.ts`, dispatcher cài trong `App`, danh mục **rỗng** | không |
| 3 | Bộ đếm modal vào `useDialogExit` và `ContextMenu` | không — chưa ai đọc |
| 4 | `pane.reload`: viết lại `useReloadShortcut` thành vỏ mỏng bọc `useShortcut` | có, nhưng 5 call site không đụng |
| 5 | Chord của shell: `T`, `W`, `A`-nuốt. `App.tsx` chỉ còn giữ `isBlockedReload` | có |
| 6 | `Mod+A` / `Mod+F` của lưới. Xóa dò `[role="dialog"]` và `menu !== null` | có — **rủi ro nhất** |
| 7 | Pane Settings, `KeyboardIcon`, i18n, cập nhật `frontend.md`, CHANGELOG | không |

Bước 4 đi trước có chủ ý: `Mod+R` phủ rộng nhất (5 pane, 4 loại DB) nhưng **đã** tập trung sẵn ở
`core/reload.ts`, nên cắt nó sang cơ chế mới không làm xê dịch một call site nào. Cơ chế được chứng
minh trên diện rộng trước khi chạm vào chỗ khó.

Khoảng 18 file, phần lớn sửa vài dòng.

## 7. Kiểm chứng

`npm test` phủ `decide.ts` — toàn bộ luật ở mục 2. `npm run build` bắt lỗi kiểu.

**Không có gì tự động phủ phần nối dây.** Giảm thiểu bằng cách dồn mọi thứ đáng nghi vào `decide`;
phần còn lại là ~15 dòng keo. Thay thế cho test là danh sách dưới, chạy bằng `npm run dev:app`:

1. `Mod+T`, `Mod+W` trên thanh tab.
2. `Mod+R` trên từng pane: Data, Structure, Stats, Query, Mongo. Mở hai tab, đổi tab → tab nền
   **không** trả lời.
3. `Mod+R` sau lưng hộp thoại *Drop table?* → không chạy.
4. `Mod+A`: trong lưới chọn hết dòng; trong ô lọc chọn chữ trong ô; ở màn hình nhập kết nối không bôi
   đen giao diện.
5. `Mod+A` khi menu chuột phải đang mở → không chạy (thay cho `menu !== null` đã xóa).
6. `Mod+F` → vào ô lọc, và ô đang sửa dở **hoàn tác** chứ không ghi xuống.
7. `Mod+Shift+F` trong SQL editor → format. Bằng chứng dispatcher không cướp phím của CodeMirror.
8. **Trên Mac:** `⌘W` đóng tab chứ không đóng cửa sổ; `Ctrl+A` **không** chọn dòng.
9. **Bản đóng gói:** `Mod+R` không reload webview.
10. Bảng trong Settings khớp hành vi thật.

Mục 8 cần một máy Mac, mục 9 cần một bản build đóng gói. Không có thì ghi rõ **chưa kiểm chứng** ở
hai mục đó, không báo là xong. Mục 9 vốn đã được `frontend.md` tự đánh dấu *Unverified* từ trước.

## 8. Rủi ro

**`Mod+A` đang chạy hai đường (bước 6).** Hôm nay `App.tsx` nuốt *và* `SqlTable` hành động, đúng nhờ
thứ tự mount. Sau refactor phải là một đường duy nhất qua `unhandled: "swallow"`. Chỗ dễ vỡ nhất —
nên nó đứng riêng một bước, sau khi cơ chế đã chạy thật ở bước 4 và 5.

**Phím CodeMirror không `preventDefault`.** Chốt chặn `e.defaultPrevented` chỉ đỡ được phím nào
CodeMirror thật sự chặn. Hôm nay không có va chạm: `Mod+A` trong editor đã bị `isTextEntry` bắt vì
CodeMirror dựng bằng `contentEditable`. Nếu sau này thêm chord trùng keymap mặc định của editor thì
`whenTyping: "ignore"` là chỗ xử lý, không phải thêm ngoại lệ mới.

**`defaultPrevented` là con dao hai lưỡi.** Component nào lỡ `preventDefault` một chord vì lý do
riêng sẽ **âm thầm** vô hiệu phím global đó. Có chủ ý — đó là cách editor giữ phím — nhưng phải ghi
vào `frontend.md`, nếu không nó thành một giờ debug của ai đó.

**Modal đóng còn giữ khóa thêm ~130ms.** `useDialogExit` cố ý giữ dialog trong cây suốt animation
thoát, nên `Escape` rồi `Mod+R` ngay lập tức thì phím thứ hai bị nuốt. Không phải hồi quy — hôm nay
`document.querySelector` cũng vẫn thấy dialog đó y hệt.

**Không có test tự động cho phần nối dây.** Xem mục 7.

## 9. CHANGELOG

Một dòng ngắn dưới `### Changed`, theo
[quy ước changelog](../../../.agent/conventions/changelog.md):

```
- Phím tắt Ctrl/Cmd gom về một nơi, và Settings có bảng liệt kê chúng
```
