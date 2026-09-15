import type { MetricsMinute } from "@mixengine/api";

const MINUTE_MS = 60_000;

/**
 * Chia `minutes` (đã sắp theo thời gian tăng dần) thành các đoạn liền kề.
 *
 * **Một phút vắng là ranh giới đoạn, không phải một điểm nối liền qua nó** — `MetricsHistory.minutes`
 * doc-comment: một phút không có dòng là một phút không ai đo (service dừng, máy ngủ, daemon đang
 * thay), không bao giờ là một phút dùng 0. Vẽ một đường nối hai đoạn là bịa ra dữ liệu chưa từng lấy.
 */
export function segmentsFor(minutes: readonly MetricsMinute[]): MetricsMinute[][] {
  const segments: MetricsMinute[][] = [];
  for (const minute of minutes) {
    const current = segments[segments.length - 1];
    const previous = current?.[current.length - 1];
    if (previous !== undefined && minute.minute - previous.minute === MINUTE_MS) {
      current.push(minute);
    } else {
      segments.push([minute]);
    }
  }
  return segments;
}

/**
 * Chia một đoạn thành các dải mà `defined` đúng suốt dọc.
 *
 * **Cùng một luật như [`segmentsFor`], một tầng sâu hơn.** Một phút có dòng vẫn có thể không mang
 * được con số CPU (`cpu_avg: null`, `MetricsMinute` doc-comment) — không lần đọc nào trong phút đó
 * lấy được. Lọc phút ấy ra rồi nối hai bên lại vẽ ra một đoạn chưa ai đo, đúng cái sai mà
 * [`segmentsFor`] đã tránh ở mức phút vắng.
 */
export function runsOf(
  segment: readonly MetricsMinute[],
  defined: (minute: MetricsMinute) => boolean,
): MetricsMinute[][] {
  const runs: MetricsMinute[][] = [];
  let current: MetricsMinute[] | null = null;
  for (const minute of segment) {
    if (!defined(minute)) {
      current = null;
      continue;
    }
    if (current === null) {
      current = [minute];
      runs.push(current);
    } else {
      current.push(minute);
    }
  }
  return runs;
}

/** Một khoảng thời gian nửa mở `[from, to)`. */
export interface TimeRange {
  from: number;
  to: number;
}

/**
 * Các khoảng trong `[from, to)` mà không đoạn nào phủ — thời gian không ai đo.
 *
 * Luật "một phút vắng là một khoảng trống" mới chỉ nói biểu đồ đừng *nối* qua đó. Cái này nói phần
 * còn lại: một khoảng trống phải **nhìn thấy được**, nếu không nó không phân biệt được với một
 * đường đi ngang. Cửa sổ chạy hết thời gian lưu trữ, nên một home mới bật cũng thấy ngay phần lớn
 * biểu đồ là thời gian chưa có dữ liệu chứ không tưởng 40 phút của mình là 24 giờ.
 *
 * Một phút `n` phủ `[n, n + 60s)` — nó là một phút, không phải một điểm.
 */
export function gapsIn(
  segments: readonly (readonly MetricsMinute[])[],
  from: number,
  to: number,
): TimeRange[] {
  const gaps: TimeRange[] = [];
  let cursor = from;
  for (const segment of segments) {
    const first = segment[0];
    const last = segment[segment.length - 1];
    if (first === undefined || last === undefined) continue;
    if (first.minute > cursor) gaps.push({ from: cursor, to: Math.min(first.minute, to) });
    cursor = Math.max(cursor, last.minute + MINUTE_MS);
  }
  if (cursor < to) gaps.push({ from: cursor, to });
  return gaps.filter((gap) => gap.to > gap.from);
}

/**
 * Các khoảng mà mỗi phút có ít nhất `minimum` lần đọc — quãng thời gian thật sự có người nhìn.
 *
 * **Một phút một lần đọc và một phút sáu mươi lần đọc không phải hai độ tin cậy như nhau**
 * (`MetricsMinute::samples` doc-comment, và spec Metrics mục 2 nói thẳng là không được vẽ chúng như
 * nhau). Chỗ này là cách nói ra điều đó mà không đụng vào chính đường dữ liệu: `samples: 1` là
 * trạng thái *thường* của một máy không ai mở Dashboard, nên vẽ nó nhạt đi là vẽ gần cả biểu đồ
 * nhạt đi — mất đúng thứ đang cần đọc.
 *
 * Cái nó nói rõ là **dải đỉnh**: ở `samples: 1` thì `cpu_peak` bằng `cpu_avg` vì chỉ có một lần đọc
 * để so, nên dải tự dẹt xuống thành không. Dẹt vì không ai đo trông y hệt dẹt vì mức dùng thật sự
 * đều, và không có gì trong hình phân biệt được hai cái đó.
 */
export function sampledRanges(
  segments: readonly (readonly MetricsMinute[])[],
  minimum: number,
): TimeRange[] {
  const ranges: TimeRange[] = [];
  for (const segment of segments) {
    let current: TimeRange | null = null;
    for (const minute of segment) {
      if (minute.samples < minimum) {
        current = null;
        continue;
      }
      if (current === null) {
        current = { from: minute.minute, to: minute.minute + MINUTE_MS };
        ranges.push(current);
      } else {
        current.to = minute.minute + MINUTE_MS;
      }
    }
  }
  return ranges;
}

/**
 * Phút gần `time` nhất, hoặc `null` nếu phút gần nhất vẫn xa hơn `tolerance`.
 *
 * `tolerance` là điều kiện làm cho crosshair trung thực: trong vùng chưa có dữ liệu, phút gần nhất
 * có thể cách hàng giờ, và đọc số của nó ra dưới con trỏ là gán một giá trị cho một thời điểm chưa
 * ai đo.
 */
export function nearestMinute(
  minutes: readonly MetricsMinute[],
  time: number,
  tolerance: number,
): MetricsMinute | null {
  let best: MetricsMinute | null = null;
  let bestDistance = Infinity;
  for (const minute of minutes) {
    const distance = Math.abs(minute.minute - time);
    if (distance < bestDistance) {
      best = minute;
      bestDistance = distance;
    }
  }
  return bestDistance <= tolerance ? best : null;
}
