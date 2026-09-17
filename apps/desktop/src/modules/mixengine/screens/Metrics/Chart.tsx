import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";

import type { MetricsMinute } from "@mixengine/api";
import Tooltip from "../../../../components/Tooltip";
import { useTranslation } from "../../../../i18n";
import { gapsIn, nearestMinute, runsOf, sampledRanges } from "../../metricsHistoryState";
import { timeTicks, type Unit } from "./chartScale";
import styles from "./Chart.module.css";

const MINUTE_MS = 60_000;

/** Chiều cao vùng vẽ, không kể lề. */
const PLOT_HEIGHT = 128;
/** Chừa chỗ cho nét vẽ ở đúng đỉnh thang: không có nó, nửa trên của đường bị cắt ở mép SVG. */
const PAD_TOP = 10;
/** Chỗ cho dải lấy mẫu rồi tới nhãn thời gian. */
const PAD_BOTTOM = 28;
/** Dải lấy mẫu: nằm dưới vạch 0, không đè lên dữ liệu sát đáy. */
const RAIL_TOP = 4;
const RAIL_HEIGHT = 3;
/** Từ bao nhiêu lần đọc một phút trở lên thì `peak` mới nói được điều gì khác `avg`. */
const SAMPLED_MINIMUM = 2;
/** Chỗ cho nhãn trục dọc. */
const PAD_LEFT = 58;
const PAD_RIGHT = 10;
const HEIGHT = PAD_TOP + PLOT_HEIGHT + PAD_BOTTOM;
/** Dưới mức này thì nhãn trục chồng lên nhau; biểu đồ thà co lại còn hơn tự dẫm lên mình. */
const MIN_WIDTH = 360;
/** Bao nhiêu pixel cho một nhãn thời gian trước khi hai nhãn chạm nhau. */
const TICK_SPACING = 110;
/** Con trỏ phải nằm trong chừng này mới tính là đang chỉ vào một phút. */
const SNAP_PX = 8;
/** Một vùng trống hẹp hơn thế này không đủ chỗ cho chữ. */
const GAP_LABEL_PX = 90;

interface Props {
  segments: MetricsMinute[][];
  /** Cửa sổ trục ngang phủ — cả thời gian lưu trữ, không chỉ phần đã có dữ liệu. */
  from: number;
  to: number;
  /** Đại lượng đang vẽ: nó dựng thang dọc và viết nhãn cho chính mình. */
  unit: Unit;
  /** Tên đại lượng, đã dịch — cho người đọc màn hình chứ không phải người nhìn nó. */
  label: string;
  /** Đọc giá trị trung bình/đỉnh từ một phút — cặp `cpu_avg`/`cpu_peak` hay `rss_avg`/`rss_peak`. */
  avg: (minute: MetricsMinute) => number | null;
  peak: (minute: MetricsMinute) => number | null;
  /** The categorical hue the series is drawn in — one per quantity, so two charts are told apart. */
  hue: "sky" | "purple";
}

/** Phút dưới con trỏ, cùng vị trí của nó tính bằng pixel CSS trong khung. */
interface Hover {
  minute: MetricsMinute;
  left: number;
}

/**
 * Một dải đỉnh và một đường trung bình trên trục thời gian thật, dựng tay bằng SVG — không thêm thư
 * viện chart (Quyết định D4, spec Metrics/Settings).
 *
 * **Mỗi dải liên tục là một `<path>` riêng.** Đây là cơ chế thật giữ đúng luật "một phút vắng là
 * một khoảng trống, không phải một điểm nối": trục X ánh xạ theo *thời gian*, không theo chỉ số
 * mảng, nên một khoảng trống thời gian tự để lại một khoảng trống hình học — và không vẽ một
 * `<path>` xuyên qua nó là điều duy nhất còn phải giữ đúng. `runsOf` áp cùng luật ấy một tầng sâu
 * hơn, cho phút có dòng nhưng không có số.
 *
 * **Khung vẽ đo theo pixel thật.** `viewBox` khớp bề rộng đã đo nên một đơn vị SVG là một pixel:
 * nét vẽ dày đều theo mọi hướng, và chữ ra đúng cỡ. Bản trước kéo một `viewBox` cố định 640×120 ra
 * cả bề rộng pane bằng `preserveAspectRatio="none"`, làm đoạn ngang mảnh hơn đoạn dốc và biến nét
 * đỉnh dày 4px thành một dải thô.
 */
