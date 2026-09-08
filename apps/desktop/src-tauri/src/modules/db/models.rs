use crate::secrets::Redacted;
use crate::ssh::SshConfig;
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum DbKind {
    Mysql,
    Postgres,
    Mongo,
    Redis,
    Sqlite,
    Clickhouse,
    Mssql,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct ConnectionConfig {
    pub kind: DbKind,
    pub host: String,
    pub port: u16,
    pub username: Option<String>,
    pub password: Option<String>,
    /// Database name (MySQL/PostgreSQL/Mongo) or numeric DB index as string (Redis).
    ///
    /// PostgreSQL is the one kind this is not merely a starting point for: a connection there is
    /// bound to one database and cannot see into another, so browsing a second one opens a second
    /// pool rather than switching this. Left empty, `postgres` is dialed.
    pub database: Option<String>,
    /// MongoDB only, and the only endpoint it uses: a full `mongodb://` / `mongodb+srv://`
    /// connection string, which carries host, port, credentials and options in one value —
    /// so `host`/`port`/`username`/`password` are ignored for that kind.
    pub uri: Option<String>,
    /// SQLite only, and its whole address: the path of the database file on this machine. There is
    /// no server, so `host`, `port`, `username`, `password`, `ssh` and `use_ssl` are all ignored
    /// for that kind — the same way `uri` above replaces them for MongoDB.
    pub path: Option<String>,
    pub ssh: Option<SshConfig>,
    /// MySQL and PostgreSQL. `None`/`Some(true)` tries SSL and falls back to plaintext
    /// if the server doesn't advertise it; `Some(false)` skips SSL entirely
    /// (useful when already tunneled over SSH, or against servers with SSL
    /// configs too old for any modern TLS backend to negotiate).
    pub use_ssl: Option<bool>,
}

/// Written out rather than derived, so that a password cannot reach a log line, an error message
/// or a panic backtrace by accident.
///
/// Nothing prints a `ConnectionConfig` today. That is the point: the cost of keeping it that way
/// by discipline is that every future `{config:?}` has to be caught in review by someone who
/// remembers this struct has a password in it, and one that is not caught leaves no trace of
/// having gone wrong.
impl std::fmt::Debug for ConnectionConfig {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ConnectionConfig")
            .field("kind", &self.kind)
            .field("host", &self.host)
            .field("port", &self.port)
            .field("username", &self.username)
            .field("password", &self.password.as_ref().map(|_| Redacted))
            .field("database", &self.database)
            /* All of it, not just the credentials in it: masking part of a URI means parsing one,
               and a parser that is slightly wrong here prints exactly what it was written to
               hide. What is lost is the host, which `host` above already carries. */
            .field("uri", &self.uri.as_ref().map(|_| Redacted))
            /* Printed in full, unlike `uri`: a file path is a name, not a credential. */
            .field("path", &self.path)
            .field("ssh", &self.ssh)
            .field("use_ssl", &self.use_ssl)
            .finish()
    }
}

/// What the header shows about a server: its version, and the machine it runs on.
///
/// One struct for all four drivers, which each declared their own. They differ only in how the
/// two strings are found — a MySQL variable, a Mongo `buildInfo`, a Redis `INFO` section — and
/// that difference belongs to the four `server_info` functions, not to the shape they return.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerInfo {
    pub version: String,
    pub os: String,
}

/// What one statement of a script did.
///
/// Shared by the MySQL and PostgreSQL runners, which reported the same nine fields separately. The
/// two fields that mean different things per server say so here rather than in two copies of the
/// struct — the frontend reads one shape whichever server answered.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatementResult {
    /// The statement this came from, as the user wrote it.
    pub statement: String,
    pub verb: String,
    /// How the result is to be read: `rows` for a result set, `affected` for a write that changed
    /// rows, `ok` for a statement whose only outcome is that it succeeded.
    pub kind: String,
    pub columns: Vec<String>,
    pub rows: Vec<Vec<Value>>,
    /// Set when the result set was longer than the runner's cap and the rest was left unread.
    pub truncated: bool,
    pub rows_affected: u64,
    /// The AUTO_INCREMENT value the statement generated, when it generated one.
    ///
    /// Always `None` from PostgreSQL, which has no per-statement generated key to report: a
    /// sequence is asked for `currval()` by name, and an `INSERT` that wants its new row back says
    /// `RETURNING`.
    pub last_insert_id: Option<u64>,
    pub duration_ms: u64,
    pub error: Option<String>,
}

/// Something wrong with a statement, as the checker found it.
///
/// Also shared by the two runners. `number` is MySQL's alone — PostgreSQL identifies an error by a
/// five-character SQLSTATE — but the field stays rather than becoming an enum: the editor draws
/// one squiggle per problem whichever server reported it, and a shape that changed per server
/// would put the difference in the frontend instead of leaving it here.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SqlProblem {
    /// The server's own words, untranslated — rewording them would only make them harder to
    /// search for.
    pub message: String,
    /// MySQL's error number, e.g. 1064 for a syntax error. Zero when the failure carried none, and
    /// always zero from PostgreSQL.
    pub number: u16,
    /// The 1-based line *within the statement* the server pointed at, when it pointed at one.
    /// PostgreSQL gives a character offset instead, which its runner counts back into a line.
    pub line: Option<u32>,
    /// `error` for text the server cannot parse at all; `warning` for everything else, which is
    /// anything that might only be wrong from where the check is standing.
    pub severity: String,
}

#[cfg(test)]
mod tests {
    use super::{ConnectionConfig, DbKind};
    use crate::ssh::{SshAuth, SshConfig};

    /// Every secret a connection can carry, and none of them in the `Debug` line.
    ///
    /// The check is on the rendered string rather than on the impl, because what matters is not
    /// which fields were listed — it is that nothing anywhere in the output is the password. That
    /// covers `SshConfig`, whose own `Debug` is derived, and it will still cover a field added
    /// later that someone forgets to redact.
    #[test]
    fn a_connection_never_prints_what_it_knows() {
        let config = ConnectionConfig {
            kind: DbKind::Mysql,
            host: "db.example".to_string(),
            port: 3306,
            username: Some("root".to_string()),
            password: Some("hunter2".to_string()),
            database: Some("shop".to_string()),
            uri: Some("mongodb://root:swordfish@db.example/shop".to_string()),
            path: Some("C:/db/shop.sqlite".to_string()),
            ssh: Some(SshConfig {
                host: "jump.example".to_string(),
                port: 22,
                username: "deploy".to_string(),
                auth: SshAuth::Password { password: "correcthorse".to_string() },
            }),
            use_ssl: Some(true),
        };

        let printed = format!("{config:?}");
        for secret in ["hunter2", "swordfish", "correcthorse"] {
            assert!(!printed.contains(secret), "{secret} leaked: {printed}");
        }
        // Still worth reading: which server, which user, and that there was a password at all.
        assert!(printed.contains("db.example"));
        assert!(printed.contains("root"));
        assert!(printed.contains("Some(\"***\")"));

        // A passphrase on a key file goes the same way, and the path does not.
        let key = SshAuth::PrivateKey {
            key_path: "/home/me/.ssh/id_ed25519".to_string(),
            passphrase: Some("let me in".to_string()),
        };
        let printed = format!("{key:?}");
        assert!(!printed.contains("let me in"), "{printed}");
        assert!(printed.contains("id_ed25519"), "{printed}");
    }
}
