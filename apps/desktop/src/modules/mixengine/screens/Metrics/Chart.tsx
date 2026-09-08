import type { MetricsMinute } from "../../api/types/MetricsMinute";
import styles from "./Chart.module.css";

const WIDTH = 640;
const HEIGHT = 120;

interface Props {
  segments: MetricsMinute[][];
  /** Đọc giá trị trung bình/đỉnh từ một phút — chọn cặp `cpu_avg`/`cpu_peak` hay `rss_avg`/`rss_peak`. */
  avg: (minute: MetricsMinute) => number | null;
  peak: (minute: MetricsMinute) => number | null;
}

/**
 * Một đường trung bình + một dải đỉnh, dựng tay bằng SVG — không thêm thư viện chart (Quyết định D4,
 * spec Metrics/Settings): `package.json` không có thư viện nào, và một đường đơn giản không đáng một
 * dependency mới.
 *
 * **Mỗi đoạn (`segments`) là một `<path>` riêng.** Đây là cơ chế thật giữ đúng luật "một phút vắng
 * là một khoảng trống, không phải một điểm nối" — trục X ánh xạ theo *thời gian*, không theo chỉ số
 * mảng, nên một khoảng trống thời gian tự để lại một khoảng trống hình học, và việc không vẽ một
 * `<path>` xuyên qua nó là điều duy nhất còn phải giữ đúng.
 */
export default function Chart({ segments, avg, peak }: Props) {
  const all = segments.flat();
  if (all.length === 0) return null;

  const minTime = Math.min(...all.map((m) => m.minute));
  const maxTime = Math.max(...all.map((m) => m.minute));
  const span = maxTime - minTime || 1;

  const maxValue = Math.max(1, ...all.map((m) => peak(m) ?? avg(m) ?? 0));

  const x = (time: number) => ((time - minTime) / span) * WIDTH;
  const y = (value: number) => HEIGHT - (value / maxValue) * HEIGHT;

  function pathFor(segment: MetricsMinute[], value: (minute: MetricsMinute) => number | null) {
    const points = segment
      .map((minute) => {
        const v = value(minute);
        return v === null ? null : `${x(minute.minute)},${y(v)}`;
      })
      .filter((point): point is string => point !== null);
    return points.length < 2 ? null : `M${points.join("L")}`;
  }

  return (
    <svg
      className={styles.chart}
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      preserveAspectRatio="none"
      role="img"
    >
      {segments.map((segment) => {
        const peakPath = pathFor(segment, peak);
        const avgPath = pathFor(segment, avg);
        return (
          <g key={segment[0]!.minute}>
            {peakPath && <path d={peakPath} className={styles.peak} fill="none" strokeWidth={4} />}
            {avgPath && <path d={avgPath} className={styles.avg} fill="none" strokeWidth={1.5} />}
          </g>
        );
      })}
    </svg>
  );
}
