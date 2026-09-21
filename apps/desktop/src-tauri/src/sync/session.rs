//! Signed in or not: the account on this machine, held for the run and kept between runs.
//!
//! **One lock over everything that changes the session, held across a refresh on purpose**: a
//! refresh token rotates on use, and two refreshes racing with one token revoke the device's whole
//! chain (`docs/features/sync-protocol.md`, Tokens). Everything else takes a snapshot and lets go.
//!
//! **What a module writes is held here until it has written it.** A pulled page, or a lost
//! conflict's winners, leaves as a token and plain items; only when the shell hands the token back
//! are versions and hashes recorded and the cursor moved (D4, and `lend`'s module comment).

use std::collections::HashMap;
use std::future::Future;
use std::path::PathBuf;
use std::sync::Arc;

use base64::engine::general_purpose::STANDARD;
use base64::Engine as _;
use serde::Serialize;
use tokio::sync::Mutex;
use zeroize::{Zeroize, ZeroizeOnDrop};

use super::account::{Account, Argon, Device, Registration};
use super::crypto;
use super::engine::{self, Fetched};
use super::lend::{self, Agreement, Incoming, Item, Keys};
use super::saved::{Keeping, Saved};
use super::store::Store;
use super::transport::Transport;
use super::wire::{Capabilities, WireRecord};
use crate::error::AppError;
use crate::platform::in_background;

/// Refresh this long before the access token lapses, so no request leaves with a token that dies
/// on the way.
const RENEW_BEFORE: i64 = 60;

/// What the account screen draws from.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub signed_in: bool,
    pub server: Option<String>,
    pub email: Option<String>,
    pub device_id: Option<String>,
    /// The address a code was sent to, while registration waits for it.
    pub verifying: Option<String>,
}

/// A page for a module to write. `token` comes back with `commit_pull` once it has.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PulledPage {
    pub token: String,
    pub changes: Incoming,
    pub more: bool,
}

/// What a push did. `replaced` is this machine's edits that lost to newer ones: the module writes
/// them and hands `token` back with `commit_push`. No token, nothing to write.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PushedChanges {
    pub accepted: usize,
    pub replaced: Incoming,
    pub token: Option<String>,
}

#[derive(Clone, Copy, PartialEq, Eq, Hash)]
enum Kind {
    Pull,
    Push,
}

/// Records handed to a module, waiting for it to say it wrote them.
struct Held {
    token: String,
    records: Vec<WireRecord>,
    agreements: Vec<Agreement>,
    /// A pulled page's cursor; `None` for a lost conflict's winners, which move no cursor.
    fetched: Option<Fetched>,
}

/// Registration between its first step and its last: `A` to sign in with, and `MK`, which was
/// made here and needs no unwrapping.
#[derive(Zeroize, ZeroizeOnDrop)]
struct Registering {
    server: String,
    access: Option<String>,
    email: String,
    a: [u8; 32],
    master: [u8; 32],
}

/// One signed-in session: a snapshot, replaced whole when the tokens are refreshed.
struct Session {
    keys: Keys,
    device_id: String,
    access_token: String,
    transport: Transport,
    account: Account,
    store: Arc<Store>,
    limits: Capabilities,
    expires_at: i64,
}

#[derive(Default)]
struct Inner {
    loaded: bool,
    saved: Option<Saved>,
    session: Option<Arc<Session>>,
    store: Option<Arc<Store>>,
    registering: Option<Registering>,
    held: HashMap<(Kind, String), Held>,
}

pub struct SyncState {
    keeping: Arc<dyn Keeping>,
    store_path: Result<PathBuf, AppError>,
    inner: Mutex<Inner>,
}

fn now() -> i64 {
    chrono::Utc::now().timestamp()
}

fn token() -> String {
    uuid::Uuid::new_v4().simple().to_string()
}

fn decode(text: &str) -> Result<Vec<u8>, AppError> {
    STANDARD
        .decode(text)
        .map_err(|_| err!("error.syncServerAnswerUnreadable"))
}

