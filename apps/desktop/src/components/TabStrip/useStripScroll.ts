import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { overflowState, scrollStep, type StripOverflow } from "./overflow";

/**
 * Một dải tab dài hơn chỗ nó có: cuộn ngang bằng chuột, và hai mũi tên nói phía nào còn tab bị
 * giấu.
 *
 * Ba việc nhỏ đi chung một hook vì chúng nhìn cùng một phần tử và cùng ba con số của nó — tách
 * thành ba thì mỗi cái lại tự đo lại một lần.
 *
 * Không có thanh cuộn nào để nhìn (xem `TabStrip.module.css`), nên hai mũi tên là thứ duy nhất nói
 * rằng còn tab ở ngoài khung. Chúng hiện và ẩn *cùng nhau*, theo `overflowing`, và chỉ mờ đi theo
 * `atStart`/`atEnd`: một mũi tên tự thêm vào rồi tự bớt đi làm khung hẹp lại rồi rộng ra, và một
 * dải tab đang ở ngay ranh giới sẽ nhấp nháy giữa hai trạng thái.
 */
export interface StripScroll extends StripOverflow {
  /** `-1` là về phía trái, `1` là về phía phải. */
  scrollBy: (direction: -1 | 1) => void;
}

const FITS: StripOverflow = { overflowing: false, atStart: true, atEnd: true };

/* -------------------------------------------------------------------------------------------
   LƯỢT TRƯỢT

   Dải tab đi tới chỗ mấy nấc bánh xe vừa yêu cầu, một frame một bước, thay vì nhảy tới đó.

   `behavior: "smooth"` không làm được việc này. Gọi nó lần nữa giữa lúc nó đang chạy là *dựng lại*
   đường ease từ chỗ dải tab đang đứng, nên mỗi nấc bẻ vận tốc một lần — xoay nhanh thì nấc nào
   cũng bẻ, và cái mắt thấy là khựng. Trình duyệt không làm thế với Shift+bánh xe: nó nối tiếp
   animation đang chạy. Một phép tiệm cận số mũ nối tiếp được như vậy vì nó không có đường ease nào
   để dựng lại — thêm một nấc chỉ là dời cái đích, còn vận tốc thì liên tục.

   Đây đúng là lượt trượt `core/scroll.ts` chạy cho trục dọc, cùng hằng số, và vì cùng một lý do đã
   viết ở đó. Hai bản chứ không phải một, vì bên kia còn hai việc nữa mà bên này không có: tìm xem
   nấc thuộc về pane nào, và kéo dài một nấc khi bánh xe quay dồn. Cái duy nhất trùng nhau là mấy
   dòng dưới đây. */

/** Hằng số thời gian của lượt trượt. */
const GLIDE_MS = 55;
/** Còn gần đích hơn quãng này thì dừng lại ở đích luôn. */
const SETTLE_PX = 0.5;
/** Dải tab được phép lệch khỏi chỗ lượt trượt vừa đặt nó bao xa trước khi kết luận là có thứ khác
 *  đang cuộn nó — một lần bấm mũi tên, hay một tab tự kéo mình vào khung. `scrollLeft` bị chốt về
 *  pixel thiết bị nên nó vẫn trôi đi một phần pixel dù không ai đụng vào. */
const DRIFT_PX = 2;

/** Một lượt trượt đang chạy. */
interface Glide {
  /** Chỗ mấy nấc cho tới lúc này gộp lại đang yêu cầu. */
  target: number;
  /** `scrollLeft` cuối cùng lượt này tự ghi, để nhận ra một lần cuộn đến từ chỗ khác. */
  applied: number;
  /**
   * Frame gần nhất đã cựa quậy, theo đồng hồ của `requestAnimationFrame` — `null` cho tới frame
   * đầu tiên, và frame ấy chỉ để lấy giờ chứ không đi bước nào.
   *
   * Không lấy `performance.now()` lúc có nấc bánh xe làm mốc, dù hai đồng hồ ấy cùng một gốc: dấu
   * thời gian của một frame là lúc frame ấy *bắt đầu*, mà lúc ấy có thể sớm hơn cái nấc vừa xảy ra
   * trong chính frame đó. Quãng thời gian ra số âm, và một quãng âm trong phép tiệm cận bên dưới
   * là dải tab đi ngược. Còn khi nó ra một số lớn thì frame đầu nuốt trọn cả nấc rồi lượt trượt
   * dừng ngay tại đó — nấc nào cũng thành một cú giật rồi một khoảng đứng im, đúng cái phải sửa.
   */
  time: number | null;
  frame: number;
}

/** Một dải tab cuộn được xa nhất tới đâu. */
function maxScrollLeft(el: HTMLElement): number {
  return Math.max(0, el.scrollWidth - el.clientWidth);
}

