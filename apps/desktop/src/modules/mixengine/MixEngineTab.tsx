import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";

import ErrorBanner from "../../components/ErrorBanner";
import { errorMessage } from "../../core/errors";
import { useTranslation, type Language } from "../../i18n";
import type { ModuleTabProps } from "../../shell/module";
import * as api from "./api";
import Sidebar from "./components/Sidebar";
import Blueprints from "./screens/Blueprints";
import Dashboard from "./screens/Dashboard";
import Domains from "./screens/Domains";
import Extensions from "./screens/Extensions";
import Logs from "./screens/Logs";
import Metrics from "./screens/Metrics";
import Projects from "./screens/Projects";
import Runtimes from "./screens/Runtimes";
import ServicesDetail from "./screens/ServicesDetail";
import Settings from "./screens/Settings";
import Sites from "./screens/Sites";
import { requestSitesFilter } from "./sitesNavigation";
import { parseMixEngineTabState, type MixEngineScreen } from "./tabState";
import "./mixengine.css";

/** Trang cài đặt của MixEngine, cho một máy chưa có nó. */
const INSTALL_PAGE_EN = "https://mixnz.github.io/mixengine/en/install/";
/** Only languages with a translated install page go here; everything else falls back to English. */
const INSTALL_PAGE_BY_LANG: Partial<Record<Language, string>> = {
  vi: "https://mixnz.github.io/mixengine/vi/install/",
};

/**
 * Cổng vào module, rồi màn hình.
 *
 * **Ba trạng thái, không phải hai.** *Không chạy* (không dial được nhưng chương trình có trên máy),
 * *không trả lời* (dial được, `/health` không xong), *không có MixEngine*. Gộp cả ba thành một
 * thông báo lỗi là bắt người dùng đoán xem họ phải cài, phải khởi động, hay phải chờ.
 *
 * **Không tự khởi động daemon khi mở tab.** Mở một tab là một cử chỉ rẻ và người dùng có thể chỉ
 * đang tìm nhầm tab; khởi động một daemon đang giám sát database thì không rẻ như vậy. Nút nói rõ
 * nó sắp làm gì.
 */
