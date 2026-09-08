//! A connection handed to MixDB by another program — MixEngine's `mix database open` — as a
//! `mixdb://connect?…` URL, with the password in one environment variable rather than in the URL.
//!
//! This module understands the URL and keeps the result until the tab opened for it asks. It never
//! touches the environment: `crate::launch` reads the variable, and takes it out, on the first line
//! of `run()`, before this or anything else has started. The contract both sides implement is
//! written up in `docs/superpowers/specs/2026-09-03-mixengine-connection-handoff-design.md`.

use std::collections::HashMap;
use std::sync::Mutex;

use serde::Serialize;

use super::models::{ConnectionConfig, DbKind};
use crate::error::AppError;

/// What the URL said, as a connection the form can hold and `connect_db` can dial.
///
/// `Debug` is derived because [`ConnectionConfig`]'s own is written by hand to redact the
/// password; the test at the bottom holds that line for this struct too.
#[derive(Debug, Clone, Serialize)]
pub struct Handoff {
    pub config: ConnectionConfig,
    /// The tab's name and the name pre-filled for saving — MixEngine's service id, `mariadb@main`.
    pub label: String,
    /// The key half of this account's address in MixEngine's keyring entry — `service="mixengine"`
    /// is a compile-time constant on the side that reads it and never travels on the wire (T84's
    /// D5). `Some` only when `secret` proved this process was actually started by MixEngine: a
    /// `mixdb://` link can name any `secret_key` it likes, but it cannot set an environment
    /// variable for the process it starts, so a value here without that proof would let a forged
    /// link get a saved connection pointed at an arbitrary MixEngine account.
    pub keyring_ref: Option<String>,
}

/// The environment variable `password_env` points at, when its name is one a launcher would use.
///
/// Trusted only inside the launcher's namespace — `MIX…_…PASSWORD`: `MIXENGINE_DB_PASSWORD`,
/// `MIXDB_PASSWORD`. Once the scheme is registered with the OS, any web page can produce a
/// `mixdb://` link naming any variable, and a name outside that namespace is how `$HOME` would
/// otherwise be sent to a stranger's server as a password. The check is on the *name*; whether the
/// variable exists is the caller's to find out. Nothing here reads the environment.
pub fn credential_name(url: &str) -> Option<String> {
    let parsed = url::Url::parse(url).ok()?;
    let name = first(&parsed, "password_env")?;
    if names_a_launcher_credential(&name) {
        Some(name)
    } else {
        eprintln!("mixdb: ignoring password_env={name}: not a launcher's credential variable");
        None
    }
}

/// `^MIX[A-Z0-9]*_[A-Z0-9_]*PASSWORD$`, spelled out rather than pulled in as a regex crate.
fn names_a_launcher_credential(name: &str) -> bool {
    let Some(middle) = name
        .strip_prefix("MIX")
        .and_then(|rest| rest.strip_suffix("PASSWORD"))
    else {
        return false;
    };
    middle.contains('_')
        && middle
            .chars()
            .all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || c == '_')
}

/// The URL, and the password read for it elsewhere, as a connection.
///
/// Pure: the environment and the app are both somebody else's. `secret` is whatever the caller
/// found under the variable [`credential_name`] named — `None` for a server with no accounts, and
/// for a URL that arrived any way other than on the command line of a fresh process.
pub fn parse(url: &str, secret: Option<String>) -> Result<Handoff, AppError> {
    let parsed = url::Url::parse(url).map_err(|e| invalid(format!("not a URL: {e}")))?;
    if parsed.scheme() != "mixdb" {
        return Err(invalid(format!(
            "the scheme is {}, not mixdb",
            parsed.scheme()
        )));
    }
    if parsed.host_str() != Some("connect") {
        return Err(invalid("only mixdb://connect is understood"));
    }

    let kind = match first(&parsed, "kind").as_deref() {
        Some("mysql") => DbKind::Mysql,
        Some("postgres") => DbKind::Postgres,
        Some("redis") => DbKind::Redis,
        // Same shape as the three above — host/port/user/database, no `uri` of its own — unlike
        // Mongo, which is why that kind is refused below rather than accepted here.
        Some("clickhouse") => DbKind::Clickhouse,
        /* Refused by name rather than by falling through, because the reason is not "not supported
           yet". `mixdb://` is registered with the operating system, so any web page can hand this
           process a URL; a `kind=sqlite&path=…` would be that page choosing which file on the
           user's disk MixDB opens. Nothing else here names a local path, which is what makes this
           kind the exception. */
        Some("sqlite") => {
            return Err(invalid(
                "kind `sqlite` names a file on this machine, and is not opened from a URL",
            ))
        }
        Some(other) => {
            return Err(invalid(format!(
                "kind `{other}` is not one MixDB opens this way"
            )))
        }
        None => return Err(invalid("kind is missing")),
    };
    let host = present(&parsed, "host").ok_or_else(|| invalid("host is missing"))?;
    let port = present(&parsed, "port").ok_or_else(|| invalid("port is missing"))?;
    let port = port
        .parse::<u16>()
        .ok()
        .filter(|port| *port != 0)
        .ok_or_else(|| invalid(format!("port `{port}` is not a TCP port")))?;
    let label = present(&parsed, "label").unwrap_or_else(|| format!("{host}:{port}"));
    // Only trusted alongside a `secret` that came from this process's own environment — see
    // `Handoff::keyring_ref`. Read before `secret` is moved into the config below.
    let keyring_ref = secret.is_some().then(|| present(&parsed, "secret_key")).flatten();

    Ok(Handoff {
        config: ConnectionConfig {
            kind,
            host,
            port,
            username: present(&parsed, "user"),
            password: secret,
            database: present(&parsed, "database"),
            uri: None,
            path: None,
            ssh: None,
            // "Try TLS, fall back to plaintext": right for MixEngine's loopback servers, which
            // speak none, and not wrong for a server that does.
            use_ssl: None,
        },
        label,
        keyring_ref,
    })
}