impl SyncState {
    pub fn new(keeping: Arc<dyn Keeping>, store_path: Result<PathBuf, AppError>) -> Self {
        Self {
            keeping,
            store_path,
            inner: Mutex::new(Inner::default()),
        }
    }

    /// What the credential store kept, read once per run.
    async fn load(&self, inner: &mut Inner) -> Result<(), AppError> {
        if !inner.loaded {
            let keeping = self.keeping.clone();
            inner.saved = in_background(move || keeping.load()).await?;
            inner.loaded = true;
        }
        Ok(())
    }

    async fn keep(&self, saved: &Saved) -> Result<(), AppError> {
        let (keeping, saved) = (self.keeping.clone(), saved.clone());
        in_background(move || keeping.keep(&saved)).await
    }

    pub async fn status(&self) -> Result<Status, AppError> {
        let mut inner = self.inner.lock().await;
        self.load(&mut inner).await?;
        let saved = inner.saved.as_ref();
        Ok(Status {
            signed_in: saved.is_some(),
            server: saved.map(|saved| saved.server.clone()),
            email: saved.map(|saved| saved.email.clone()),
            device_id: saved.map(|saved| saved.device_id.clone()),
            verifying: inner
                .registering
                .as_ref()
                .map(|registering| registering.email.clone()),
        })
    }

    /// Make the account and send the letter. Returns the recovery key, formatted, to be shown once.
    pub async fn register(
        &self,
        server: &str,
        access: Option<&str>,
        email: &str,
        mut password: String,
    ) -> Result<String, AppError> {
        let salt: [u8; 16] = rand::random();
        let keys = in_background(move || {
            let keys = crypto::derive_password_keys(&password, &salt);
            password.zeroize();
            keys
        })
        .await?;
        let master = crypto::new_master_key();
        let mut recovery = crypto::new_recovery_key();
        let registration = Registration {
            email: email.to_owned(),
            a: STANDARD.encode(keys.auth),
            salt_account: STANDARD.encode(salt),
            argon: Argon::ours(),
            wrapped_mk_password: STANDARD.encode(crypto::wrap_master_key(&keys.wrap, &master)?),
            wrapped_mk_recovery: STANDARD.encode(crypto::wrap_master_key(
                &crypto::recovery_wrapping_key(&recovery),
                &master,
            )?),
        };
        Account::new(server, access)?
            .register(&registration)
            .await?;
        let shown = crypto::format_recovery_key(&recovery);
        recovery.zeroize();
        self.inner.lock().await.registering = Some(Registering {
            server: server.to_owned(),
            access: access.map(str::to_owned),
            email: email.to_owned(),
            a: keys.auth,
            master,
        });
        Ok(shown)
    }

    /// Spend the letter's code, then sign in as the account's first device. A wrong code leaves
    /// the registration waiting, so the person can type it again.
    pub async fn verify(&self, code: &str, device_name: &str) -> Result<Status, AppError> {
        {
            let mut inner = self.inner.lock().await;
            let registering = inner
                .registering
                .as_ref()
                .ok_or_else(|| err!("error.syncNothingToVerify"))?;
            let account = Account::new(&registering.server, registering.access.as_deref())?;
            account.verify(&registering.email, code).await?;
            let signed_in = account
                .login(&registering.email, &registering.a, device_name)
                .await?;
            let saved = Saved {
                server: registering.server.clone(),
                access: registering.access.clone(),
                email: registering.email.clone(),
                device_id: signed_in.device_id.clone(),
                refresh_token: signed_in.refresh_token.clone(),
                master_key: STANDARD.encode(registering.master),
            };
            inner.registering = None;
            self.begin(
                &mut inner,
                saved,
                signed_in.access_token.clone(),
                signed_in.expires_in,
            )
            .await?;
        }
        self.status().await
    }