export default function Chart({ segments, from, to, unit, label, avg, peak, hue }: Props) {
  const { lang, t } = useTranslation();
  const box = useRef<HTMLDivElement>(null);
  const plot = useRef<SVGSVGElement>(null);
  const [measured, setMeasured] = useState(0);
  const [hover, setHover] = useState<Hover | null>(null);

  useEffect(() => {
    const el = box.current;
    if (el === null) return;
    const measure = () => setMeasured(el.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const clock = useMemo(
    () => new Intl.DateTimeFormat(lang, { hour: "2-digit", minute: "2-digit" }),
    [lang],
  );
  // Bản tóm tắt phải nói cả ngày: một trình đọc màn hình không thấy được cửa sổ dài bao nhiêu.
  const stamp = useMemo(
    () => new Intl.DateTimeFormat(lang, { dateStyle: "short", timeStyle: "short" }),
    [lang],
  );

  const width = Math.max(measured, MIN_WIDTH);
  const plotWidth = width - PAD_LEFT - PAD_RIGHT;
  const span = Math.max(1, to - from);

  const all = segments.flat();
  const observed = Math.max(0, ...all.map((m) => peak(m) ?? avg(m) ?? 0));
  const max = unit.niceMax(observed);

  const x = (time: number) => PAD_LEFT + ((time - from) / span) * plotWidth;
  const y = (value: number) => PAD_TOP + PLOT_HEIGHT - (value / max) * PLOT_HEIGHT;

  const defined = (minute: MetricsMinute) => avg(minute) !== null && peak(minute) !== null;
  const runs = segments.flatMap((segment) => runsOf(segment, defined));
  const gaps = gapsIn(segments, from, to);
  const sampled = sampledRanges(segments, SAMPLED_MINIMUM);
  const ticks = timeTicks(from, to, Math.max(2, Math.floor(plotWidth / TICK_SPACING) + 1));

  function move(event: PointerEvent<HTMLDivElement>) {
    const svg = plot.current;
    if (svg === null || all.length === 0) return;
    const rect = svg.getBoundingClientRect();
    if (rect.width === 0) return;
    const scale = width / rect.width;
    const time = from + (((event.clientX - rect.left) * scale - PAD_LEFT) / plotWidth) * span;
    const tolerance = Math.max(MINUTE_MS, (span / plotWidth) * SNAP_PX);
    const found = nearestMinute(all, time, tolerance);
    setHover(found === null ? null : { minute: found, left: (x(found.minute) / width) * rect.width });
  }

  const hovered = hover?.minute;
  const hoveredAvg = hovered === undefined ? null : avg(hovered);
  const hoveredPeak = hovered === undefined ? null : peak(hovered);

  return (
    <div className={`${styles.frame} ${styles[hue]}`}>
      <div className={styles.legend}>
        <span className={styles.key}>
          <span className={styles.keyBand} />
          {t("mixengine.metrics.peak")}
        </span>
        <span className={styles.key}>
          <span className={styles.keyLine} />
          {t("mixengine.metrics.average")}
        </span>
        {/* Chú giải này cần một câu giải thích, không chỉ một cái tên: dải nói lên *vì sao* dải
            đỉnh ở chỗ khác lại dẹt. `Tooltip` của app thay vì `title` để chữ ra đúng phông app. */}
        <Tooltip text={t("mixengine.metrics.sampledHint")}>
          <span className={styles.key}>
            <span className={styles.keyRail} />
            {t("mixengine.metrics.sampled")}
          </span>
        </Tooltip>
      </div>

      <div
        className={styles.box}
        ref={box}
        onPointerMove={move}
        onPointerLeave={() => setHover(null)}
      >
        <svg
          className={styles.chart}
          ref={plot}
          viewBox={`0 0 ${width} ${HEIGHT}`}
          height={HEIGHT}
          role="img"
          aria-label={t("mixengine.metrics.summary", {
            label,
            from: stamp.format(from),
            to: stamp.format(to),
            count: all.length,
            peak: unit.value(observed),
          })}
        >
          {/* Thời gian không ai đo, vẽ ra thành một vùng — nếu không, nó không phân biệt được với
              một đường đi ngang, và 40 phút dữ liệu trông y hệt 24 giờ. */}
          {gaps.map((gap) => (
            <rect
              key={gap.from}
              className={styles.gap}
              x={x(gap.from)}
              y={PAD_TOP}
              width={Math.max(0, x(gap.to) - x(gap.from))}
              height={PLOT_HEIGHT}
            />
          ))}
          {gaps
            .filter((gap) => x(gap.to) - x(gap.from) >= GAP_LABEL_PX)
            .map((gap) => (
              <text
                key={gap.from}
                className={styles.gapLabel}
                x={(x(gap.from) + x(gap.to)) / 2}
                y={PAD_TOP + PLOT_HEIGHT / 2}
                textAnchor="middle"
                dominantBaseline="middle"
              >
                {t("mixengine.metrics.noData")}
              </text>
            ))}

          {[0, max / 2, max].map((value) => (
            <g key={value}>
              <line
                className={styles.grid}
                x1={PAD_LEFT}
                x2={PAD_LEFT + plotWidth}
                y1={y(value)}
                y2={y(value)}
              />
              <text
                className={styles.tick}
                x={PAD_LEFT - 8}
                y={y(value)}
                textAnchor="end"
                dominantBaseline="middle"
              >
                {unit.tick(value)}
              </text>
            </g>
          ))}

          {/* Quãng có người nhìn, nói bên dưới trục thay vì trên chính đường dữ liệu. `samples: 1`
              là trạng thái thường của một máy không ai mở Dashboard, nên vẽ nhạt những phút ấy đi
              là vẽ nhạt gần cả biểu đồ — mất đúng thứ đang cần đọc. */}
          {sampled.map((range) => (
            <rect
              key={range.from}
              className={styles.rail}
              x={x(range.from)}
              y={PAD_TOP + PLOT_HEIGHT + RAIL_TOP}
              width={Math.max(1, x(range.to) - x(range.from))}
              height={RAIL_HEIGHT}
            />
          ))}

          {ticks.map((tick) => (
            <text
              key={tick}
              className={styles.tick}
              x={x(tick)}
              y={PAD_TOP + PLOT_HEIGHT + 20}
              textAnchor="middle"
            >
              {clock.format(tick)}
            </text>
          ))}

          {runs.map((run) => {
            const first = run[0]!;
            // Một phút đơn độc không có đường để vẽ, nhưng nó là dữ liệu thật: một vạch từ trung
            // bình lên đỉnh cộng một chấm. Bản trước bỏ qua mọi dải ngắn hơn hai điểm.
            if (run.length === 1) {
              return (
                <g key={first.minute}>
                  <line
                    className={styles.stem}
                    x1={x(first.minute)}
                    x2={x(first.minute)}
                    y1={y(avg(first)!)}
                    y2={y(peak(first)!)}
                  />
                  <circle className={styles.dot} cx={x(first.minute)} cy={y(avg(first)!)} r={2} />
                </g>
              );
            }
            const top = run.map((m) => `${x(m.minute)},${y(peak(m)!)}`);
            const line = run.map((m) => `${x(m.minute)},${y(avg(m)!)}`);
            // Dải khép kín giữa đỉnh và trung bình — một *vùng*, không phải một nét dày. Bản trước
            // vẽ đỉnh bằng `strokeWidth={4}` mờ, nên hai đường trông như hai series rời nhau thay
            // vì "trung bình nằm trong vùng đỉnh".
            const band = `M${top.join("L")}L${[...line].reverse().join("L")}Z`;
            return (
              <g key={first.minute}>
                <path className={styles.band} d={band} />
                <path className={styles.avg} d={`M${line.join("L")}`} fill="none" />
              </g>
            );
          })}

          {hovered !== undefined && (
            <g className={styles.crosshair}>
              <line
                className={styles.hair}
                x1={x(hovered.minute)}
                x2={x(hovered.minute)}
                y1={PAD_TOP}
                y2={PAD_TOP + PLOT_HEIGHT}
              />
              {hoveredPeak !== null && (
                <circle
                  className={styles.peakDot}
                  cx={x(hovered.minute)}
                  cy={y(hoveredPeak)}
                  r={3}
                />
              )}
              {hoveredAvg !== null && (
                <circle className={styles.dot} cx={x(hovered.minute)} cy={y(hoveredAvg)} r={3} />
              )}
            </g>
          )}
        </svg>

        {hover !== null && hovered !== undefined && (
          <div
            className={`${styles.readout} ${hover.left > (measured || width) / 2 ? styles.readoutLeft : ""}`}
            style={{ left: `${hover.left}px` }}
          >
            <div className={styles.readoutTime}>{clock.format(hovered.minute)}</div>
            <div className={styles.readoutRow}>
              <span className={styles.keyBand} />
              <strong>{hoveredPeak === null ? "—" : unit.value(hoveredPeak)}</strong>
              <span>{t("mixengine.metrics.peak")}</span>
            </div>
            <div className={styles.readoutRow}>
              <span className={styles.keyLine} />
              <strong>{hoveredAvg === null ? "—" : unit.value(hoveredAvg)}</strong>
              <span>{t("mixengine.metrics.average")}</span>
            </div>
            <div className={styles.readoutSamples}>
              {t("mixengine.metrics.samples", { count: hovered.samples })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