export default function MixEngineTab({ onTitleChange, onStateChange, restored }: ModuleTabProps) {
  // Đọc một lần, lúc mount — đọc reactively là module tự ghi đè chính nó ngay khi nó ghi.
  const [screen, setScreen] = useState<MixEngineScreen>(
    () => parseMixEngineTabState(restored)?.screen ?? "dashboard",
  );
  const [presence, setPresence] = useState<api.Presence | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const { t, lang } = useTranslation();

  /* Mỗi màn hình sidebar tự quản lý watch/reload riêng của nó (qua `subscribeDaemonWatch`) và có
     thể đang giữa một việc dài hơi (một job cài đặt ở Runtimes) khi người dùng đổi sang màn khác —
     đổi màn không được unmount nó, nếu không state cục bộ đang theo dõi việc đó mất sạch. Nên
     render mỗi màn đã từng xem qua đúng một lần, chỉ ẩn/hiện bằng `hidden`; màn chưa xem qua thì
     chưa vào DOM (mở tất cả chín màn ngay từ đầu là chín lượt gọi API cho những màn có thể không
     bao giờ được xem).
     Khai báo trước mọi `return` sớm bên dưới (cổng "chưa hỏi xong"/"daemon không chạy") — Hook
     phải chạy đều ở mọi lần render, không được đứng sau một nhánh return. */
  const [mountedScreens, setMountedScreens] = useState<MixEngineScreen[]>([screen]);
  useEffect(() => {
    setMountedScreens((prev) => (prev.includes(screen) ? prev : [...prev, screen]));
  }, [screen]);

  const look = useCallback(async () => {
    setPresence(await api.presence());
  }, []);

  useEffect(() => {
    let live = true;
    void api.presence().then((answer) => {
      if (live) setPresence(answer);
    });
    return () => {
      live = false;
    };
  }, []);

  /* `update.apply` và `daemon.uninstall` (`keep_home: false`) đều tự kết thúc chính daemon đang phục
     vụ request đó — không có gì ở tầng này khởi động lại nó giùm người dùng (đúng luật "không tự
     khởi động daemon" ở đầu file). Settings gọi `pollUntilDaemonLeaves` ngay khi một trong hai xong
     (`onUpdateApplied`/`onUninstalled`, cùng một hàm) để nghe đúng lúc `presence` rời khỏi
     `"running"`, rồi để gate phía trên tự vẽ màn đúng — "Start" nếu chương trình vẫn còn trên đĩa mà
     chỉ tiến trình dừng, "Get it" nếu đã gỡ sạch (`notInstalled`), hoặc màn hình bình thường nếu
     daemon đã tự lên lại trước khi ai kịp thấy gate đó. */
  const pollTimer = useRef<number | null>(null);
  const pollUntilDaemonLeaves = useCallback(() => {
    if (pollTimer.current !== null) return;
    pollTimer.current = window.setInterval(() => {
      void api.presence().then((answer) => {
        setPresence(answer);
        if (answer !== "running" && pollTimer.current !== null) {
          window.clearInterval(pollTimer.current);
          pollTimer.current = null;
        }
      });
    }, 1000);
  }, []);
  useEffect(
    () => () => {
      if (pollTimer.current !== null) window.clearInterval(pollTimer.current);
    },
    [],
  );

  useEffect(() => {
    onTitleChange(t("mixengine.newTabTitle"));
  }, [onTitleChange, t]);

  /* Khởi động một daemon hỏng được vì nhiều lý do người dùng sửa được — chương trình không ở chỗ
     đoán, một daemon khác đang giữ lock. Nuốt cái đó đi là để họ bấm một cái nút không làm gì. */
  async function run(work: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await work();
      await look();
    } catch (e) {
      setError(errorMessage(t, e));
    } finally {
      setBusy(false);
    }
  }

  // Chưa hỏi xong: một khung trống, không phải một thông báo. Câu trả lời tới trong vài mili giây
  // và một dòng "đang kiểm tra" nhấp nháy thì tệ hơn là không có gì.
  if (presence === null) return <div className="mixengine-root" />;

  if (presence !== "running") {
    return (
      <div className="mixengine-root mixengine-gate">
        {error !== "" && <ErrorBanner message={error} onDismiss={() => setError("")} />}
        <p>{t(`mixengine.gate.${presence}`)}</p>
        {presence === "notRunning" && (
          <button onClick={() => void run(api.startDaemon)} disabled={busy}>
            {busy ? t("mixengine.gate.starting") : t("mixengine.gate.start")}
          </button>
        )}
        {presence === "notAnswering" && (
          <button onClick={() => void run(() => Promise.resolve())} disabled={busy}>
            {t("mixengine.gate.retry")}
          </button>
        )}
        {presence === "notInstalled" && (
          <button onClick={() => void openUrl(INSTALL_PAGE_BY_LANG[lang] ?? INSTALL_PAGE_EN)}>
            {t("mixengine.gate.getIt")}
          </button>
        )}
      </div>
    );
  }

  function selectScreen(next: MixEngineScreen) {
    setScreen(next);
    onStateChange({ screen: next });
  }

  /* `render` nhận `active` thay vì nhận thẳng một node dựng sẵn — mỗi màn tự quyết định làm gì với
     nó (đọc lại danh sách khi vừa quay lại, xem `Dashboard.tsx`/`ServicesDetail.tsx`...). Giữ mount
     không kéo theo tự đọc lại: một sự kiện live-update không phải lúc nào cũng phủ hết những gì đổi
     ở màn khác trong lúc màn này bị ẩn (gỡ/cài PHP không sinh `service_state_changed`, nhưng vẫn có
     thể là lý do người dùng quay lại Dashboard/Services để nhìn), nên mỗi màn tự đọc lại lúc `active`
     chuyển sang `true` — đúng câu spec đã viết: "tự đọc lại khi focus quay lại tab". */
  function pane(key: MixEngineScreen, render: (active: boolean) => ReactNode) {
    if (!mountedScreens.includes(key)) return null;
    const active = screen === key;
    return (
      <div key={key} className="mixengine-screen-pane" hidden={!active}>
        {render(active)}
      </div>
    );
  }

  return (
    <div className="mixengine-root mixengine-layout">
      <Sidebar screen={screen} onSelect={selectScreen} />
      <div className="mixengine-screen">
        {pane("dashboard", (active) => <Dashboard active={active} />)}
        {pane("projects", (active) => (
          <Projects
            active={active}
            onOpenSites={(project) => {
              requestSitesFilter(project);
              selectScreen("sites");
            }}
          />
        ))}
        {pane("sites", (active) => <Sites active={active} />)}
        {pane("domains", (active) => <Domains active={active} />)}
        {pane("runtimes", (active) => <Runtimes active={active} />)}
        {pane("servicesDetail", (active) => <ServicesDetail active={active} />)}
        {pane("logs", (active) => <Logs active={active} />)}
        {pane("blueprints", (active) => <Blueprints active={active} />)}
        {pane("extensions", (active) => <Extensions active={active} />)}
        {pane("metrics", (active) => <Metrics active={active} />)}
        {pane("settings", (active) => (
          <Settings
            active={active}
            onUpdateApplied={pollUntilDaemonLeaves}
            onUninstalled={pollUntilDaemonLeaves}
          />
        ))}
      </div>
    </div>
  );
}
