/** Một hàng trong hộp cuộn: `offsetTop` và `offsetHeight` của nó. */
export interface RowBox {
  top: number;
  height: number;
}

/** Hộp cuộn: đang cuộn tới đâu, và cao bao nhiêu (`clientHeight`). */
export interface ViewBox {
  scrollTop: number;
  height: number;
}

/**
 * Hộp cuộn phải cuộn tới đâu để thấy được một hàng, hoặc `null` khi không cần cuộn.
 *
 * `headerHeight` là phần trên cùng bị tiêu đề dính che. `scrollIntoView({block:"nearest"})` không
 * biết gì về nó: nó cuộn hàng tới đúng mép trên hộp, mà mép trên hộp lại đang nằm sau tiêu đề —
 * cuộn xong thì thứ vừa cuộn tới vẫn không đọc được. Nên phép tính nằm ở đây.
 *
 * Thuần, và nhận số chứ không nhận phần tử: một cái gọi từ `DbTab` chạy được trong một test không
 * cần trình duyệt, và cái duy nhất `DbTab` còn phải làm là đọc bốn con số ra khỏi DOM.
 */
export function scrollTopFor(row: RowBox, view: ViewBox, headerHeight: number): number | null {
  /** Mép trên và mép dưới của phần thật sự nhìn thấy, trong toạ độ nội dung của hộp. */
  const top = view.scrollTop + headerHeight;
  const bottom = view.scrollTop + view.height;

  let target: number;
  if (row.top < top) {
    // Ở trên: kéo xuống cho tới khi nó đứng ngay dưới tiêu đề.
    target = row.top - headerHeight;
  } else if (row.top + row.height > bottom) {
    /* Ở dưới: kéo lên vừa đủ để thấy hết. Một hàng cao hơn cả khung thì phép này lại đẩy phần đầu
       của nó ra ngoài, mà phần đầu — cái tên — mới là phần đáng thấy; nên nó canh theo mép trên. */
    target =
      row.height > view.height - headerHeight
        ? row.top - headerHeight
        : row.top + row.height - view.height;
  } else {
    return null;
  }

  target = Math.max(0, target);
  // Kẹp xong mà trùng chỗ đang đứng thì không có gì để cuộn — hàng đầu danh sách nằm một phần sau
  // tiêu đề là ca này, và nó không sửa được bằng cách cuộn.
  return target === view.scrollTop ? null : target;
}
