/** Cái một hộp cuộn ngang nói về chính nó. Ba con số, không phải một phần tử — nên file này test
 *  được mà không cần DOM, đúng như `keyboard.ts`. */
export interface ScrollBox {
  scrollLeft: number;
  scrollWidth: number;
  clientWidth: number;
}

/** Dải tab còn giấu gì ở hai đầu. */
export interface StripOverflow {
  /** Có tab nào không vừa khung không — cái quyết định hai mũi tên có mặt hay không. */
  overflowing: boolean;
  /** Đã ở sát đầu trái: không còn gì bị giấu bên ấy, nên mũi tên trái không bấm được. */
  atStart: boolean;
  atEnd: boolean;
}

/* `scrollWidth` và `clientWidth` là số nguyên đã làm tròn còn `scrollLeft` thì không, nên một dải
   cuộn hết cỡ vẫn hay đứng cách mép cuối một phần pixel. Cùng lý do `core/scroll.ts` chừa đúng một
   pixel ở `hasRoom`. */
const EPSILON = 1;

/** Nhìn ba con số ra hai mũi tên. */
export function overflowState(box: ScrollBox): StripOverflow {
  const max = box.scrollWidth - box.clientWidth;
  if (max <= EPSILON) return { overflowing: false, atStart: true, atEnd: true };
  return {
    overflowing: true,
    atStart: box.scrollLeft <= EPSILON,
    atEnd: box.scrollLeft >= max - EPSILON,
  };
}

/** Phần khung một lần bấm mũi tên đi được. Chừa lại một ít để mắt còn bắt được chỗ vừa rời đi. */
const STEP_RATIO = 0.8;

/** Một lần bấm mũi tên cuộn bao nhiêu pixel. Ít nhất một, vì cuộn không pixel nào là không cuộn. */
export function scrollStep(clientWidth: number): number {
  return Math.max(1, Math.round(clientWidth * STEP_RATIO));
}