    /// Sign in on a machine that has only the address and the password (D2): ask for the salt,
    /// derive `A`, and unwrap `MK` from what signing in hands back.
    pub async fn login(
        &self,
        server: &str,
        access: Option<&str>,
        email: &str,
        mut password: String,
        device_name: &str,
    ) -> Result<Status, AppError> {
        let account = Account::new(server, access)?;
        let params = account.params(email).await?;
        if params.argon != Argon::ours() {
            return Err(err!("error.syncArgonUnsupported"));
        }
        let salt = decode(&params.salt_account)?;
        let keys = in_background(move || {
            let keys = crypto::derive_password_keys(&password, &salt);
            password.zeroize();
            keys
        })
        .await?;
        let signed_in = account.login(email, &keys.auth, device_name).await?;
        let mut master =
            crypto::unwrap_master_key(&keys.wrap, &decode(&signed_in.wrapped_mk_password)?)?;
        let saved = Saved {
            server: server.to_owned(),
            access: access.map(str::to_owned),
            email: email.to_owned(),
            device_id: signed_in.device_id.clone(),
            refresh_token: signed_in.refresh_token.clone(),
            master_key: STANDARD.encode(master),
        };
        master.zeroize();
        {
            let mut inner = self.inner.lock().await;
            self.begin(
                &mut inner,
                saved,
                signed_in.access_token.clone(),
                signed_in.expires_in,
            )
            .await?;
        }
        self.status().await
    }

    /// Keep what a sign-in produced, and make it the session. Anything held from before is
    /// dropped: it was read under another session.
    async fn begin(
        &self,
        inner: &mut Inner,
        saved: Saved,
        access_token: String,
        expires_in: i64,
    ) -> Result<(), AppError> {
        self.keep(&saved).await?;
        inner.loaded = true;
        inner.held.clear();
        inner.store = None;
        let session = self.open(inner, &saved, access_token, expires_in).await?;
        inner.session = Some(Arc::new(session));
        inner.saved = Some(saved);
        Ok(())
    }

    /// A session over `saved` with a fresh access token, and what the server allows today.
    async fn open(
        &self,
        inner: &mut Inner,
        saved: &Saved,
        access_token: String,
        expires_in: i64,
    ) -> Result<Session, AppError> {
        let store = match &inner.store {
            Some(store) => store.clone(),
            None => {
                let path = self.store_path.clone()?;
                if let Some(dir) = path.parent() {
                    std::fs::create_dir_all(dir)
                        .map_err(|e| err!("error.syncStoreFailed", message = e))?;
                }
                let store = Arc::new(Store::open(&path, &saved.server).await?);
                inner.store = Some(store.clone());
                store
            }
        };
        let mut master = saved.master_key_bytes()?;
        let keys = Keys {
            id: crypto::id_key(&master),
            data: crypto::data_key(&master),
        };
        master.zeroize();
        let transport = Transport::new(&saved.server, &access_token, saved.access.as_deref())?;
        let limits = transport.capabilities().await?;
        Ok(Session {
            keys,
            device_id: saved.device_id.clone(),
            access_token,
            transport,
            account: Account::new(&saved.server, saved.access.as_deref())?,
            store,
            limits,
            expires_at: now() + expires_in,
        })
    }

    /// Everything forgotten, here and in the credential store.
    async fn end(&self, inner: &mut Inner) -> Result<(), AppError> {
        inner.saved = None;
        inner.session = None;
        inner.store = None;
        inner.held.clear();
        let keeping = self.keeping.clone();
        in_background(move || keeping.forget()).await
    }

