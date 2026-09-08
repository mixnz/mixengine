/**
 * The dialects' write flags, checked together.
 *
 * One file rather than four because what is worth asserting is how they *differ*: an engine can
 * have the Structure tab open while the Query tab and dump/restore stay shut, and ClickHouse is
 * the first one that does. A single flag would make that impossible to express, and this is the
 * test that would fail if the three were ever folded back into one.
 */

import { describe, expect, it } from "vitest";
import { clickhouseDialect } from "../clickhouse/dialect";
import { mysqlDialect } from "../mysql/dialect";
import { postgresDialect } from "../postgres/dialect";
import { sqliteDialect } from "../sqlite/dialect";
import { CLICKHOUSE_ENGINES } from "../components/TableDialog/TableDialog";

const SQL_ENGINES = [mysqlDialect, postgresDialect, sqliteDialect];

describe("write flags", () => {
  it("leaves the three SQL engines with everything open", () => {
    for (const dialect of SQL_ENGINES) {
      expect(dialect.writable, dialect.kind).toBe(true);
      expect(dialect.dumpRestoreWritable, dialect.kind).toBe(true);
      expect(dialect.ddlWritable, dialect.kind).toBe(true);
      expect(dialect.rowsWritable, dialect.kind).toBe(true);
    }
  });

  it("opens ClickHouse's schema and dump/restore without opening its Query tab", () => {
    // `writable` gates only the Query tab now — DDL has `ddlWritable`, dump/restore has
    // `dumpRestoreWritable`, both split off because the Query tab's guard does not tell DDL from
    // DML, so reaching either through `writable` would open hand-typed `INSERT` along with it.
    expect(clickhouseDialect.ddlWritable).toBe(true);
    expect(clickhouseDialect.dumpRestoreWritable).toBe(true);
    expect(clickhouseDialect.writable).toBe(false);
  });
});

describe("ClickHouse table engines", () => {
  it("offers only engines that need no parameter", () => {
    // `CollapsingMergeTree` and `VersionedCollapsingMergeTree` each point at a `sign` column that
    // does not exist yet when the placeholder table is created, and the server refuses them:
    // `Code: 42 ... requires 1 parameter`.
    expect(CLICKHOUSE_ENGINES).toEqual([
      "MergeTree",
      "ReplacingMergeTree",
      "SummingMergeTree",
      "AggregatingMergeTree",
    ]);
  });

  it("starts from plain MergeTree", () => {
    // The engine cannot be changed once the table exists, so the default has to be the least
    // surprising of the four.
    expect(CLICKHOUSE_ENGINES[0]).toBe("MergeTree");
  });
});
