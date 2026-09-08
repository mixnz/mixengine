use crate::modules::db::models::{ServerInfo};
use crate::error::AppError;
use redis::aio::ConnectionManager;
use redis::Value as RedisValue;
use redis::{ConnectionAddr, ConnectionInfo, IntoConnectionInfo, RedisConnectionInfo};
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};

/// One tab's connection to a Redis server, and everything needed to open it again.
///
/// The commands go through a `ConnectionManager` rather than a plain multiplexed connection: a
/// desktop client sits idle for long stretches, and an idle socket is exactly what a server's
/// `timeout` (or anything between the two) closes. The manager notices the dropped socket and
/// dials again in the background, where a bare connection would fail every command from then on
/// and leave the user to reconnect the tab by hand.
pub struct Connection {
    /// What the manager was built from — address, credentials and the selected database.
    info: ConnectionInfo,
    manager: ConnectionManager,
}

impl Connection {
    /// The handle every command is sent through.
    pub fn commands(&mut self) -> &mut ConnectionManager {
        &mut self.manager
    }
}

/// The connection details for `host:port`, database `db`.
///
/// Built as values rather than formatted into a `redis://` URL: a URL percent-decodes what it
/// carries, so a password holding a `%`, `@`, `/` or `#` — all perfectly ordinary in a generated
/// password — would arrive at the server as different characters, or make the URL unparseable
/// outright.
///
/// `username` is the Redis 6 ACL user. Left empty it is sent as nothing at all, which is what an
/// older server (or the default user's `requirepass`) expects.
fn connection_info(
    host: &str,
    port: u16,
    username: Option<&str>,
    password: Option<&str>,
    db: i64,
) -> Result<ConnectionInfo, AppError> {
    let mut redis_settings = RedisConnectionInfo::default().set_db(db);
    if let Some(username) = username.filter(|u| !u.is_empty()) {
        redis_settings = redis_settings.set_username(username);
    }
    if let Some(password) = password.filter(|p| !p.is_empty()) {
        redis_settings = redis_settings.set_password(password);
    }
    ConnectionAddr::Tcp(host.to_string(), port)
        .into_connection_info()
        .map_err(|e| err!("error.redis", message = e))
        .map(|info| info.set_redis_settings(redis_settings))
}

async fn open(info: ConnectionInfo) -> Result<Connection, AppError> {
    let client = redis::Client::open(info.clone()).map_err(|e| err!("error.redis", message = e))?;
    let manager = ConnectionManager::new(client)
        .await
        .map_err(|e| err!("error.redis", message = e))?;
    Ok(Connection { info, manager })
}

/// Opens a connection to `host:port`, already switched to database `db`.
pub async fn connect(
    host: &str,
    port: u16,
    username: Option<&str>,
    password: Option<&str>,
    db: i64,
) -> Result<Connection, AppError> {
    open(connection_info(host, port, username, password, db)?).await
}

pub async fn run_command(
    conn: &mut ConnectionManager,
    args: Vec<String>,
) -> Result<Value, AppError> {
    let Some((name, rest)) = args.split_first() else {
        return Err(err!("error.emptyRedisCommand"));
    };
    let mut cmd = redis::cmd(name);
    for a in rest {
        cmd.arg(a);
    }
    let reply: RedisValue = cmd.query_async(conn).await.map_err(|e| err!("error.redis", message = e))?;
    Ok(redis_value_to_json(reply))
}

fn redis_value_to_json(value: RedisValue) -> Value {
    match value {
        RedisValue::Nil => Value::Null,
        RedisValue::Int(i) => Value::from(i),
        RedisValue::Double(d) => serde_json::Number::from_f64(d)
            .map(Value::Number)
            .unwrap_or(Value::Null),
        RedisValue::Boolean(b) => Value::Bool(b),
        RedisValue::BulkString(bytes) => Value::String(String::from_utf8_lossy(&bytes).to_string()),
        RedisValue::SimpleString(s) => Value::String(s),
        RedisValue::Okay => Value::String("OK".to_string()),
        RedisValue::Array(items) | RedisValue::Set(items) => {
            Value::Array(items.into_iter().map(redis_value_to_json).collect())
        }
        RedisValue::Map(pairs) => {
            let mut obj = serde_json::Map::new();
            for (k, v) in pairs {
                let key = match redis_value_to_json(k) {
                    Value::String(s) => s,
                    other => other.to_string(),
                };
                obj.insert(key, redis_value_to_json(v));
            }
            Value::Object(obj)
        }
        other => Value::String(format!("{other:?}")),
    }
}