/** Ô giữ lượt trượt của một dải tab. Ở ngoài hook vì ba hàm dưới đây chỉ đụng tới nó và tới phần
 *  tử được truyền vào — không đóng gói cái gì của một lần render, nên không có phụ thuộc nào để
 *  khai và không có bản cũ nào để lỡ giữ lại. */
type GlideRef = { current: Glide | null };

/** Bỏ lượt trượt đang chạy, nếu có. Gọi được cả khi không có. */
function stopGlide(glide: GlideRef): void {
  if (glide.current !== null) cancelAnimationFrame(glide.current.frame);
  glide.current = null;
}

/** Một bước của lượt trượt. */
function step(el: HTMLElement, glide: GlideRef, now: number): void {
  const g = glide.current;
  if (g === null) return;

  // Frame đầu tiên chỉ đặt đồng hồ. Xem `Glide.time`.
  if (g.time === null) {
    g.time = now;
    g.frame = requestAnimationFrame((t) => step(el, glide, t));
    return;
  }

  /* Thứ khác vừa cuộn dải tab — một tab tự kéo mình vào khung, một cú kéo tab chạm mép. Cái đó
     thắng, và lượt này thành cũ ngay lúc ấy. */
  if (Math.abs(el.scrollLeft - g.applied) > DRIFT_PX) {
    stopGlide(glide);
    return;
  }

  // Tab mở thêm hay đóng bớt giữa chừng đổi quãng còn đi được.
  g.target = Math.min(Math.max(g.target, 0), maxScrollLeft(el));

  const remaining = g.target - el.scrollLeft;
  if (Math.abs(remaining) < SETTLE_PX) {
    el.scrollLeft = g.target;
    stopGlide(glide);
    return;
  }

  // Tiệm cận số mũ, tính theo thời gian frame thật, để lượt trượt dài đúng bằng nhau trên màn
  // 144Hz và trên màn 60Hz.
  const before = el.scrollLeft;
  el.scrollLeft = before + remaining * (1 - Math.exp(-(now - g.time) / GLIDE_MS));
  if (el.scrollLeft === before) {
    // Một bước nhỏ tới mức làm tròn nuốt mất sẽ giữ vòng lặp này chạy mãi.
    el.scrollLeft = g.target;
    stopGlide(glide);
    return;
  }
  g.applied = el.scrollLeft;
  g.time = now;
  g.frame = requestAnimationFrame((t) => step(el, glide, t));
}

/**
 * Xê dịch đích của dải tab thêm `delta`, và trượt tới đó.
 *
 * Một cửa duy nhất cho cả bánh xe lẫn hai mũi tên. Nấc bánh xe đến dày hơn frame, nên chúng cộng
 * vào cái đích lượt trượt đang đi tới; tính lại từ chỗ dải tab đang đứng sẽ nuốt gần hết chúng, đó
 * đúng là chỗ `behavior: "smooth"` hỏng. Bấm mũi tên đi cùng đường ấy chứ không đi đường riêng, vì
 * một cú bấm giữa lúc bánh xe đang bay mà cắt ngang là bỏ mất quãng còn lại của bánh xe — và vì
 * hai cách cuộn cùng một dải tab thì không có lý do gì để cảm giác khác nhau.
 *
 * Kẹp, không thì xoay hết cỡ ở một đầu dựng lên một cái đích tận đâu và nấc quay ngược đầu tiên
 * chẳng nhúc nhích gì.
 */
function glideBy(el: HTMLElement, glide: GlideRef, delta: number): void {
  const max = maxScrollLeft(el);
  if (max === 0) return;

  const g = glide.current;
  if (g !== null && Math.abs(el.scrollLeft - g.applied) <= DRIFT_PX) {
    g.target = Math.min(Math.max(g.target + delta, 0), max);
    return;
  }

  stopGlide(glide);
  const next: Glide = {
    target: Math.min(Math.max(el.scrollLeft + delta, 0), max),
    applied: el.scrollLeft,
    time: null,
    frame: 0,
  };
  glide.current = next;
  next.frame = requestAnimationFrame((t) => step(el, glide, t));
}