/// The first value under `key`, percent-decoded. A repeated key is the first one's.
fn first(url: &url::Url, key: &str) -> Option<String> {
    url.query_pairs()
        .find(|(name, _)| name == key)
        .map(|(_, value)| value.into_owned())
}

/// [`first`], with an empty value counting as absent.
fn present(url: &url::Url, key: &str) -> Option<String> {
    first(url, key).filter(|value| !value.is_empty())
}

fn invalid(message: impl std::fmt::Display) -> AppError {
    err!("error.handoffInvalid", message = message)
}

/// Handoffs accepted and not yet opened, by the id the tab was told.
///
/// The one place a handed-over password sits in memory on this side other than the
/// `ConnectionConfig` on its way through `connect_db`. Each entry leaves on the first `take`:
/// a tab restored from an old session with an old id finds nothing, and shows an empty form.
#[derive(Default)]
pub struct HandoffState {
    pending: Mutex<HashMap<String, Handoff>>,
}

impl HandoffState {
    /// Keeps `handoff` and answers the id a tab can take it back with.
    pub fn keep(&self, handoff: Handoff) -> String {
        let id = uuid::Uuid::new_v4().to_string();
        self.pending
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .insert(id.clone(), handoff);
        id
    }

    /// The handoff under `id`, removed — or `None` when it was never there or already taken.
    pub fn take(&self, id: &str) -> Option<Handoff> {
        self.pending
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .remove(id)
    }
}