/// Redis values are byte strings, not text: a key or a member may hold anything, including bytes
/// that are no valid UTF-8 at all. Everything shown on screen goes through here, so such a value
/// arrives as replacement characters rather than failing the whole read.
fn to_text(bytes: &[u8]) -> String {
    String::from_utf8_lossy(bytes).to_string()
}

/// Reads what the header shows about the server, off `INFO server` — a section every Redis
/// serves, unlike `CONFIG`, which managed deployments often withhold.
pub async fn server_info(conn: &mut ConnectionManager) -> Result<ServerInfo, AppError> {
    let text: String = redis::cmd("INFO")
        .arg("server")
        .query_async(conn)
        .await
        .map_err(|e| err!("error.redis", message = e))?;

    let mut version = String::new();
    let mut os = String::new();
    for line in text.lines() {
        if let Some(v) = line.strip_prefix("redis_version:") {
            version = v.trim().to_string();
        } else if let Some(v) = line.strip_prefix("os:") {
            os = v.trim().to_string();
        }
    }
    Ok(ServerInfo { version, os })
}

/// One numbered database, and how many keys it holds — the count is what tells an empty index
/// from one worth opening, since a Redis database has no name to go by.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DbInfo {
    pub index: i64,
    pub keys: i64,
}

/// What a server serves when it won't say: the stock `databases` setting.
const DEFAULT_DATABASE_COUNT: i64 = 16;

/// How many databases this server was configured with. `CONFIG GET` is disabled or renamed on a
/// good number of managed Redis offerings, so a failure here is ordinary rather than exceptional
/// and falls back to the default instead of failing the listing.
async fn database_count(conn: &mut ConnectionManager) -> i64 {
    let config: Result<HashMap<String, String>, _> = redis::cmd("CONFIG")
        .arg("GET")
        .arg("databases")
        .query_async(conn)
        .await;
    config
        .ok()
        .and_then(|c| c.get("databases").and_then(|v| v.parse().ok()))
        .filter(|n| *n > 0)
        .unwrap_or(DEFAULT_DATABASE_COUNT)
}

pub async fn list_databases(conn: &mut ConnectionManager) -> Result<Vec<DbInfo>, AppError> {
    let count = database_count(conn).await;
    // `INFO keyspace` lists only the databases that hold something, one line per database:
    // `db0:keys=12,expires=1,avg_ttl=0`. Every other index exists too, it is simply empty.
    let keyspace: String = redis::cmd("INFO")
        .arg("keyspace")
        .query_async(conn)
        .await
        .map_err(|e| err!("error.redis", message = e))?;

    Ok(databases(count, &keyspace_counts(&keyspace)))
}

/// How many keys each database holds, read off `INFO keyspace`.
///
/// Its own function so that the shape of the reply — which is a server's, not this app's — can be
/// checked without a server. A line that is not one of these is skipped rather than guessed at:
/// the reply opens with a `# Keyspace` header, and a future Redis may add more.
fn keyspace_counts(keyspace: &str) -> HashMap<i64, i64> {
    let mut counts: HashMap<i64, i64> = HashMap::new();
    for line in keyspace.lines() {
        let Some((name, stats)) = line.split_once(':') else { continue };
        let Some(index) = name.trim().strip_prefix("db").and_then(|n| n.parse::<i64>().ok()) else {
            continue;
        };
        let keys = stats
            .split(',')
            .find_map(|part| part.trim().strip_prefix("keys=")?.parse::<i64>().ok())
            .unwrap_or(0);
        counts.insert(index, keys);
    }
    counts
}

/// Every database the sidebar lists: all `count` of them, with the ones `INFO keyspace` named
/// carrying their key counts and the rest showing zero.
fn databases(count: i64, counts: &HashMap<i64, i64>) -> Vec<DbInfo> {
    // A database beyond the configured count can still be the one in use, when the count came
    // from the fallback in `database_count` — keep any index the keyspace named, whatever the
    // count says.
    let highest_used = counts.keys().copied().max().unwrap_or(-1);
    let total = count.max(highest_used + 1);
    (0..total)
        .map(|index| DbInfo {
            index,
            keys: counts.get(&index).copied().unwrap_or(0),
        })
        .collect()
}

