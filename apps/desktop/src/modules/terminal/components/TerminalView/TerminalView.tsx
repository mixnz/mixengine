import { useEffect, useRef, useState } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { Terminal } from "@xterm/xterm";
import { openUrl } from "@tauri-apps/plugin-opener";
import ContextMenu from "../../../../components/ContextMenu";
import { copyText } from "../../../../core/clipboard";
import { errorMessage } from "../../../../core/errors";
import { MODIFIER_LABEL, hasPrimaryModifier } from "../../../../core/platform";
import { isClaimed, pressOf, useShortcut } from "../../../../core/shortcuts";
import { useTranslation } from "../../../../i18n";
import {
  closeSession,
  openSession,
  resizeSession,
  writeSession,
  type SessionExit,
} from "../../api";
import { readText } from "../../clipboard";
import { useTerminalSettings, zoomTerminal } from "../../settingsStore";
import { shellKeeps } from "../../keys";
import { openableUrl } from "../../links";
import { openingKeystrokes } from "../../session";
import type { TerminalTarget } from "../../types";
import SearchBar from "../SearchBar";
import styles from "./TerminalView.module.css";

/** Kéo cửa sổ sinh ra hàng chục sự kiện một giây; đầu xa chỉ cần biết kích thước cuối cùng. */
const RESIZE_DEBOUNCE = 100;

interface Props {
  target: TerminalTarget;
  /** Cái ô *Chạy khi kết nối* của host đã lưu đang giữ, hoặc `null`. Gõ hộ đúng một lần cho mỗi
   *  phiên — kể cả phiên sinh ra từ nút Kết nối lại, vì đó cũng là một lần vào máy ấy. */
  runOnConnect: string | null;
  /** Tab nằm sau vẫn mounted và vẫn nhận byte — cái này chỉ quyết định focus và lúc nào đo lại. */
  active: boolean;
  /** Phiên đã mở xong. Với SSH thì đây là lúc kết nối, xác thực và xin pty đều đã qua — vài giây
   *  sau khi bấm nút, nên tab có gì đó để nói trong lúc chờ. */
  onOpened: () => void;
  onExit: (exit: SessionExit) => void;
  /** Phiên không mở được: sai mật khẩu, vân tay đổi, máy chủ không tới được. Khác `onError` ở chỗ
   *  nó nói rằng *không có phiên nào cả*, nên tab trả màn hình về form. */
  onFailed: () => void;
  /** Bỏ hẳn phiên đã kết thúc và quay về màn hình chọn đích. Khác `onExit` ở chỗ đó là người dùng
   *  nói, không phải shell nói. */
  onDismiss: () => void;
  onError: (message: string) => void;
}

