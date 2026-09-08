import { memo } from "react";
import ResultGrid from "./ResultGrid";
import { TerminalIcon } from "../../../../icons";
import { useTranslation } from "../../../../i18n";
import type { SqlStatementResult } from "../../types";
import styles from "./QueryEditor.module.css";

interface Props {
  /** One result per statement, or null before anything has been run. */
  results: SqlStatementResult[] | null;
  /** How many statements the script was split into and sent as. Not `results.length`: a statement
   *  that fails stops the script, so what came back can be fewer than what went out — which is the
   *  whole reason the summary line exists. */
  statementsSent: number;
  /** A failure to run the script at all. Per-statement errors travel inside `results`. */
  error: string;
  /** How many statements of this run were sent with a `LIMIT` they were not written with. Said out
   *  loud so a shortened result is never mistaken for the whole answer. */
  limitsAdded: number;
  /** The ceiling that was applied, for the sentence that says so. */
  limit: number;
}

/**
 * What running the script produced.
 *
 * Split out of the editor and **memoised**, which is the whole point of it being its own file: a
 * result of a thousand rows is tens of thousands of cells, and this used to be rebuilt on every
 * keystroke — the editor kept the script in React state, so typing re-rendered the grid, formatted
 * every cell again and worked out every tooltip again. Editing a script above a large result went
 * from instant to seconds per key.
 *
 * The editor no longer re-renders as it is typed in, and this no longer re-renders when it does.
 * Both halves matter: one of them alone leaves the other free to bring the problem back.
 */
function QueryResults({ results, error, limitsAdded, limit, statementsSent }: Props) {
  const { t } = useTranslation();

  /** The one line under a result's header that says what it did. */
  function summary(result: SqlStatementResult): string {
    switch (result.kind) {
      case "rows":
        return result.truncated
          ? t("query.truncated", { n: result.rows.length })
          : t("query.rowCount", { n: result.rows.length });
      case "affected": {
        const changed = t("query.affected", { n: result.rowsAffected });
        return result.lastInsertId === null
          ? changed
          : `${changed} · ${t("query.lastInsertId", { id: result.lastInsertId })}`;
      }
      default:
        return t("query.ok");
    }
  }

  /** Whether this result has a grid under it — which is where its summary goes when it does. The
   *  grid already stands a strip of its own for the filter box, and a line of text above that strip
   *  saying the same kind of thing spent two lines of the pane on one sentence. */
  function hasGrid(result: SqlStatementResult): boolean {
    return result.kind === "rows" && result.columns.length > 0;
  }

  /** What the server spent on the statements that ran, added up. Wall-clock time would be a bigger
   *  number — the round trip and the decoding are in it — and would not agree with the per-statement
   *  figures in the headers below. Numbers that add up are what make the line readable. */
  const totalMs = results?.reduce((sum, result) => sum + result.durationMs, 0) ?? 0;

  return (
    <>
      {/* Only for a script of more than one statement. One statement has its time in its own header
          a few pixels below, and a line repeating it says nothing. Which also keeps this clear of
          having to say "1 statement" in two languages. */}
      {results !== null && statementsSent > 1 && (
        <p className={styles.note}>
          {results.length === statementsSent
            ? t("query.scriptSummaryAll", { m: statementsSent, ms: totalMs })
            : t("query.scriptSummary", {
                n: results.length,
                m: statementsSent,
                ms: totalMs,
              })}
        </p>
      )}
      {/* Above the results rather than inside one of them: the ceiling was put on the script, and
          which statements it touched is visible in the statement each result quotes.

          Outside the scrolling column too, and not merely first in it. A result card is capped at
          the full height of that column so it can never overhang the pane; a line of text sharing
          the column with it pushed the first card down by its own height, and the bottom of that
          card — the last rows of the table and the end of its scrollbar — off the bottom edge. */}
      {results !== null && limitsAdded > 0 && (
        <p className={styles.note}>{t("query.limitAdded", { n: limitsAdded, limit })}</p>
      )}
      <div className={styles.results}>
        {error !== "" && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
        {/* A script of nothing but comments runs, successfully, and has nothing to report. Without
            this the pane would rise and then simply be blank. Nothing is said about a tab that has
            not been run yet — the pane is not standing up at all until something is. */}
        {error === "" && results !== null && results.length === 0 && (
          <div className={styles.emptyState}>
            <TerminalIcon size={30} className={styles.emptyIcon} />
            <p className={styles.emptyTitle}>{t("query.noStatements")}</p>
            <p className={styles.emptyHint}>{t("query.noStatementsHint")}</p>
          </div>
        )}
        {results?.map((result, i) => (
          <section key={i} className={styles.result}>
            <header className={styles.resultHeader}>
              <span className={styles.resultLabel}>
                {t("query.resultLabel", { n: i + 1, verb: result.verb })}
              </span>
              <span className={styles.resultDuration}>
                {t("query.duration", { ms: result.durationMs })}
              </span>
              {/* One line of it: the statement is in the editor above, and this is only here to say
                  which of the statements up there this result belongs to. */}
              <span className={styles.resultStatement} title={result.statement}>
                {result.statement}
              </span>
            </header>

            <div className={styles.resultBody}>
              {result.error !== null && (
                <div className={styles.resultError} role="alert">
                  <p>{result.error}</p>
                  <p className={styles.resultErrorNote}>{t("query.statementFailed")}</p>
                </div>
              )}
              {/* Only for the results with no grid to carry it: a statement that changed rows, one
                  that returned no columns at all, or one that failed. */}
              {result.error === null && !hasGrid(result) && (
                <p className={styles.resultSummary}>{summary(result)}</p>
              )}

              {result.kind === "rows" && result.columns.length > 0 && (
                // The grid is its own component and its own memo: past a few dozen rows it holds
                // only the rows on screen, and how it works out which those are is a fair amount of
                // machinery to keep out of the way of everything else in this file.
                <ResultGrid
                  columns={result.columns}
                  rows={result.rows}
                  summary={summary(result)}
                />
              )}
            </div>
          </section>
        ))}
      </div>
    </>
  );
}

export default memo(QueryResults);