/// Points this connection at another numbered database. Sticky: the connection is one per open
/// tab, and everything read afterwards comes from the database selected here.
///
/// Opens a fresh connection rather than sending `SELECT` over the current one. The manager
/// reconnects on its own after a dropped socket, and it does so from the `ConnectionInfo` it was
/// built with — a `SELECT` sent by hand would be forgotten by that reconnect, and the tab would
/// quietly go on reading a different database than the one it is showing.
pub async fn select_db(conn: &mut Connection, index: i64) -> Result<(), AppError> {
    let settings = conn.info.redis_settings().clone().set_db(index);
    let info = conn.info.clone().set_redis_settings(settings);
    *conn = open(info).await?;
    Ok(())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KeyInfo {
    pub name: String,
    /// `string`, `list`, `set`, `zset`, `hash`, `stream`, or whatever a module registered.
    #[serde(rename = "type")]
    pub kind: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KeyPage {
    pub keys: Vec<KeyInfo>,
    /// Where the next page resumes. Opaque — it is Redis's own cursor, not an offset.
    pub cursor: String,
    /// Whether the cursor has come full circle, i.e. there is nothing left to load.
    pub done: bool,
}

/// How many rounds of `SCAN` one page is allowed to spend before handing back what it has.
/// `SCAN` guarantees no more than a slice of the keyspace per round, and a selective `MATCH`
/// over a large one can return nothing at all for many rounds running — bounding the rounds is
/// what keeps a single "load more" bounded in time. The cursor handed back resumes where this
/// page stopped, so nothing is lost by stopping early.
const MAX_SCAN_ROUNDS: usize = 20;

/// Reads TYPE for a batch of keys in one round trip. Worth pipelining: the type is what the
/// list shows next to each name, so it is one command per key on every page otherwise.
async fn key_types(
    conn: &mut ConnectionManager,
    names: &[String],
) -> Result<Vec<String>, AppError> {
    if names.is_empty() {
        return Ok(Vec::new());
    }
    let mut pipe = redis::pipe();
    for name in names {
        pipe.cmd("TYPE").arg(name);
    }
    pipe.query_async(conn).await.map_err(|e| err!("error.redis", message = e))
}

/// One page of the keyspace. `cursor` is `"0"` for the first page and whatever the previous page
/// handed back for the ones after it.
///
/// Keys arrive by `SCAN` rather than `KEYS`: `KEYS` walks the whole keyspace in one blocking go,
/// which is exactly the thing not to do to a live server. The price is that pages are not a
/// partition — `SCAN` may hand back a key twice across rounds, and only a key present for the
/// whole walk is guaranteed to show up at all.
pub async fn scan_keys(
    conn: &mut ConnectionManager,
    pattern: &str,
    cursor: &str,
    count: i64,
) -> Result<KeyPage, AppError> {
    let pattern = match pattern.trim() {
        "" => "*",
        p => p,
    };
    let mut cursor = cursor.to_string();
    let mut names: Vec<String> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();

    for _ in 0..MAX_SCAN_ROUNDS {
        let (next, batch): (String, Vec<Vec<u8>>) = redis::cmd("SCAN")
            .arg(&cursor)
            .arg("MATCH")
            .arg(pattern)
            .arg("COUNT")
            .arg(count)
            .query_async(conn)
            .await
            .map_err(|e| err!("error.redis", message = e))?;
        for raw in &batch {
            let name = to_text(raw);
            if seen.insert(name.clone()) {
                names.push(name);
            }
        }
        cursor = next;
        if cursor == "0" || names.len() as i64 >= count {
            break;
        }
    }

    let done = cursor == "0";
    let types = key_types(conn, &names).await?;
    let keys = names
        .into_iter()
        .zip(types)
        .map(|(name, kind)| KeyInfo { name, kind })
        .collect();
    Ok(KeyPage { keys, cursor, done })
}

/// One page of a single key's value.
///
/// The item shape follows `kind`: a string yields one `{ value }`; a list `{ index, value }`; a
/// set `{ value }`; a sorted set `{ value, score }`; a hash `{ field, value }`. Anything else —
/// a stream, a module type — yields no items at all, and the front end says so rather than
/// pretending the key is empty.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KeyValuePage {
    #[serde(rename = "type")]
    pub kind: String,
    /// Seconds left to live, or `-1` for a key with no expiry and `-2` for one that is gone.
    pub ttl: i64,
    /// How many items the key holds in total, or `-1` when the type gives no cheap count.
    pub total: i64,
    pub items: Vec<Value>,
    /// Where the next page resumes, or `None` when the value has been read to its end. An
    /// offset for the ordered types and Redis's own cursor for the scanned ones — either way
    /// it is opaque, to be handed back as it arrived.
    pub next_cursor: Option<String>,
}

/// The same round cap as the keyspace scan, and for the same reason — `SSCAN`/`HSCAN` return
/// a slice per round, not a fixed number of items.
const MAX_VALUE_SCAN_ROUNDS: usize = 20;

/// A score as JSON. Redis sorts on doubles, and `+inf`/`-inf`/`nan` are legal scores that JSON
/// has no number for — those fall back to their text form so the value still reaches the screen.
fn score_to_json(score: f64) -> Value {
    serde_json::Number::from_f64(score)
        .map(Value::Number)
        .unwrap_or_else(|| Value::String(score.to_string()))
}

pub async fn key_value(
    conn: &mut ConnectionManager,
    key: &str,
    cursor: Option<&str>,
    count: i64,
) -> Result<KeyValuePage, AppError> {
    let count = count.max(1);
    let kind: String = redis::cmd("TYPE")
        .arg(key)
        .query_async(conn)
        .await
        .map_err(|e| err!("error.redis", message = e))?;
    let ttl: i64 = redis::cmd("TTL")
        .arg(key)
        .query_async(conn)
        .await
        .map_err(|e| err!("error.redis", message = e))?;

    let (total, items, next_cursor) = match kind.as_str() {
        "string" => {
            let raw: Option<Vec<u8>> = redis::cmd("GET")
                .arg(key)
                .query_async(conn)
                .await
                .map_err(|e| err!("error.redis", message = e))?;
            let items = raw
                .map(|bytes| vec![json!({ "value": to_text(&bytes) })])
                .unwrap_or_default();
            let total = items.len() as i64;
            (total, items, None)
        }
        "list" => {
            let total: i64 = redis::cmd("LLEN")
                .arg(key)
                .query_async(conn)
                .await
                .map_err(|e| err!("error.redis", message = e))?;
            let start: i64 = cursor.and_then(|c| c.parse().ok()).unwrap_or(0);
            let batch: Vec<Vec<u8>> = redis::cmd("LRANGE")
                .arg(key)
                .arg(start)
                .arg(start + count - 1)
                .query_async(conn)
                .await
                .map_err(|e| err!("error.redis", message = e))?;
            let next = start + batch.len() as i64;
            let items = batch
                .iter()
                .enumerate()
                .map(|(i, raw)| json!({ "index": start + i as i64, "value": to_text(raw) }))
                .collect();
            // An empty batch means the end, whatever LLEN said: the list may have been
            // trimmed between the two commands.
            let next_cursor = (!batch.is_empty() && next < total).then(|| next.to_string());
            (total, items, next_cursor)
        }
        "zset" => {
            let total: i64 = redis::cmd("ZCARD")
                .arg(key)
                .query_async(conn)
                .await
                .map_err(|e| err!("error.redis", message = e))?;
            let start: i64 = cursor.and_then(|c| c.parse().ok()).unwrap_or(0);
            let batch: Vec<(Vec<u8>, f64)> = redis::cmd("ZRANGE")
                .arg(key)
                .arg(start)
                .arg(start + count - 1)
                .arg("WITHSCORES")
                .query_async(conn)
                .await
                .map_err(|e| err!("error.redis", message = e))?;
            let next = start + batch.len() as i64;
            let items = batch
                .iter()
                .map(|(raw, score)| json!({ "value": to_text(raw), "score": score_to_json(*score) }))
                .collect();
            let next_cursor = (!batch.is_empty() && next < total).then(|| next.to_string());
            (total, items, next_cursor)
        }
        "set" => {
            let total: i64 = redis::cmd("SCARD")
                .arg(key)
                .query_async(conn)
                .await
                .map_err(|e| err!("error.redis", message = e))?;
            let mut cursor = cursor.unwrap_or("0").to_string();
            let mut items = Vec::new();
            for _ in 0..MAX_VALUE_SCAN_ROUNDS {
                let (next, batch): (String, Vec<Vec<u8>>) = redis::cmd("SSCAN")
                    .arg(key)
                    .arg(&cursor)
                    .arg("COUNT")
                    .arg(count)
                    .query_async(conn)
                    .await
                    .map_err(|e| err!("error.redis", message = e))?;
                items.extend(batch.iter().map(|raw| json!({ "value": to_text(raw) })));
                cursor = next;
                if cursor == "0" || items.len() as i64 >= count {
                    break;
                }
            }
            let next_cursor = (cursor != "0").then_some(cursor);
            (total, items, next_cursor)
        }
        "hash" => {
            let total: i64 = redis::cmd("HLEN")
                .arg(key)
                .query_async(conn)
                .await
                .map_err(|e| err!("error.redis", message = e))?;
            let mut cursor = cursor.unwrap_or("0").to_string();
            let mut items = Vec::new();
            for _ in 0..MAX_VALUE_SCAN_ROUNDS {
                // HSCAN hands back one flat array, field and value alternating.
                let (next, batch): (String, Vec<Vec<u8>>) = redis::cmd("HSCAN")
                    .arg(key)
                    .arg(&cursor)
                    .arg("COUNT")
                    .arg(count)
                    .query_async(conn)
                    .await
                    .map_err(|e| err!("error.redis", message = e))?;
                items.extend(batch.chunks(2).filter(|pair| pair.len() == 2).map(|pair| {
                    json!({ "field": to_text(&pair[0]), "value": to_text(&pair[1]) })
                }));
                cursor = next;
                if cursor == "0" || items.len() as i64 >= count {
                    break;
                }
            }
            let next_cursor = (cursor != "0").then_some(cursor);
            (total, items, next_cursor)
        }
        // `none` is a key that isn't there — deleted or expired since the list was scanned.
        // Anything else is a type this viewer has no reading for; both hand back nothing, and
        // the `kind` is what tells the front end which of the two it is looking at.
        _ => (-1, Vec::new(), None),
    };

    Ok(KeyValuePage {
        kind,
        ttl,
        total,
        items,
        next_cursor,
    })
}

/// Removes keys, and reports how many of them existed. `UNLINK` rather than `DEL`: reclaiming a
/// large collection's memory happens on a background thread instead of blocking the server.
/// Servers older than 4.0 don't have it, so a failure retries with `DEL`.
pub async fn delete_keys(
    conn: &mut ConnectionManager,
    keys: &[String],
) -> Result<i64, AppError> {
    if keys.is_empty() {
        return Ok(0);
    }
    let mut unlink = redis::cmd("UNLINK");
    for key in keys {
        unlink.arg(key);
    }
    if let Ok(removed) = unlink.query_async::<i64>(conn).await {
        return Ok(removed);
    }
    let mut del = redis::cmd("DEL");
    for key in keys {
        del.arg(key);
    }
    del.query_async(conn).await.map_err(|e| err!("error.redis", message = e))
}

/// Exercises the readers above against a scripted RESP server rather than a real Redis: what is
/// worth checking here is the shape each reply is taken apart into — a `SCAN` round's cursor and
/// its keys, `HSCAN`'s flat field/value array, a `WITHSCORES` pair list, the offsets a paged
/// list hands back — and none of that needs a database behind it.
#[cfg(test)]
mod tests {
    use super::*;

    /// The reply `INFO keyspace` actually gives, header and all.
    #[test]
    fn the_keyspace_reply_is_read_for_the_databases_it_names() {
        let reply = "# Keyspace\r\ndb0:keys=12,expires=1,avg_ttl=0\r\ndb3:keys=1,expires=0\r\n";
        let counts = keyspace_counts(reply);
        assert_eq!(counts.get(&0), Some(&12));
        assert_eq!(counts.get(&3), Some(&1));
        // Only what it named: every other index exists, it is simply empty, and that is the
        // list's business rather than this one's.
        assert_eq!(counts.len(), 2);

        // Nothing to read is not a failure — it is what an empty server answers.
        assert!(keyspace_counts("# Keyspace\r\n").is_empty());
        assert!(keyspace_counts("").is_empty());

        // A line that is not a database is skipped rather than guessed at.
        assert!(keyspace_counts("notadb:keys=1\ndbx:keys=1\ndb1\n").is_empty());

        // A database line with no `keys=` in it still counts as a database, with nothing in it.
        assert_eq!(keyspace_counts("db2:expires=0").get(&2), Some(&0));
    }

    /// The list the sidebar shows: every configured database, whether or not it holds anything.
    #[test]
    fn the_database_list_covers_the_count_and_anything_beyond_it_that_is_in_use() {
        let counts = HashMap::from([(0i64, 12i64), (3, 1)]);
        let list = databases(16, &counts);
        assert_eq!(list.len(), 16);
        assert_eq!(list[0].keys, 12);
        assert_eq!(list[1].keys, 0);
        assert_eq!(list[3].keys, 1);
        assert_eq!(list[15].index, 15);

        // The case the count came from the fallback: a server whose `CONFIG GET` is disabled but
        // which is really running 32 databases, with data in one of the upper ones. Dropping it
        // would hide the database the user is looking at.
        let counts = HashMap::from([(20i64, 5i64)]);
        let list = databases(16, &counts);
        assert_eq!(list.len(), 21);
        assert_eq!(list[20].keys, 5);

        // A server with nothing anywhere still lists its databases.
        assert_eq!(databases(16, &HashMap::new()).len(), 16);
    }

    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::{Arc, Mutex};
    use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
    use tokio::net::TcpListener;

    fn bulk(s: &str) -> String {
        format!("${}\r\n{}\r\n", s.len(), s)
    }

    fn int(n: i64) -> String {
        format!(":{n}\r\n")
    }

    fn simple(s: &str) -> String {
        format!("+{s}\r\n")
    }

    fn array(parts: &[String]) -> String {
        let mut out = format!("*{}\r\n", parts.len());
        for part in parts {
            out.push_str(part);
        }
        out
    }

    /// The bulk-string array a client sends. `None` at end of stream.
    async fn read_command(reader: &mut BufReader<tokio::net::TcpStream>) -> Option<Vec<String>> {
        let mut header = String::new();
        if reader.read_line(&mut header).await.ok()? == 0 {
            return None;
        }
        let count: usize = header.trim().strip_prefix('*')?.parse().ok()?;
        let mut args = Vec::with_capacity(count);
        for _ in 0..count {
            let mut len_line = String::new();
            reader.read_line(&mut len_line).await.ok()?;
            let len: usize = len_line.trim().strip_prefix('$')?.parse().ok()?;
            let mut buf = vec![0u8; len + 2]; // + the trailing CRLF
            reader.read_exact(&mut buf).await.ok()?;
            buf.truncate(len);
            args.push(String::from_utf8_lossy(&buf).to_string());
        }
        Some(args)
    }

    /// What every test server is: a listener, and one canned reply per command it receives.
    /// Commands the script has no answer for get `+OK` — that covers the handshake redis-rs
    /// performs on connect, which is not what any of these tests are about.
    ///
    /// Every connection is served, not just the first, and they all log into the same list:
    /// selecting a database opens a second connection, and what that one is handed at the
    /// handshake is the point of the test that does it.
    async fn serve<F>(script: F) -> (String, Arc<Mutex<Vec<Vec<String>>>>)
    where
        F: Fn(&[String]) -> Option<String> + Send + Sync + 'static,
    {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap().to_string();
        let received: Arc<Mutex<Vec<Vec<String>>>> = Arc::new(Mutex::new(Vec::new()));
        let log = Arc::clone(&received);
        let script = Arc::new(script);
        tokio::spawn(async move {
            while let Ok((stream, _)) = listener.accept().await {
                let log = Arc::clone(&log);
                let script = Arc::clone(&script);
                tokio::spawn(async move {
                    let mut reader = BufReader::new(stream);
                    while let Some(args) = read_command(&mut reader).await {
                        let reply = script(&args).unwrap_or_else(|| simple("OK"));
                        log.lock().unwrap().push(args);
                        if reader.get_mut().write_all(reply.as_bytes()).await.is_err() {
                            break;
                        }
                    }
                });
            }
        });
        (addr, received)
    }

    async fn open_connection(addr: &str) -> Connection {
        let (host, port) = addr.rsplit_once(':').unwrap();
        let info = connection_info(host, port.parse().unwrap(), None, None, 0).unwrap();
        open(info).await.unwrap()
    }

    async fn connect_to(addr: &str) -> ConnectionManager {
        open_connection(addr).await.manager
    }

    /// The command name as the dispatchers below match on it.
    fn name(args: &[String]) -> String {
        args.first().cloned().unwrap_or_default().to_uppercase()
    }

    #[tokio::test]
    async fn scan_keys_walks_until_it_has_a_full_page() {
        let round = AtomicUsize::new(0);
        let (addr, received) = serve(move |args| match name(args).as_str() {
            // Two rounds, and `b` comes back in both — SCAN is allowed to repeat a key, and the
            // page must not.
            "SCAN" => Some(match round.fetch_add(1, Ordering::SeqCst) {
                0 => array(&[bulk("5"), array(&[bulk("a"), bulk("b")])]),
                _ => array(&[bulk("0"), array(&[bulk("b"), bulk("c")])]),
            }),
            "TYPE" => Some(simple(match args[1].as_str() {
                "a" => "string",
                "b" => "list",
                _ => "hash",
            })),
            _ => None,
        })
        .await;

        let mut conn = connect_to(&addr).await;
        let page = scan_keys(&mut conn, "*", "0", 3).await.unwrap();

        assert_eq!(
            page.keys.iter().map(|k| k.name.as_str()).collect::<Vec<_>>(),
            ["a", "b", "c"],
        );
        assert_eq!(
            page.keys.iter().map(|k| k.kind.as_str()).collect::<Vec<_>>(),
            ["string", "list", "hash"],
        );
        assert!(page.done);
        assert_eq!(page.cursor, "0");

        // The second round has to resume from the first round's cursor, not start over.
        let scans: Vec<Vec<String>> = received
            .lock()
            .unwrap()
            .iter()
            .filter(|args| name(args) == "SCAN")
            .cloned()
            .collect();
        assert_eq!(scans[0][1], "0");
        assert_eq!(scans[1][1], "5");
    }

    #[tokio::test]
    async fn empty_pattern_scans_everything() {
        let (addr, received) = serve(|args| match name(args).as_str() {
            "SCAN" => Some(array(&[bulk("0"), array(&[])])),
            _ => None,
        })
        .await;

        let mut conn = connect_to(&addr).await;
        let page = scan_keys(&mut conn, "   ", "0", 10).await.unwrap();

        assert!(page.keys.is_empty());
        assert!(page.done);
        let scans = received.lock().unwrap();
        let scan = scans.iter().find(|args| name(args) == "SCAN").unwrap();
        assert_eq!(scan[3], "*");
    }

    #[tokio::test]
    async fn list_pages_by_offset() {
        let (addr, received) = serve(|args| match name(args).as_str() {
            "TYPE" => Some(simple("list")),
            "TTL" => Some(int(60)),
            "LLEN" => Some(int(10)),
            "LRANGE" => Some(array(&[bulk("f"), bulk("g"), bulk("h")])),
            _ => None,
        })
        .await;

        let mut conn = connect_to(&addr).await;
        let page = key_value(&mut conn, "k", Some("5"), 3).await.unwrap();

        assert_eq!(page.kind, "list");
        assert_eq!(page.ttl, 60);
        assert_eq!(page.total, 10);
        assert_eq!(page.items[0], json!({ "index": 5, "value": "f" }));
        assert_eq!(page.items[2], json!({ "index": 7, "value": "h" }));
        // Three items read from offset 5 leaves the next page starting at 8.
        assert_eq!(page.next_cursor.as_deref(), Some("8"));

        let commands = received.lock().unwrap();
        let lrange = commands.iter().find(|args| name(args) == "LRANGE").unwrap();
        assert_eq!(lrange[2..4], ["5".to_string(), "7".to_string()]);
    }

    #[tokio::test]
    async fn list_read_to_its_end_has_no_next_page() {
        let (addr, _) = serve(|args| match name(args).as_str() {
            "TYPE" => Some(simple("list")),
            "TTL" => Some(int(-1)),
            "LLEN" => Some(int(4)),
            "LRANGE" => Some(array(&[bulk("c"), bulk("d")])),
            _ => None,
        })
        .await;

        let mut conn = connect_to(&addr).await;
        let page = key_value(&mut conn, "k", Some("2"), 2).await.unwrap();

        assert_eq!(page.items.len(), 2);
        assert_eq!(page.next_cursor, None);
    }

    #[tokio::test]
    async fn hash_reads_the_flat_field_value_array() {
        let (addr, _) = serve(|args| match name(args).as_str() {
            "TYPE" => Some(simple("hash")),
            "TTL" => Some(int(-1)),
            "HLEN" => Some(int(2)),
            "HSCAN" => Some(array(&[
                bulk("0"),
                array(&[bulk("name"), bulk("ada"), bulk("role"), bulk("admin")]),
            ])),
            _ => None,
        })
        .await;

        let mut conn = connect_to(&addr).await;
        let page = key_value(&mut conn, "k", None, 10).await.unwrap();

        assert_eq!(page.total, 2);
        assert_eq!(page.items[0], json!({ "field": "name", "value": "ada" }));
        assert_eq!(page.items[1], json!({ "field": "role", "value": "admin" }));
        assert_eq!(page.next_cursor, None);
    }

    #[tokio::test]
    async fn set_hands_back_the_servers_cursor_when_more_remains() {
        let (addr, _) = serve(|args| match name(args).as_str() {
            "TYPE" => Some(simple("set")),
            "TTL" => Some(int(-1)),
            "SCARD" => Some(int(9)),
            "SSCAN" => Some(array(&[bulk("17"), array(&[bulk("x"), bulk("y")])])),
            _ => None,
        })
        .await;

        let mut conn = connect_to(&addr).await;
        let page = key_value(&mut conn, "k", None, 2).await.unwrap();

        assert_eq!(page.total, 9);
        assert_eq!(page.items[0], json!({ "value": "x" }));
        // A set is scanned, not indexed: the cursor handed back is the server's own.
        assert_eq!(page.next_cursor.as_deref(), Some("17"));
    }

    #[tokio::test]
    async fn zset_pairs_each_member_with_its_score() {
        let (addr, _) = serve(|args| match name(args).as_str() {
            "TYPE" => Some(simple("zset")),
            "TTL" => Some(int(-1)),
            "ZCARD" => Some(int(2)),
            "ZRANGE" => Some(array(&[bulk("low"), bulk("1.5"), bulk("high"), bulk("2")])),
            _ => None,
        })
        .await;

        let mut conn = connect_to(&addr).await;
        let page = key_value(&mut conn, "k", None, 10).await.unwrap();

        assert_eq!(page.items[0], json!({ "value": "low", "score": 1.5 }));
        assert_eq!(page.items[1], json!({ "value": "high", "score": 2.0 }));
        assert_eq!(page.next_cursor, None);
    }

    #[tokio::test]
    async fn a_missing_key_reports_itself_as_such() {
        let (addr, _) = serve(|args| match name(args).as_str() {
            "TYPE" => Some(simple("none")),
            "TTL" => Some(int(-2)),
            _ => None,
        })
        .await;

        let mut conn = connect_to(&addr).await;
        let page = key_value(&mut conn, "k", None, 10).await.unwrap();

        assert_eq!(page.kind, "none");
        assert_eq!(page.ttl, -2);
        assert!(page.items.is_empty());
    }

    #[tokio::test]
    async fn databases_are_listed_with_their_key_counts() {
        let (addr, _) = serve(|args| match name(args).as_str() {
            "CONFIG" => Some(array(&[bulk("databases"), bulk("4")])),
            "INFO" => Some(bulk(
                "# Keyspace\r\ndb0:keys=3,expires=0,avg_ttl=0\r\ndb2:keys=7,expires=1,avg_ttl=0\r\n",
            )),
            _ => None,
        })
        .await;

        let mut conn = connect_to(&addr).await;
        let dbs = list_databases(&mut conn).await.unwrap();

        assert_eq!(dbs.len(), 4);
        assert_eq!(dbs[0].keys, 3);
        // A database the keyspace never mentioned is empty, not absent.
        assert_eq!(dbs[1].keys, 0);
        assert_eq!(dbs[2].keys, 7);
    }

    #[tokio::test]
    async fn a_database_past_the_configured_count_is_still_listed() {
        let (addr, _) = serve(|args| match name(args).as_str() {
            "CONFIG" => Some("-ERR unknown command\r\n".to_string()),
            "INFO" => Some(bulk("# Keyspace\r\ndb20:keys=1,expires=0,avg_ttl=0\r\n")),
            _ => None,
        })
        .await;

        let mut conn = connect_to(&addr).await;
        let dbs = list_databases(&mut conn).await.unwrap();

        // CONFIG is off, so the count falls back to 16 — and db20, which plainly exists, would
        // otherwise be unreachable.
        assert_eq!(dbs.len(), 21);
        assert_eq!(dbs[20].keys, 1);
    }

    #[tokio::test]
    async fn deleting_falls_back_to_del_where_unlink_is_missing() {
        let (addr, received) = serve(|args| match name(args).as_str() {
            "UNLINK" => Some("-ERR unknown command 'UNLINK'\r\n".to_string()),
            "DEL" => Some(int(2)),
            _ => None,
        })
        .await;

        let mut conn = connect_to(&addr).await;
        let removed = delete_keys(&mut conn, &["a".to_string(), "b".to_string()])
            .await
            .unwrap();

        assert_eq!(removed, 2);
        let commands = received.lock().unwrap();
        assert!(commands.iter().any(|args| name(args) == "DEL"));
    }

    #[tokio::test]
    async fn server_info_reads_the_two_lines_the_header_shows() {
        let (addr, _) = serve(|args| match name(args).as_str() {
            "INFO" => Some(bulk(
                "# Server\r\nredis_version:7.2.4\r\nos:Linux 5.15.0 x86_64\r\nprocess_id:1\r\n",
            )),
            _ => None,
        })
        .await;

        let mut conn = connect_to(&addr).await;
        let info = server_info(&mut conn).await.unwrap();

        assert_eq!(info.version, "7.2.4");
        assert_eq!(info.os, "Linux 5.15.0 x86_64");
    }

    /// Selecting a database has to survive a reconnect, and the manager reconnects from the
    /// connection info it holds — so the database has to be part of that info rather than a
    /// `SELECT` sent by hand over the socket of the moment.
    #[tokio::test]
    async fn selecting_a_database_reopens_the_connection() {
        let (addr, received) = serve(|_| None).await;

        let mut conn = open_connection(&addr).await;
        select_db(&mut conn, 3).await.unwrap();

        let commands = received.lock().unwrap();
        assert!(commands
            .iter()
            .any(|args| name(args) == "SELECT" && args.get(1).map(String::as_str) == Some("3")));
    }
}
