import { useEffect, useState } from "react";

/** Chấm chạy `""` → `"."` → `".."` → `"..."`, lặp lại — báo còn sống trong lúc một việc dài đang chạy. */
export function useRunningDots(active: boolean): string {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!active) {
      setCount(0);
      return;
    }
    const id = window.setInterval(() => setCount((n) => (n + 1) % 4), 450);
    return () => window.clearInterval(id);
  }, [active]);
  return ".".repeat(count);
}