function TerminalView({
  target,
  runOnConnect,
  active,
  onOpened,
  onExit,
  onFailed,
  onDismiss,
  onError,
}: Props) {
  const { t } = useTranslation();
  const settings = useTerminalSettings();
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const searchRef = useRef<SearchAddon | null>(null);
  const sessionRef = useRef<string | null>(null);
  /* Trong state chứ không trong ref: nó là điều kiện `enabled` của `terminal.copy`, và một ref đổi
     giá trị thì không có ai đăng ký lại phím tắt. */
  const [hasSelection, setHasSelection] = useState(false);
  /* Shell đã chết. Trong state chứ không chỉ trong biến `ended` của effect bên dưới, và cũng vì lý
     do ấy: nó quyết định phím tắt nào đang được đăng ký. */
  const [ended, setEnded] = useState(false);
  /* Thanh tìm đang mở hay không. Trong state chứ không trong ref: nó quyết định cái được vẽ. */
  const [searching, setSearching] = useState(false);
  /** Mỗi lần `Ctrl+F` được bấm, kể cả khi thanh đã mở — xem `SearchBar.focusSignal`. */
  const [findSignal, setFindSignal] = useState(0);
  /** Menu chuột phải đang mở ở đâu, theo toạ độ của cửa sổ. `null` là đang đóng. */
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);

  /* Cài đặt lúc dựng terminal đi qua ref: đổi cài đặt thì `term.options` được đặt lại tại chỗ —
     xem effect ở cuối — chứ không dựng lại cả màn hình và mở lại cả phiên. */
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  // Callback đi qua ref: effect mở phiên chỉ được chạy lại khi `target` đổi, không phải mỗi lần
  // cha render lại.
  const onOpenedRef = useRef(onOpened);
  onOpenedRef.current = onOpened;
  const onExitRef = useRef(onExit);
  onExitRef.current = onExit;
  const onFailedRef = useRef(onFailed);
  onFailedRef.current = onFailed;
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const tRef = useRef(t);
  tRef.current = t;
  const runOnConnectRef = useRef(runOnConnect);
  runOnConnectRef.current = runOnConnect;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const term = new Terminal({
      /* Bắt buộc, và không phải để cho vui: `registerDecoration` — cái addon tìm kiếm gọi để tô
         vàng các kết quả — nằm trong nhóm API còn đang đề xuất, và xterm *ném lỗi* khi cờ này tắt.
         Thiếu nó thì `findNext` văng ngay ở chữ đầu tiên người dùng gõ vào ô tìm, và cả thanh tìm
         trông như thể không tìm thấy gì. */
      allowProposedApi: true,
      fontFamily: settingsRef.current.fontFamily,
      fontSize: settingsRef.current.fontSize,
      cursorStyle: settingsRef.current.cursorStyle,
      cursorBlink: settingsRef.current.cursorBlink,
      scrollback: settingsRef.current.scrollback,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    const search = new SearchAddon();
    term.loadAddon(search);
    /* Địa chỉ trong màn hình mở bằng `Ctrl/Cmd+Click`, không phải bằng một cú bấm trơn: bấm trơn
       trong terminal là đặt con trỏ và bắt đầu bôi đen, và một dòng log dài đầy đường dẫn sẽ trở
       thành bãi mìn nếu mỗi cú chạm lại bật trình duyệt lên. `hasPrimaryModifier` chứ không phải
       `ctrlKey || metaKey` — trên máy Mac thì `Ctrl+Click` là cú mở menu ngữ cảnh, và nó phải giữ
       nguyên nghĩa ấy. Cái gì được mở thì `links.ts` trả lời. */
    const links = new WebLinksAddon(
      (event, uri) => {
        if (!hasPrimaryModifier(event)) return;
        const url = openableUrl(uri);
        if (url === null) return;
        void openUrl(url).catch((e) => onErrorRef.current(errorMessage(tRef.current, e)));
      },
      {
        /* xterm gạch chân mọi thứ regex của nó nhặt được, kể cả cái sẽ không mở. Chú thích này là
           chỗ duy nhất nói ra hai điều đó: phải giữ phím nào, và cái dưới con trỏ có mở được không. */
        hover: (_event, text) => {
          host.title =
            openableUrl(text) === null
              ? tRef.current("terminal.linkBlocked")
              : tRef.current("terminal.followLink", { modifier: MODIFIER_LABEL });
        },
        leave: () => {
          host.title = "";
        },
      },
    );
    term.loadAddon(links);
    /* Cửa duy nhất để lấy được một phím ra khỏi xterm. Nó đọc `keydown` trên textarea ẩn của chính
       nó và `stopPropagation` mọi `Ctrl`+chữ cái, nên listener của app ở `window` không bao giờ
       nghe thấy `Ctrl+W`. Trả `false` là xterm thoát ra *trước* khi `preventDefault`, và sự kiện
       bay lên nguyên vẹn — cho bộ điều phối, hoặc cho chính webview khi đó là lệnh dán. */
    term.attachCustomKeyEventHandler((e) => {
      const press = pressOf(e);
      return shellKeeps(press, isClaimed(press));
    });
    term.open(host);
    fit.fit();
    termRef.current = term;
    fitRef.current = fit;
    searchRef.current = search;

    /* Id sinh ở đây chứ không do tab cấp: `StrictMode` chạy effect hai vòng trong dev, và cleanup
       của vòng đầu phải đóng đúng phiên của vòng đầu. */
    const id = crypto.randomUUID();
    sessionRef.current = id;
    let ended = false;
    /* Lệnh mở màn đã gõ hộ chưa. Đợi byte đầu tiên chứ không gửi ngay lúc `openSession` trả về:
       với SSH thì lúc ấy pty vừa được cấp và shell bên kia còn chưa in dấu nhắc, mà một dòng gõ
       vào trước khi shell đọc stdin là một dòng có thể rơi mất — hoặc tệ hơn, rơi vào giữa banner
       đăng nhập. Byte đầu tiên là lời nói đầu tiên của shell, và sau nó thì nó đang nghe. */
    let greeted = false;
    /* Effect này đã bị dọn chưa — tab đóng, hoặc `target` đổi và vòng sau đã bắt đầu. Mọi thứ
       quay lại từ `openSession` sau lúc ấy nói về một phiên không còn ai xem: ghi vào một `Terminal`
       đã `dispose` là một lỗi ném ra, và gọi `onExit`/`onFailed` lúc này là nói về vòng cũ trên
       cái tab vòng mới vừa dựng. */
    let disposed = false;

    const typed = term.onData((data) => {
      void writeSession(id, data).catch(() => {});
    });
    const selected = term.onSelectionChange(() => setHasSelection(term.hasSelection()));

    void openSession(id, target, { cols: term.cols, rows: term.rows }, (message) => {
      if (disposed) return;
      if (message instanceof ArrayBuffer) {
        term.write(new Uint8Array(message));
        if (!greeted) {
          greeted = true;
          const keys = openingKeystrokes(runOnConnectRef.current);
          // Hỏng thì im lặng, đúng như mọi lần gõ khác: phiên vẫn mở, và người dùng gõ tiếp được.
          if (keys) void writeSession(id, keys).catch(() => {});
        }
        return;
      }
      ended = true;
      setEnded(true);
      onExitRef.current(message);
    })
      .then(() => {
        /* Tab đóng giữa lúc bắt tay. `terminal_open` chỉ đưa phiên vào map *sau khi* mở xong, nên
           `closeSession` của cleanup chạy lúc map còn trống và không đóng được gì; phiên vào map
           ngay sau đó và từ đấy không ai còn biết nó tồn tại. Đóng ở đây là chỗ duy nhất còn kịp. */
        if (disposed) {
          void closeSession(id).catch(() => {});
          return;
        }
        onOpenedRef.current();
      })
      .catch((e) => {
        /* Không có phiên nào để đóng: `terminal_open` hỏng trước khi đưa được gì vào map, nên
           cleanup bên dưới không được gọi `terminal_close` cho một id chưa từng tồn tại. */
        ended = true;
        if (disposed) return;
        onErrorRef.current(errorMessage(tRef.current, e));
        onFailedRef.current();
      });

    return () => {
      disposed = true;
      typed.dispose();
      selected.dispose();
      // Chỉ khi unmount, không phải khi mất `active`: tab nằm sau vẫn phải cuộn tiếp.
      if (!ended) void closeSession(id).catch(() => {});
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
      searchRef.current = null;
      sessionRef.current = null;
    };
  }, [target]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let timer: number | undefined;
    const observer = new ResizeObserver(() => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        /* Khung ẩn có kích thước 0, và `fit()` lúc đó tính ra cols/rows rác rồi bắn xuống server. */
        if (host.clientWidth === 0 || host.clientHeight === 0) return;
        fitRef.current?.fit();
        const term = termRef.current;
        const id = sessionRef.current;
        if (term && id) void resizeSession(id, term.cols, term.rows).catch(() => {});
      }, RESIZE_DEBOUNCE);
    });
    observer.observe(host);

    return () => {
      observer.disconnect();
      window.clearTimeout(timer);
    };
  }, []);

  /* Chỉ đăng ký khi đang có vùng chọn, và đó là toàn bộ cách `Ctrl+C` biết mình là lệnh nào: không
     chọn gì thì không ai nhận chord, `shellKeeps` trả phím lại cho shell và nó là lệnh huỷ như mọi
     khi. Trên macOS thì `Cmd+C` mang chord này còn `Ctrl+C` không mang gì — không có gì để phân xử. */
  useShortcut("terminal.copy", copySelection, active && hasSelection);

  /* Cùng `Ctrl/Cmd+C`, và hai cái không bao giờ cùng sống: có vùng chọn thì phím là lệnh chép, hết
     phiên mà không chọn gì thì nó đóng màn hình đã đứng im. Nên lần bấm đầu chép và xoá vùng chọn,
     lần thứ hai đóng — cùng nhịp với phiên đang sống, nơi lần thứ hai là lệnh huỷ. */
  useShortcut("terminal.dismiss", () => onDismissRef.current(), active && ended && !hasSelection);

  /* Phóng to thu nhỏ đi qua store dùng chung nên mọi tab terminal đổi cùng lúc — và vì `enabled` là
     `active`, chỉ tab đang xem mới nhận phím; ở một tab cơ sở dữ liệu thì `Ctrl+=` không có ai
     nhận và rơi xuống webview như cũ. */
  useShortcut("terminal.zoomIn", () => zoomTerminal(1), active);
  useShortcut("terminal.zoomOut", () => zoomTerminal(-1), active);

  /* Chỉ khi tab đang xem. Ở một tab khác thì `Ctrl+F` không có ai nhận và rơi xuống webview như
     cũ, đúng như `terminal.zoomIn` đang làm. */
  useShortcut(
    "terminal.find",
    () => {
      setSearching(true);
      setFindSignal((n) => n + 1);
    },
    active,
  );

  function find(query: string, back: boolean): boolean {
    const search = searchRef.current;
    if (!search) return false;
    /* Bốn màu chứ không hai: `matchOverviewRuler` và `activeMatchColorOverviewRuler` là bắt buộc
       trong `ISearchDecorationOptions`. Chúng vẽ dải đánh dấu bên phải màn hình — chỗ cho thấy các
       kết quả nằm đâu trong cả phần đã cuộn qua — nên chúng dùng đúng cặp màu của chính kết quả. */
    const options = {
      decorations: {
        matchBackground: "#5a4b00",
        matchOverviewRuler: "#5a4b00",
        activeMatchBackground: "#a07800",
        activeMatchColorOverviewRuler: "#a07800",
      },
    };
    return back ? search.findPrevious(query, options) : search.findNext(query, options);
  }

  function closeSearch() {
    setSearching(false);
    searchRef.current?.clearDecorations();
    // Bàn phím về lại shell; đóng thanh mà con trỏ ở lại một ô đã biến mất thì gõ gì cũng mất.
    termRef.current?.focus();
  }

  function copySelection() {
    const term = termRef.current;
    if (!term) return;
    const text = term.getSelection();
    if (!text) return;
    /* Xoá vùng chọn ngay, kể cả khi chép hỏng: để nguyên thì lần `Ctrl+C` sau lại là chép, và
       không còn đường nào gửi lệnh huỷ xuống shell. */
    term.clearSelection();
    void copyText(text).catch((e) => onErrorRef.current(errorMessage(tRef.current, e)));
  }

  /* Đường duy nhất phải tự đọc clipboard. `Ctrl+V` không đi qua đây — `shellKeeps` buông phím ra
     cho webview và xterm nghe sự kiện `paste` của chính nó — nhưng một mục menu thì không có phím
     nào để buông, nên nó phải hỏi hệ điều hành. Qua Rust chứ không qua `navigator.clipboard`; lý do
     nằm ở `terminal/clipboard.ts`. */
  async function pasteFromClipboard() {
    const term = termRef.current;
    if (!term) return;
    try {
      const text = await readText();
      // `term.paste` chứ không `writeSession` thẳng: xterm mới là chỗ biết phiên có đang bật chế
      // độ bracketed paste hay không, và một khối nhiều dòng dán vào `bash` mà thiếu dấu bọc là
      // một khối lệnh tự chạy.
      if (text !== "") term.paste(text);
    } catch (e) {
      onErrorRef.current(errorMessage(tRef.current, e));
    }
  }

  function closeMenu() {
    setMenu(null);
    termRef.current?.focus();
  }

  function handleContextMenu(e: React.MouseEvent) {
    /* Ô tìm là một ô nhập văn bản thật; menu của webview trên nó là thứ đúng, đúng như
       `nativeContextMenu.ts` đã quyết cho mọi ô nhập trong app. */
    if (e.target instanceof HTMLInputElement) return;
    /* Bắt buộc, và đây là lý do: `core/nativeContextMenu.ts` cố ý tha cho ô nhập văn bản, mà
       textarea ẩn của xterm *là* một ô nhập văn bản. Không chặn ở đây thì cái hiện ra là menu của
       webview, và trong đó có Reload — một cú bấm nhầm là mọi kết nối đang mở rụng theo. */
    e.preventDefault();
    if (settingsRef.current.rightClickPastes) {
      void pasteFromClipboard();
      return;
    }
    setMenu({ x: e.clientX, y: e.clientY });
  }

  /* Font đổi là ô chữ đổi, nên số cột và số dòng đổi theo: đo lại rồi báo cho đầu kia. Thiếu bước
     ấy thì `stty size` trong shell nói một đằng còn màn hình vẽ một nẻo, và mọi thứ vẽ theo chiều
     rộng cuối dòng đều lệch.

     Con trỏ và scrollback không đổi kích thước ô nào, nhưng chúng đi cùng effect này vì chúng đi
     cùng một object `settings`: tách ra là ba effect cùng một dependency. */
  useEffect(() => {
    const term = termRef.current;
    const host = hostRef.current;
    if (!term || !host) return;
    term.options.fontFamily = settings.fontFamily;
    term.options.fontSize = settings.fontSize;
    term.options.cursorStyle = settings.cursorStyle;
    term.options.cursorBlink = settings.cursorBlink;
    term.options.scrollback = settings.scrollback;
    // Khung đang ẩn thì để yên: `fit()` lúc ấy tính ra cols/rows rác. Tab quay lại sẽ đo lại —
    // xem effect `[active]` bên dưới.
    if (host.clientWidth === 0) return;
    fitRef.current?.fit();
    const id = sessionRef.current;
    if (id) void resizeSession(id, term.cols, term.rows).catch(() => {});
  }, [settings]);

  // Tab quay lại: cửa sổ có thể đã đổi kích thước trong lúc khung này ẩn, và `ResizeObserver`
  // không bắn cho một khung đang `display: none`.
  useEffect(() => {
    if (!active) return;
    const host = hostRef.current;
    const term = termRef.current;
    if (!host || !term || host.clientWidth === 0) return;
    fitRef.current?.fit();
    term.focus();
    const id = sessionRef.current;
    if (id) void resizeSession(id, term.cols, term.rows).catch(() => {});
  }, [active]);

  return (
    <div className={styles.frame} onContextMenu={handleContextMenu}>
      {searching && <SearchBar onFind={find} onClose={closeSearch} focusSignal={findSignal} />}
      <div
        ref={hostRef}
        className={styles.host}
        role="application"
        aria-label={t("terminal.screen")}
      />
      {menu && (
        <ContextMenu x={menu.x} y={menu.y} onClose={closeMenu}>
          <button
            type="button"
            disabled={!hasSelection}
            onClick={() => {
              closeMenu();
              copySelection();
            }}
          >
            {t("terminal.menuCopy")}
          </button>
          <button
            type="button"
            disabled={ended}
            onClick={() => {
              closeMenu();
              void pasteFromClipboard();
            }}
          >
            {t("terminal.menuPaste")}
          </button>
          <button
            type="button"
            onClick={() => {
              closeMenu();
              termRef.current?.selectAll();
            }}
          >
            {t("terminal.menuSelectAll")}
          </button>
          <button
            type="button"
            onClick={() => {
              closeMenu();
              termRef.current?.clear();
            }}
          >
            {t("terminal.menuClear")}
          </button>
        </ContextMenu>
      )}
    </div>
  );
}

export default TerminalView;