export function useStripScroll(scroller: RefObject<HTMLDivElement | null>): StripScroll {
  const [state, setState] = useState<StripOverflow>(FITS);
  /* Cái trạng thái đang hiển thị, đọc được từ trong listener mà không phải dựng lại listener mỗi
     lần nó đổi. `setState` với một object mới mỗi lần đo là một vòng render vô tận, nên chỗ so
     sánh nằm ở đây. */
  const shown = useRef(state);
  /** Lượt trượt đang chạy, hoặc `null` khi dải tab đang đứng yên. */
  const glide = useRef<Glide | null>(null);

  const measure = useCallback(() => {
    const el = scroller.current;
    const next = el === null ? FITS : overflowState(el);
    const was = shown.current;
    if (
      next.overflowing === was.overflowing &&
      next.atStart === was.atStart &&
      next.atEnd === was.atEnd
    ) {
      return;
    }
    shown.current = next;
    setState(next);
  }, [scroller]);

  /* Sau mỗi lần render, vì mở thêm hay đóng bớt một tab đổi `scrollWidth` mà không đổi kích thước
     phần tử nào — `ResizeObserver` bên dưới không thấy gì. Rẻ như `useTabSlide` ngay cạnh: ba thuộc
     tính, và không `setState` khi ba con số ra cùng một kết quả. */
  useLayoutEffect(measure);

  useEffect(() => {
    const el = scroller.current;
    if (el === null) return;
    const stop = new AbortController();

    // Cuộn tới đâu thì mũi tên nào tắt đổi theo — kể cả lần cuộn do chính hai mũi tên gây ra.
    el.addEventListener("scroll", measure, { passive: true, signal: stop.signal });

    /* Bánh xe chuột chỉ có một trục, và trục ấy là trục dải tab không có. Nấc đi vào lượt trượt ở
       đầu file — chặn cái mặc định là chặn luôn animation trình duyệt vẫn chạy cho một nấc, nên
       phần ấy phải tự chạy lấy, và `glideBy` giải thích tại sao nó chạy như thế.

       `passive: false` vì nó phải chặn: không chặn thì trang phía sau cuộn theo. Chuột cảm ứng gửi
       `deltaX` của riêng nó và được để yên — trình duyệt cuộn ngang hộ rồi, và Shift+bánh xe cũng
       vậy, nên cả hai đi qua đây mà không bị đụng tới.

       Chỉ nhận nấc tính bằng pixel: `deltaY` ở chế độ dòng hay trang không phải con số `scrollLeft`
       cần, cùng chỗ vạch mà `core/scroll.ts` vạch. Mọi webview app này chạy trên đều gửi pixel. */
    el.addEventListener(
      "wheel",
      (e) => {
        if (e.deltaY === 0 || e.ctrlKey || e.shiftKey || e.altKey || e.metaKey) return;
        if (e.deltaMode !== WheelEvent.DOM_DELTA_PIXEL) return;
        if (maxScrollLeft(el) === 0) return;
        e.preventDefault();
        glideBy(el, glide, e.deltaY);
      },
      { passive: false, signal: stop.signal },
    );

    // Cửa sổ hẹp lại là số tab vừa khung ít đi, và một dải tab của tab không đứng trước thì rộng 0
    // cho tới lúc nó được nhìn tới.
    const resize = new ResizeObserver(measure);
    resize.observe(el);
    return () => {
      stop.abort();
      resize.disconnect();
      stopGlide(glide);
    };
  }, [scroller, measure]);

  const scrollTo = useCallback(
    (direction: -1 | 1) => {
      const el = scroller.current;
      if (el === null) return;
      glideBy(el, glide, direction * scrollStep(el.clientWidth));
    },
    [scroller],
  );

  return { ...state, scrollBy: scrollTo };
}

/**
 * Tab đang mở luôn nằm trong khung.
 *
 * `Ctrl+Tab` sang cái thứ mười, hay một tab mới mở ở cuối một dải đã đầy, thì cái được chọn nằm
 * ngoài chỗ nhìn thấy — và không còn thanh cuộn nào để nói nó ở đâu. Chỉ chạy khi tab đang mở *đổi*
 * chứ không phải sau mỗi lần render: nếu không thì người dùng cuộn sang xem một tab khác sẽ bị kéo
 * ngược về chỗ cũ ngay lập tức.
 *
 * `data-active` chứ không phải một prop: `TabStrip` nhận tab của mình dưới dạng `children` và không
 * biết cái nào đang mở — `Tab` thì biết, và nó đánh dấu lên chính nó.
 */
export function useActiveTabInView(scroller: RefObject<HTMLDivElement | null>): void {
  const last = useRef<Element | null>(null);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el === null) return;
    const active = el.querySelector("[data-active]");
    if (active === last.current) return;
    last.current = active;
    /* Một dải nằm trên tab không đứng trước được bày ở kích thước 0 và mọi thứ trong nó chồng lên
       nhau ở mép trái — cuộn theo cái đo được ở đó là cuộn về một chỗ vô nghĩa. Cùng lý do
       `useTabSlide` không đo một dải đang ẩn. */
    if (active === null || el.offsetParent === null) return;
    active.scrollIntoView({ block: "nearest", inline: "nearest" });
  });
}