    /// The session, refreshed first when its access token is about to lapse — or, given `stale`,
    /// because a request just said that token had already died. A refresh the server refuses
    /// means this machine was signed out elsewhere, and it forgets everything.
    async fn session(&self, stale: Option<&Arc<Session>>) -> Result<Arc<Session>, AppError> {
        let mut inner = self.inner.lock().await;
        self.load(&mut inner).await?;
        if let Some(current) = &inner.session {
            let renewed_meanwhile = stale.is_some_and(|stale| !Arc::ptr_eq(stale, current));
            let fresh = stale.is_none() && now() + RENEW_BEFORE < current.expires_at;
            if renewed_meanwhile || fresh {
                return Ok(current.clone());
            }
        }
        let Some(mut saved) = inner.saved.clone() else {
            return Err(err!("error.syncNotSignedIn"));
        };
        let account = Account::new(&saved.server, saved.access.as_deref())?;
        let refreshed = match account.refresh(&saved.refresh_token).await {
            Ok(refreshed) => refreshed,
            Err(error) => {
                if error.code == "error.syncSignedOut" {
                    self.end(&mut inner).await?;
                }
                return Err(error);
            }
        };
        // The old token is spent the moment the answer arrives: memory first, then the store.
        saved.refresh_token = refreshed.refresh_token.clone();
        inner.saved = Some(saved.clone());
        self.keep(&saved).await?;
        let session = Arc::new(
            self.open(
                &mut inner,
                &saved,
                refreshed.access_token.clone(),
                refreshed.expires_in,
            )
            .await?,
        );
        inner.session = Some(session.clone());
        Ok(session)
    }

    /// `call` against the session, and once more after a refresh if the token died on the way.
    async fn with_session<T, F, Fut>(&self, call: F) -> Result<T, AppError>
    where
        F: Fn(Arc<Session>) -> Fut,
        Fut: Future<Output = Result<T, AppError>>,
    {
        let session = self.session(None).await?;
        match call(session.clone()).await {
            Err(error) if error.code == "error.syncSignedOut" => {
                call(self.session(Some(&session)).await?).await
            }
            other => other,
        }
    }

    /// Sign out: this device revoked on the server if it can be reached, and everything here
    /// forgotten whether or not it could — the device list on another machine is where a leftover
    /// is cut off.
    pub async fn logout(&self) -> Result<(), AppError> {
        let mut inner = self.inner.lock().await;
        self.load(&mut inner).await?;
        if let Some(session) = inner.session.clone() {
            let _ = session
                .account
                .revoke(&session.access_token, &session.device_id)
                .await;
        }
        self.end(&mut inner).await
    }

    pub async fn devices(&self) -> Result<Vec<Device>, AppError> {
        self.with_session(
            |session| async move { session.account.devices(&session.access_token).await },
        )
        .await
    }

    /// Cut a device off. This machine's own is signing out.
    pub async fn revoke(&self, id: &str) -> Result<(), AppError> {
        if self.session(None).await?.device_id == id {
            return self.logout().await;
        }
        let id = id.to_owned();
        self.with_session(|session| {
            let id = id.clone();
            async move { session.account.revoke(&session.access_token, &id).await }
        })
        .await
    }

    /// The next page of `collection`, opened, for its module to write.
    pub async fn pull_page(&self, collection: &str) -> Result<PulledPage, AppError> {
        let name = collection.to_owned();
        let (fetched, changes, agreements) = self
            .with_session(|session| {
                let name = name.clone();
                async move {
                    let opaque = crypto::opaque_id(&session.keys.id, &name);
                    let fetched =
                        engine::fetch(&session.transport, &session.store, &opaque).await?;
                    let (changes, agreements) =
                        lend::incoming(&session.store, &session.keys, &name, &fetched.records)
                            .await?;
                    // Named: an async block that uses `?` cannot infer its error type.
                    Ok::<_, AppError>((fetched, changes, agreements))
                }
            })
            .await?;
        let token = token();
        let more = fetched.more;
        self.inner.lock().await.held.insert(
            (Kind::Pull, name),
            Held {
                token: token.clone(),
                records: fetched.records.clone(),
                agreements,
                fetched: Some(fetched),
            },
        );
        Ok(PulledPage {
            token,
            changes,
            more,
        })
    }

