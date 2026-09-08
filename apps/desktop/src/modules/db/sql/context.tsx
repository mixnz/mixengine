import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { SqlApi } from "./api";
import type { SqlDialect } from "./dialect";

/** The engine behind the workspace: what to call, and what it does differently. */
export interface SqlContextValue {
  api: SqlApi;
  dialect: SqlDialect;
}

/**
 * Null rather than a MySQL default, so that a component rendered outside a workspace fails at once
 * and says so — instead of quietly sending `mysql_*` commands down a PostgreSQL connection, which
 * would surface much later as an error from the server about syntax nobody wrote.
 */
const SqlContext = createContext<SqlContextValue | null>(null);

/** Wraps one connection's workspace, naming the engine everything under it talks to. */
export function SqlProvider({
  api,
  dialect,
  children,
}: SqlContextValue & { children: ReactNode }) {
  const value = useMemo(() => ({ api, dialect }), [api, dialect]);
  return <SqlContext.Provider value={value}>{children}</SqlContext.Provider>;
}

function useSql(): SqlContextValue {
  const value = useContext(SqlContext);
  if (value === null) throw new Error("useSql must be used within a SqlProvider");
  return value;
}

/** Everything the workspace asks of the server it is connected to. */
export function useSqlApi(): SqlApi {
  return useSql().api;
}

/** What this engine does differently from the other. */
export function useSqlDialect(): SqlDialect {
  return useSql().dialect;
}

/**
 * The SQL engine behind this workspace, or null when there is none above.
 *
 * For the few components MongoDB shares with the SQL workspaces: they are rendered under both, so
 * they cannot demand a SQL connection the way {@link useSqlApi} does. They branch on their own
 * `kind` prop and reach for this only on the branch where a {@link SqlProvider} is guaranteed to be
 * above them — hence null rather than a throw, and hence the `kind` check being the thing that
 * decides, not this.
 */
export function useOptionalSql(): SqlContextValue | null {
  return useContext(SqlContext);
}
