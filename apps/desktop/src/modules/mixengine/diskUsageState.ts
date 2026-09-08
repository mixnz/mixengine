import type { CategoryUsage } from "./api/types/CategoryUsage";
import type { DiskCategory } from "./api/types/DiskCategory";

/** Tên field `CleanupQuery` ứng với một hạng mục, hoặc `null` cho ba hạng mục không dọn được qua
 *  `daemon.cleanup` (`runtimes`/`data`/`certs`) — chỉ `logs`/`cache` từng có `reclaim: "by_cleanup"`
 *  (`Reclaim` doc-comment: "Only Logs and Cache ever appear"). */
export function cleanupFlagFor(id: DiskCategory): "keep_logs" | "keep_cache" | null {
  if (id === "logs") return "keep_logs";
  if (id === "cache") return "keep_cache";
  return null;
}

/** Hạng mục này có nút dọn qua `daemon.cleanup` không — daemon nói, không suy từ tên hạng mục. */
export function isCleanupReclaimable(category: CategoryUsage): boolean {
  return category.reclaim.reclaim === "by_cleanup";
}
