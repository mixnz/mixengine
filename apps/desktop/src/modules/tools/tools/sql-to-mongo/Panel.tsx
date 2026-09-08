import { useState } from "react";
import Button from "../../../../components/Button";
import { Textarea } from "../../../../components/Input";
import Select, { type SelectOption } from "../../../../components/Select";
import { useTranslation, type TranslationKey } from "../../../../i18n";
import CopyField from "../../components/CopyField";
import { translate } from "./translate";
import type { Dialect, Translation, Unsupported, Warning } from "./types";
import styles from "./Panel.module.css";

const DIALECTS: SelectOption<Dialect>[] = [
  { value: "mysql", label: "MySQL" },
  { value: "postgresql", label: "PostgreSQL" },
];

const UNSUPPORTED_KEY: Record<Unsupported["code"], TranslationKey> = {
  join: "toolbox.sqlToMongo.unsupportedJoin",
  subquery: "toolbox.sqlToMongo.unsupportedSubquery",
  union: "toolbox.sqlToMongo.unsupportedUnion",
  cte: "toolbox.sqlToMongo.unsupportedCte",
  window: "toolbox.sqlToMongo.unsupportedWindow",
  dml: "toolbox.sqlToMongo.unsupportedDml",
  case: "toolbox.sqlToMongo.unsupportedCase",
  function: "toolbox.sqlToMongo.unsupportedFunction",
  multi: "toolbox.sqlToMongo.unsupportedMulti",
  parse: "toolbox.sqlToMongo.unsupportedParse",
};

const WARNING_KEY: Record<Warning["code"], TranslationKey> = {
  isNull: "toolbox.sqlToMongo.warningIsNull",
  type: "toolbox.sqlToMongo.warningType",
  objectId: "toolbox.sqlToMongo.warningObjectId",
  starWithGroupBy: "toolbox.sqlToMongo.warningStarWithGroupBy",
};

function SqlToMongoPanel() {
  const { t } = useTranslation();
  const [sql, setSql] = useState("");
  const [dialect, setDialect] = useState<Dialect>("mysql");
  const [result, setResult] = useState<Translation | null>(null);
  // Lần bấm đầu tiên còn phải tải chunk parser về, nên nút phải nói là nó đang làm gì.
  const [busy, setBusy] = useState(false);

  const run = () => {
    setBusy(true);
    void translate(sql, dialect)
      .then(setResult)
      .finally(() => setBusy(false));
  };

  return (
    <div className={styles.panel}>
      <p className={styles.bestEffort}>{t("toolbox.sqlToMongo.bestEffort")}</p>

      <label className={styles.field}>
        <span className={styles.fieldLabel}>{t("toolbox.sqlToMongo.sql")}</span>
        <Textarea
          value={sql}
          onChange={(event) => setSql(event.target.value)}
          placeholder="SELECT name FROM users WHERE age > 18 ORDER BY name LIMIT 10"
          maxRows={12}
        />
      </label>

      <div className={styles.controls}>
        <Select
          value={dialect}
          options={DIALECTS}
          onChange={setDialect}
          ariaLabel={t("toolbox.sqlToMongo.dialect")}
          className={styles.dialect}
        />
        <Button variant="primary" onClick={run} disabled={busy || sql.trim() === ""}>
          {busy ? t("common.loading") : t("toolbox.sqlToMongo.translate")}
        </Button>
      </div>

      {/* Câu không dịch được thì **không có ô kết quả nào cả** — không phải một ô rỗng, mà là
          không có ô. Đây là chỗ luật "không bao giờ xuất kết quả một phần" hiện lên màn hình. */}
      {result && !result.ok ? (
        <section className={styles.problems}>
          <h3 className={styles.heading}>{t("toolbox.sqlToMongo.unsupportedTitle")}</h3>
          <ul className={styles.list}>
            {result.unsupported.map((item) => (
              <li key={item.code}>
                {t(UNSUPPORTED_KEY[item.code])} <code className={styles.fragment}>{item.fragment}</code>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {result?.ok ? (
        <>
          <CopyField label={t("toolbox.sqlToMongo.result")} value={result.output} multiline />
          {result.warnings.length > 0 ? (
            <section className={styles.warnings}>
              <h3 className={styles.heading}>{t("toolbox.sqlToMongo.warningsTitle")}</h3>
              <ul className={styles.list}>
                {result.warnings.map((item) => (
                  <li key={`${item.code}:${item.fragment}`}>
                    {t(WARNING_KEY[item.code])}{" "}
                    <code className={styles.fragment}>{item.fragment}</code>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

export default SqlToMongoPanel;
