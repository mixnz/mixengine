import { useCallback, useState } from "react";
import { useTranslation } from "../../i18n";

/**
 * Câu này có được phép rơi xuống ErrorBanner không.
 *
 * `lostMessage` là câu "mất kết nối" trong ngôn ngữ đang bật, hoặc `null` với connection không đi qua
 * tunnel — ở đó không có gì bị nuốt cả.
 */
export function reachesErrorBanner(message: string, lostMessage: string | null): boolean {
  return message !== lostMessage;
}

/**
 * Dòng lỗi của ErrorBanner trong một workspace, thay cho `useState("")`.
 *
 * Bọc `useState` chỉ vì một lẽ: khi connection đi qua SSH tunnel thì "mất kết nối" không được phép
 * rơi xuống đây. TunnelBanner đang kể đúng chuyện đó và kể tốt hơn — nó nói tunnel đang được mở lại, tự
 * biến mất khi mở được, và có nút thử lại khi không. ErrorBanner thì chỉ để lại một câu chết cứng người
 * dùng phải tự tay tắt, nằm ngay dưới câu báo mọi thứ đã lành.
 *
 * Connection nối thẳng không nuốt gì: ở đó không có TunnelBanner nào để thay lời, và nuốt đi thì chỉ còn
 * lại một thao tác im lặng không xảy ra gì cả.
 *
 * Trả về đúng hình dạng của `useState`, nên `setError("")` để tắt banner vẫn chạy như cũ: chỉ đúng một
 * câu bị nuốt, chuỗi rỗng không phải câu đó.
 */
export function useWorkspaceError(tunnelled: boolean): [string, (message: string) => void] {
  const { t } = useTranslation();
  const [error, setError] = useState("");
  const lostMessage = tunnelled ? t("error.connectionLost") : null;
  const report = useCallback(
    (message: string) => {
      if (reachesErrorBanner(message, lostMessage)) setError(message);
    },
    [lostMessage]
  );
  return [error, report];
}