/// A URL that arrived — on the command line, over the channel from a second copy, or from the OS —
/// turned into a pending handoff and a tab for it. Called by `crate::launch`, which is the one
/// place a URL is matched to a module.
pub fn accept<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    url: &str,
    secret: Option<String>,
) -> Result<(), AppError> {
    use tauri::Manager;

    let handoff = parse(url, secret)?;
    let id = app.state::<HandoffState>().keep(handoff);
    crate::launch::request(
        app,
        crate::launch::TabRequest {
            module_id: "db",
            state: serde_json::json!({ "handoffId": id }),
        },
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    const FULL: &str = "mixdb://connect?kind=mysql&host=127.0.0.1&port=3306&user=blog&database=blog\
                        &label=mariadb%40main&password_env=MIXENGINE_DB_PASSWORD\
                        &secret_key=mariadb%40main%2Fblog";

    /// The whole shape, every optional part present, the label decoded, and — because `secret`
    /// proves this process was started by MixEngine — the keyring reference carried too.
    #[test]
    fn a_full_url_reads_as_a_connection() {
        let handoff = parse(FULL, Some("s3cret".to_string())).unwrap();
        assert_eq!(handoff.config.kind, DbKind::Mysql);
        assert_eq!(handoff.config.host, "127.0.0.1");
        assert_eq!(handoff.config.port, 3306);
        assert_eq!(handoff.config.username.as_deref(), Some("blog"));
        assert_eq!(handoff.config.password.as_deref(), Some("s3cret"));
        assert_eq!(handoff.config.database.as_deref(), Some("blog"));
        assert_eq!(handoff.config.uri, None);
        assert!(handoff.config.ssh.is_none());
        assert_eq!(handoff.config.use_ssl, None);
        assert_eq!(handoff.label, "mariadb@main");
        assert_eq!(handoff.keyring_ref.as_deref(), Some("mariadb@main/blog"));
    }

    /// A `secret_key` with no `secret` behind it names nothing: this is what a `mixdb://` link
    /// clicked from a browser looks like, and it must not be able to point a saved connection at
    /// an arbitrary MixEngine account just by naming one in the URL.
    #[test]
    fn a_secret_key_without_a_proven_secret_is_not_a_keyring_ref() {
        let handoff = parse(FULL, None).unwrap();
        assert_eq!(handoff.config.password, None);
        assert_eq!(handoff.keyring_ref, None);
    }

    /// A server with no accounts hands over an address and a label and nothing else.
    #[test]
    fn a_redis_url_names_no_account() {
        let handoff = parse(
            "mixdb://connect?kind=redis&host=127.0.0.1&port=6379&label=redis%40main",
            None,
        )
        .unwrap();
        assert_eq!(handoff.config.kind, DbKind::Redis);
        assert_eq!(handoff.config.username, None);
        assert_eq!(handoff.config.password, None);
        assert_eq!(handoff.config.database, None);
        assert_eq!(handoff.label, "redis@main");
    }

    /// ClickHouse is a server with an account, same as MySQL and PostgreSQL — unlike Redis, which
    /// carries no username at all.
    #[test]
    fn a_clickhouse_url_reads_as_a_connection() {
        let handoff = parse(
            "mixdb://connect?kind=clickhouse&host=127.0.0.1&port=8123&user=admin&database=analytics\
             &label=clickhouse%40main",
            Some("s3cret".to_string()),
        )
        .unwrap();
        assert_eq!(handoff.config.kind, DbKind::Clickhouse);
        assert_eq!(handoff.config.username.as_deref(), Some("admin"));
        assert_eq!(handoff.config.password.as_deref(), Some("s3cret"));
        assert_eq!(handoff.config.database.as_deref(), Some("analytics"));
        assert_eq!(handoff.label, "clickhouse@main");
    }

    #[test]
    fn a_missing_label_is_the_address() {
        let handoff = parse("mixdb://connect?kind=postgres&host=db.local&port=5432", None).unwrap();
        assert_eq!(handoff.label, "db.local:5432");
    }

    /// Everything that is not a connection MixDB can open, each refused by name.
    #[test]
    fn what_cannot_be_opened_is_refused() {
        for url in [
            "not a url",
            "https://connect?kind=mysql&host=h&port=1",
            "mixdb://open?kind=mysql&host=h&port=1",
            "mixdb://connect?host=h&port=1",
            "mixdb://connect?kind=mongo&host=h&port=1",
            "mixdb://connect?kind=mysql&port=1",
            "mixdb://connect?kind=mysql&host=&port=1",
            "mixdb://connect?kind=mysql&host=h",
            "mixdb://connect?kind=mysql&host=h&port=0",
            "mixdb://connect?kind=mysql&host=h&port=70000",
            "mixdb://connect?kind=mysql&host=h&port=abc",
            // Refused whether or not it is well formed, and whether or not a path is offered: a
            // URL is not allowed to choose a file on this machine. See the arm in `parse`.
            "mixdb://connect?kind=sqlite&host=h&port=1",
            "mixdb://connect?kind=sqlite&path=C:%5CUsers%5Csomeone%5Cblog.db",
        ] {
            let error = parse(url, None).expect_err(url);
            assert_eq!(error.code, "error.handoffInvalid", "{url}");
            assert!(error.params.contains_key("message"), "{url}");
        }
    }

    /// The variable named by the URL is trusted only inside the launcher's own namespace: a link
    /// on a web page can name any variable it likes, and this is what keeps `$HOME` from being
    /// sent to a stranger's server as a password.
    #[test]
    fn only_a_launcher_credential_variable_is_named() {
        let named =
            |name: &str| credential_name(&format!("mixdb://connect?kind=redis&password_env={name}"));
        assert_eq!(
            named("MIXENGINE_DB_PASSWORD").as_deref(),
            Some("MIXENGINE_DB_PASSWORD")
        );
        assert_eq!(named("MIXDB_PASSWORD").as_deref(), Some("MIXDB_PASSWORD"));
        assert_eq!(named("MIX_PASSWORD").as_deref(), Some("MIX_PASSWORD"));
        for refused in [
            "PATH",
            "HOME",
            "DB_PASSWORD",
            "PGPASSWORD",
            "MIXPASSWORD",
            "mixengine_db_password",
            "MIXENGINE_DB_PASSWORD_",
            "",
        ] {
            assert_eq!(named(refused), None, "{refused}");
        }
        assert_eq!(credential_name("mixdb://connect?kind=redis"), None);
        assert_eq!(credential_name("not a url"), None);
    }

    /// The name is read off a URL that would not parse as a connection: the variable has to be
    /// taken out of the environment whether or not the rest of the URL is any good.
    #[test]
    fn the_credential_name_survives_a_broken_url() {
        assert_eq!(
            credential_name("mixdb://connect?password_env=MIXENGINE_DB_PASSWORD").as_deref(),
            Some("MIXENGINE_DB_PASSWORD")
        );
    }

    #[test]
    fn a_handoff_never_prints_its_password() {
        let handoff = parse(FULL, Some("hunter2".to_string())).unwrap();
        let printed = format!("{handoff:?}");
        assert!(!printed.contains("hunter2"), "{printed}");
        assert!(printed.contains("mariadb@main"));
    }

    /// The pending store hands each handoff out once.
    #[test]
    fn a_kept_handoff_is_taken_once() {
        let state = HandoffState::default();
        let id = state.keep(parse(FULL, None).unwrap());
        assert!(!id.is_empty());
        assert_eq!(
            state.take(&id).map(|h| h.label).as_deref(),
            Some("mariadb@main")
        );
        assert!(state.take(&id).is_none());
        assert!(state.take("nothing").is_none());
    }
}
