import type { EnvPair } from "../env/env";

/**
 * Tách và ghép chuỗi kết nối của bốn loại DB mà MixDB hỗ trợ.
 *
 * Tool không mở kết nối nào để thử xem chuỗi có đúng không — nó chỉ đọc và viết.
 */

export type DbKind = "mysql" | "postgres" | "mongodb" | "redis";

export interface ConnectionParam {
  key: string;
  value: string;
}

export interface ConnectionFields {
  kind: DbKind;
  /** Chỉ có nghĩa với MongoDB: `mongodb+srv://` lấy host và cổng từ bản ghi SRV của DNS. */
  srv: boolean;
  host: string;
  /** Chuỗi chứ không phải số: ô rỗng là "dùng mặc định", và `0` không phải cách nói điều đó. */
  port: string;
  user: string;
  password: string;
  database: string;
  params: ConnectionParam[];
}

export const DEFAULT_PORT: Record<DbKind, string> = {
  mysql: "3306",
  postgres: "5432",
  mongodb: "27017",
  redis: "6379",
};

const SCHEMES: Record<string, { kind: DbKind; srv: boolean }> = {
  "mysql:": { kind: "mysql", srv: false },
  "postgresql:": { kind: "postgres", srv: false },
  "postgres:": { kind: "postgres", srv: false },
  "mongodb:": { kind: "mongodb", srv: false },
  "mongodb+srv:": { kind: "mongodb", srv: true },
  "redis:": { kind: "redis", srv: false },
  "rediss:": { kind: "redis", srv: false },
};

const SCHEME_OF: Record<DbKind, string> = {
  mysql: "mysql",
  postgres: "postgresql",
  mongodb: "mongodb",
  redis: "redis",
};

/** `decodeURIComponent` ném với chuỗi phần trăm hỏng như `%zz`. Một chuỗi kết nối gõ tay có thể
 *  chứa đúng thứ đó, và trả về nguyên văn thì có ích hơn là không trả về gì. */
function safeDecode(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

export function parseConnectionString(text: string): ConnectionFields | null {
  let url: URL;
  try {
    url = new URL(text.trim());
  } catch {
    return null;
  }
  const scheme = SCHEMES[url.protocol];
  if (!scheme) return null;

  return {
    kind: scheme.kind,
    srv: scheme.srv,
    host: url.hostname,
    port: scheme.srv ? "" : url.port,
    /* Đây là chỗ hỏng im lặng: `url.username` và `url.password` trả về chuỗi **đã** percent-encode,
       khác với `pathname` và `searchParams`. Quên decode thì ô mật khẩu hiện `p%40ss`, người dùng
       chép nó sang một file config, và triệu chứng ở đầu kia là "sai tài khoản". */
    user: safeDecode(url.username),
    password: safeDecode(url.password),
    database: url.pathname.replace(/^\//, ""),
    params: [...url.searchParams].map(([key, value]) => ({ key, value })),
  };
}

function query(params: ConnectionParam[]): string {
  const parts = params
    .filter((param) => param.key !== "")
    .map((param) => `${encodeURIComponent(param.key)}=${encodeURIComponent(param.value)}`);
  return parts.length === 0 ? "" : `?${parts.join("&")}`;
}

export function toUri(fields: ConnectionFields): string {
  const scheme = fields.kind === "mongodb" && fields.srv ? "mongodb+srv" : SCHEME_OF[fields.kind];
  /* Encode cả user lẫn mật khẩu. `/`, `?` và `#` là bắt buộc — thiếu chúng thì chuỗi không parse
     được ở đâu cả. `@` và `:` thì `URL` vẫn đọc đúng nhờ luật "cắt ở `@` cuối cùng", nhưng chuỗi
     này còn được dán sang driver, sang file config và sang mắt người, và không phải chỗ nào cũng
     theo luật đó. */
  const auth =
    fields.user === "" && fields.password === ""
      ? ""
      : `${encodeURIComponent(fields.user)}${
          fields.password === "" ? "" : `:${encodeURIComponent(fields.password)}`
        }@`;
  const port = fields.srv || fields.port === "" ? "" : `:${fields.port}`;
  const database = fields.database === "" ? "" : `/${fields.database}`;
  return `${scheme}://${auth}${fields.host}${port}${database}${query(fields.params)}`;
}

/** `null` cho MongoDB và Redis: hai loại đó **không có chuẩn JDBC**, và in ra một chuỗi
 *  `jdbc:mongodb://…` trông hợp lệ là đưa cho người dùng một thứ sẽ hỏng ở nơi khác. */
export function toJdbc(fields: ConnectionFields): string | null {
  if (fields.kind !== "mysql" && fields.kind !== "postgres") return null;
  const driver = fields.kind === "mysql" ? "mysql" : "postgresql";
  const port = fields.port === "" ? DEFAULT_PORT[fields.kind] : fields.port;
  const auth: ConnectionParam[] = [];
  if (fields.user !== "") auth.push({ key: "user", value: fields.user });
  if (fields.password !== "") auth.push({ key: "password", value: fields.password });
  const all = [...auth, ...fields.params];
  return `jdbc:${driver}://${fields.host}:${port}/${fields.database}${query(all)}`;
}

/** Tên cố định `DB_*` chứ không theo tên biến của image docker chính thức
 *  (`MYSQL_ROOT_PASSWORD`, `POSTGRES_USER`…): những tên đó khác nhau theo từng image và từng
 *  phiên bản, còn `DB_*` thì đoán được và sửa lại một dòng là xong. */
export function toEnvPairs(fields: ConnectionFields): EnvPair[] {
  return [
    { key: "DB_HOST", value: fields.host },
    { key: "DB_PORT", value: fields.port === "" ? DEFAULT_PORT[fields.kind] : fields.port },
    { key: "DB_USER", value: fields.user },
    { key: "DB_PASSWORD", value: fields.password },
    { key: "DB_NAME", value: fields.database },
  ];
}
