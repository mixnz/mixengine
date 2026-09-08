import Select from "../Select";
import Button from "../Button";
import { ChevronLeftIcon, ChevronRightIcon } from "../../icons";
import { useTranslation } from "../../i18n";
import styles from "./Pagination.module.css";

interface Props {
  page: number;
  pageCount: number;
  total: number;
  pageSize: number;
  pageSizeOptions: number[];
  loading?: boolean;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  className?: string;
}

function Pagination({
  page,
  pageCount,
  total,
  pageSize,
  pageSizeOptions,
  loading,
  onPageChange,
  onPageSizeChange,
  className,
}: Props) {
  const { t } = useTranslation();
  return (
    <div className={`${styles.pagination}${className ? ` ${className}` : ""}`}>
      <Button
        size="small"
        className={styles.btn}
        aria-label={t("pagination.previousPage")}
        disabled={page <= 0 || loading}
        onClick={() => onPageChange(Math.max(0, page - 1))}
      >
        <ChevronLeftIcon />
      </Button>
      <span>{t("pagination.status", { page: page + 1, pageCount, total })}</span>
      <Button
        size="small"
        className={styles.btn}
        aria-label={t("pagination.nextPage")}
        disabled={page + 1 >= pageCount || loading}
        onClick={() => onPageChange(page + 1)}
      >
        <ChevronRightIcon />
      </Button>
      <Select
        value={pageSize}
        onChange={onPageSizeChange}
        size="small"
        className={styles.pageSizeSelect}
        triggerClassName={styles.pageSizeSelectTrigger}
        optionAlign="right"
        options={pageSizeOptions.map((n) => ({ value: n, label: t("pagination.perPage", { n }), optionLabel: n }))}
      />
    </div>
  );
}

export default Pagination;
