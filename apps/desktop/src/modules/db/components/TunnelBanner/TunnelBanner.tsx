import { useEffect, useState } from "react";
import type { UnlistenFn } from "@tauri-apps/api/event";
import Button from "../../../../components/Button";
import { errorMessage } from "../../../../core/errors";
import { useTranslation } from "../../../../i18n";
import { onTunnelState, tunnelReconnect } from "../../tunnel";
import { HIDDEN, nextBannerState, popupShows, type BannerState } from "./state";
import styles from "./TunnelBanner.module.css";

/** "Đã kết nối lại" ở lại bao lâu trước khi tự biến mất. */
const REASSURED_MS = 3000;

/**
 * Đứt bao lâu thì mới đáng chặn màn hình.
 *
 * Dưới ngưỡng này không ai biết là có chuyện gì xảy ra: tunnel mở lại xong, câu lệnh được chạy lại,
 * dữ liệu về — và một popup chớp lên rồi tắt chỉ là cái giật mình thừa.
 */
const BLOCK_AFTER_MS = 800;

interface Props {
  connectionId: string;
  /** Ngắt hẳn connection này — một trong hai lối ra khi tunnel không mở lại được. */
  onDisconnect: () => void;
}

/**
 * Chặn workspace của tab này lại khi SSH tunnel của nó đứt, cho tới khi mở lại được hoặc người dùng
 * quyết định làm gì khác.
 *
 * Chặn chứ không phải báo, vì lúc đó không còn gì làm được thật: mọi lệnh đều trả về "mất kết nối", và
 * đó cũng là câu ErrorBanner đang nuốt để nhường chỗ cho đây — xem `useWorkspaceError`.
 *
 * Phủ đúng workspace chứ không portal ra `document.body`: tab nền trong MixDB vẫn mounted và chỉ bị
 * `display: none`, nên một popup cố định theo viewport sẽ che cả tab đang xem vì tunnel của tab khác rớt.
 *
 * Trả `null` khi không có gì để nói — kể cả với connection không đi qua tunnel, vì với chúng không
 * có sự kiện nào tới cả.
 */
function TunnelBanner({ connectionId, onDisconnect }: Props) {
  const { t } = useTranslation();
  const [state, setState] = useState<BannerState>(HIDDEN);
  const [retrying, setRetrying] = useState(false);
  /**
   * Trạng thái người dùng đã bấm "để sau", so bằng danh tính chứ không bằng giá trị.
   *
   * `nextBannerState` trả lại đúng object cũ khi tin mới không nói gì khác, nên nhịp backoff của
   * watcher — cùng một lỗi, mỗi phút một lần — không dựng lại cái popup vừa bị gạt đi, còn một chuyện
   * thật sự khác thì có.
   */
  const [dismissed, setDismissed] = useState<BannerState | null>(null);
  /** Đã đứt quá {@link BLOCK_AFTER_MS}. */
  const [ripe, setRipe] = useState(false);
  /** Popup đang đứng đó từ lần render trước — xem {@link popupShows}. */
  const [showing, setShowing] = useState(false);

  useEffect(() => {
    let unlisten: UnlistenFn | undefined;
    let stopped = false;
    void onTunnelState(connectionId, (event) =>
      setState((current) => nextBannerState(current, event))
    ).then((fn) => {
      // Tab có thể đã đóng trước khi `listen` kịp trả về: gỡ ngay thay vì để lại một người nghe
      // không ai gỡ.
      if (stopped) fn();
      else unlisten = fn;
    });
    return () => {
      stopped = true;
      unlisten?.();
      setState(HIDDEN);
      setDismissed(null);
    };
  }, [connectionId]);

  useEffect(() => {
    if (state.kind !== "reconnecting") {
      setRipe(true);
      return;
    }
    setRipe(false);
    const timer = setTimeout(() => setRipe(true), BLOCK_AFTER_MS);
    return () => clearTimeout(timer);
  }, [state]);

  useEffect(() => {
    if (state.kind !== "reconnected") return;
    const timer = setTimeout(() => setState(HIDDEN), REASSURED_MS);
    return () => clearTimeout(timer);
  }, [state]);

  const visible = state !== dismissed && popupShows(state, ripe, showing);

  useEffect(() => setShowing(visible), [visible]);

  useEffect(() => {
    if (!visible) return;
    function onKeyDown(e: KeyboardEvent) {
      // Esc làm đúng việc của nút "để sau", không hơn: không ngắt, không thử lại.
      if (e.key === "Escape") setDismissed(state);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [visible, state]);

  if (!visible || state.kind === "hidden") return null;

  const retry = async () => {
    setRetrying(true);
    try {
      await tunnelReconnect(connectionId);
    } catch {
      // Không cần bắt gì: dù mở lại được hay không, tunnel tự phát tin và popup đổi theo tin đó.
    } finally {
      setRetrying(false);
    }
  };

  const message =
    state.kind === "reconnecting"
      ? t("tunnel.reconnecting")
      : state.kind === "reconnected"
        ? t("tunnel.reconnected")
        : t("tunnel.failed", { message: errorMessage(t, state.error) });

  return (
    <div className={styles.overlay}>
      <div
        className={`${styles.dialog} ${styles[state.kind]}`}
        role="alertdialog"
        aria-modal="true"
        aria-label={message}
      >
        <p className={styles.text}>
          {state.kind === "reconnecting" && <span className={styles.spinner} aria-hidden="true" />}
          {message}
        </p>
        {/* "Đã kết nối lại" không hỏi gì cả: nó tự biến mất và mọi thứ dùng được tiếp. */}
        {state.kind !== "reconnected" && (
          <div className={styles.actions}>
            <Button size="large" onClick={onDisconnect}>
              {t("common.disconnect")}
            </Button>
            <Button size="large" onClick={() => setDismissed(state)}>
              {t("tunnel.later")}
            </Button>
            {state.kind === "failed" && (
              <Button size="large" variant="primary" onClick={retry} disabled={retrying} autoFocus>
                {t("tunnel.retry")}
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default TunnelBanner;