    /// This machine's items for `collection`, pushed as whatever changed since they were last
    /// agreed. A lost conflict comes back as `replaced`, held for the module to write.
    pub async fn push(
        &self,
        collection: &str,
        items: Vec<Item>,
    ) -> Result<PushedChanges, AppError> {
        let name = collection.to_owned();
        let items = Arc::new(items);
        let (accepted, replaced, records, agreements) = self
            .with_session(|session| {
                let (name, items) = (name.clone(), items.clone());
                async move {
                    let (changes, agreed) =
                        lend::outgoing(&session.store, &session.keys, &name, &items, now()).await?;
                    if changes.is_empty() {
                        return Ok::<_, AppError>((0, Incoming::default(), Vec::new(), Vec::new()));
                    }
                    let pushed = engine::push(
                        &session.transport,
                        &session.store,
                        &session.limits,
                        &session.device_id,
                        changes,
                    )
                    .await?;
                    lend::settle_pushed(&session.store, &session.keys, &name, agreed, &pushed)
                        .await?;
                    let (replaced, agreements) =
                        lend::incoming(&session.store, &session.keys, &name, &pushed.superseded)
                            .await?;
                    Ok((pushed.accepted, replaced, pushed.superseded, agreements))
                }
            })
            .await?;
        let token = if records.is_empty() {
            None
        } else {
            let token = token();
            self.inner.lock().await.held.insert(
                (Kind::Push, name),
                Held {
                    token: token.clone(),
                    records,
                    agreements,
                    fetched: None,
                },
            );
            Some(token)
        };
        Ok(PushedChanges {
            accepted,
            replaced,
            token,
        })
    }

    pub async fn commit_pull(&self, collection: &str, token: &str) -> Result<(), AppError> {
        self.commit(Kind::Pull, collection, token).await
    }

    pub async fn commit_push(&self, collection: &str, token: &str) -> Result<(), AppError> {
        self.commit(Kind::Push, collection, token).await
    }

    /// The module has written what `token` handed out: record it, and for a page, move the
    /// cursor. No request is made.
    async fn commit(&self, kind: Kind, collection: &str, token: &str) -> Result<(), AppError> {
        let (held, session) = {
            let mut inner = self.inner.lock().await;
            let key = (kind, collection.to_owned());
            let held = match inner.held.remove(&key) {
                Some(held) if held.token == token => held,
                // Handed out before a sign-in, or already recorded: recording it would agree on
                // something this session never read.
                Some(other) => {
                    inner.held.insert(key, other);
                    return Err(err!("error.syncPageStale"));
                }
                None => return Err(err!("error.syncPageStale")),
            };
            let session = inner
                .session
                .clone()
                .ok_or_else(|| err!("error.syncNotSignedIn"))?;
            (held, session)
        };
        lend::land(
            &session.store,
            &session.keys,
            collection,
            &held.records,
            held.agreements,
        )
        .await?;
        if let Some(fetched) = &held.fetched {
            let opaque = crypto::opaque_id(&session.keys.id, collection);
            engine::commit(&session.store, &opaque, fetched).await?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sync::saved::InMemory;

    fn state() -> SyncState {
        let path = std::env::temp_dir().join(format!("sync-{}.db", uuid::Uuid::new_v4()));
        SyncState::new(Arc::new(InMemory::default()), Ok(path))
    }

    #[tokio::test]
    async fn nothing_kept_is_signed_out() {
        assert_eq!(state().status().await.unwrap(), Status::default());
    }

    /// Signed out, the loop's thirty-second check costs nothing: no request, a quiet error.
    #[tokio::test]
    async fn signed_out_asks_nobody() {
        let state = state();
        let pulled = state.pull_page("c").await.err().map(|error| error.code);
        let pushed = state.push("c", vec![]).await.err().map(|error| error.code);
        assert_eq!(pulled, Some("error.syncNotSignedIn"));
        assert_eq!(pushed, Some("error.syncNotSignedIn"));
    }

    /// A token nobody handed out — or one from before a sign-in — records nothing.
    #[tokio::test]
    async fn a_token_nobody_handed_out_records_nothing() {
        let error = state().commit_pull("c", "nope").await.unwrap_err();
        assert_eq!(error.code, "error.syncPageStale");
    }

    #[tokio::test]
    async fn a_code_with_no_registration_waiting_is_refused() {
        let error = state().verify("AAAA-AAAA", "desktop").await.unwrap_err();
        assert_eq!(error.code, "error.syncNothingToVerify");
    }
}
