//! Where a saved connection's passwords live: the operating system's own credential store —
//! Windows Credential Manager, the macOS Keychain, the Secret Service on Linux.
//!
//! Everything else about a saved connection (host, port, user, the sidebar width) stays in
//! `connections.json`, which is plain text by design: it is a list of what you connect to, and it
//! is useful to be able to read and copy it. What must not be in there is the credentials, which
//! is what this module keeps out of it.
//!
//! On macOS all of them share one entry — the vault — rather than keeping one each. The Keychain
//! asks before it hands an item to an application it does not recognise, and it decides what it
//! recognises from the application's code signature; MixDB is not signed, so every update is a
//! stranger to it. The question is asked once per *item*, which with an entry each meant one
//! dialog per saved connection: ten of them at once on the first look at the Database tab. All of
//! them in a single item is one dialog, and the read is cached for the run, so it is one dialog
//! per update rather than one per launch.
//!
//! Windows and Linux keep an entry each, because neither has the problem and Windows would be hurt
//! by the fix: Credential Manager refuses a secret over 2560 bytes, which a dozen connections in
//! one JSON object would pass. It never asks the question at all, and the Secret Service asks to
//! unlock the collection rather than for each item, so on both of them one entry per connection
//! costs nothing and stays well inside what the store will hold.
//!
//! On macOS, an entry written before the vault is moved into it the first time that connection is
//! read, and the old entry removed. There is no way to spare the user the dialogs on that one run:
//! those passwords are sitting in ten separately guarded items, and reading them is exactly what
//! the guard is asking about.

use crate::error::AppError;
use crate::platform::in_background;
use keyring::Entry;
use std::collections::HashMap;
use std::sync::{Mutex, MutexGuard, OnceLock};

/// Stands in for a secret wherever a `Debug` line would otherwise print one.
///
/// Prints as `"***"`, and through `Option` as `Some("***")` or `None` — so a redacted line still
/// says whether there was a password at all, which is nearly always the actual question.
///
/// Holds nothing on purpose: a type that carried the secret in order to hide it would only be one
/// stray `.0` away from printing it.
pub struct Redacted;

impl std::fmt::Debug for Redacted {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("\"***\"")
    }
}

/// The name MixDB's entries appear under in the OS credential store.
const SERVICE: &str = "MixDB";

/// The account the vault is stored under. Every other account name in the service is a leftover
/// from before the vault, and is a connection id — a uuid, so nothing can collide with this.
const VAULT: &str = "vault";

/// The secrets of one saved connection, keyed by the field they belong to (`password`, `uri`,
/// `sshPassword`, `sshPassphrase`). The frontend decides what goes in; this side only carries it.
pub type Secrets = HashMap<String, String>;

/// Every saved connection's secrets, by connection id — databases, REST requests and terminal
/// hosts alike, which is safe because all three take their ids from the same uuid generator.
type Vault = HashMap<String, Secrets>;

/// The credential store, narrowed to the three things this module asks of it.
///
/// It is a trait so that the vault — the migration, the caching, the counting of how many times
/// the store is actually touched — can be tested against a `HashMap`. The real store is the
/// machine's own, and a test that used it would write to the developer's keychain and, on macOS,
/// raise the very dialogs this module exists to avoid.
trait Store {
    /// The value under `account`, or `None` when there is nothing there.
    fn read(&self, account: &str) -> Result<Option<String>, AppError>;
    fn write(&self, account: &str, value: &str) -> Result<(), AppError>;
    /// Removes `account`. Removing what is not there is not a failure.
    fn forget(&self, account: &str) -> Result<(), AppError>;
}

/// The credential store of the machine MixDB is running on.
struct OsStore;

impl OsStore {
    fn entry(&self, account: &str) -> Result<Entry, AppError> {
        Entry::new(SERVICE, account)
            .map_err(|e| err!("error.credentialStoreUnreachable", message = e))
    }
}

impl Store for OsStore {
    fn read(&self, account: &str) -> Result<Option<String>, AppError> {
        match self.entry(account)?.get_password() {
            Ok(value) => Ok(Some(value)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(err!("error.cannotReadPassword", message = e)),
        }
    }

    fn write(&self, account: &str, value: &str) -> Result<(), AppError> {
        self.entry(account)?
            .set_password(value)
            .map_err(|e| err!("error.cannotSavePassword", message = e))
    }

    fn forget(&self, account: &str) -> Result<(), AppError> {
        match self.entry(account)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(err!("error.cannotRemovePassword", message = e)),
        }
    }
}

/// A credential store, and the vault held over it where the platform calls for one.
///
/// The vault is read once and held for the rest of the run, which is what turns ten connections
/// opening at once into one visit to the credential store. Behind a `Mutex` because those ten
/// arrive on ten threads of the blocking pool: the first to reach it does the reading and the
/// other nine wait for it, rather than each raising a dialog of its own. Where `vaulted` is false
/// the `Mutex` is never touched: nothing is cached, and each connection is read from and written
/// to an entry of its own.
struct Keeper<S: Store> {
    store: S,
    /// Whether every connection shares one entry. True on macOS and nowhere else — see the module
    /// documentation for both halves of why.
    vaulted: bool,
    vault: Mutex<Option<Vault>>,
}

impl<S: Store> Keeper<S> {
    fn new(store: S) -> Self {
        Self::with_vault(store, cfg!(target_os = "macos"))
    }

    fn with_vault(store: S, vaulted: bool) -> Self {
        Self {
            store,
            vaulted,
            vault: Mutex::new(None),
        }
    }

    /// The vault, read from the store on the first call and held after that.
    ///
    /// A failed read leaves the cache empty rather than filling it with an empty vault, so the
    /// next call tries again: a credential store that was locked or busy for one call is worth
    /// asking twice, and the alternative is a run that quietly believes there are no passwords.
    fn open(&self) -> Result<MutexGuard<'_, Option<Vault>>, AppError> {
        // A panic elsewhere while the vault was open says nothing about the vault itself: it is a
        // plain map, and whatever panicked had either written it or not.
        let mut guard = self.vault.lock().unwrap_or_else(|e| e.into_inner());
        if guard.is_none() {
            let vault = match self.store.read(VAULT)? {
                Some(json) => serde_json::from_str(&json)
                    .map_err(|e| err!("error.cannotReadPassword", message = e))?,
                None => Vault::new(),
            };
            guard.replace(vault);
        }
        Ok(guard)
    }

    /// Puts the vault back in the store. An empty one is deleted rather than stored as `{}` — an
    /// app with nothing to hide should leave nothing behind.
    ///
    /// Both callers change a *copy* of the vault, flush that, and only then put it in the cache.
    /// A failed write is then a change that did not happen anywhere: the store holds what it held,
    /// the cache agrees with it, and nothing that was about to be deleted has been. The
    /// alternative — writing to the cache first — leaves a run believing a password was saved that
    /// was not, and telling the user so until the app is next started.
    fn flush(&self, vault: &Vault) -> Result<(), AppError> {
        if vault.is_empty() {
            return self.store.forget(VAULT);
        }
        let json = serde_json::to_string(vault)
            .map_err(|e| err!("error.cannotSavePassword", message = e))?;
        self.store.write(VAULT, &json)
    }

    /// One connection's own entry, which is where every platform kept them before the vault and
    /// where Windows and Linux keep them still.
    fn read_entry(&self, id: &str) -> Result<Secrets, AppError> {
        match self.store.read(id)? {
            Some(json) => serde_json::from_str(&json)
                .map_err(|e| err!("error.cannotReadPassword", message = e)),
            None => Ok(Secrets::new()),
        }
    }

    /// The connection's secrets, or an empty set when it has none.
    ///
    /// Under the vault, a connection whose secrets are still in an entry of their own is moved
    /// across here and its old entry removed. That removal is allowed to fail without failing the
    /// read: on macOS it is a second guarded operation on the same item, so a user who answered
    /// the first dialog with a plain *Allow* is asked again, and a *Deny* there must not take the
    /// connection list down with it. What is left behind then is a stale duplicate — the vault is
    /// what MixDB reads and writes from that point on — and it goes when the connection is next
    /// saved.
    fn load(&self, id: &str) -> Result<Secrets, AppError> {
        if !self.vaulted {
            return self.read_entry(id);
        }
        let mut guard = self.open()?;
        let vault = guard.get_or_insert_with(Vault::new);
        if let Some(secrets) = vault.get(id) {
            return Ok(secrets.clone());
        }
        let Some(json) = self.store.read(id)? else {
            return Ok(Secrets::new());
        };
        let secrets: Secrets = serde_json::from_str(&json)
            .map_err(|e| err!("error.cannotReadPassword", message = e))?;
        let mut moved = vault.clone();
        moved.insert(id.to_string(), secrets.clone());
        self.flush(&moved)?;
        *vault = moved;
        let _ = self.store.forget(id);
        Ok(secrets)
    }

    /// Writes the connection's secrets, replacing whatever was there. An empty set removes the
    /// connection rather than storing an empty object — a connection with nothing to hide should
    /// leave nothing behind.
    ///
    /// Under the vault this clears the pre-vault entry for this id as well. Nearly always there is
    /// none and this costs a lookup that finds nothing; when there is one, this is what stops an
    /// old copy of a password outliving the password itself.
    fn save(&self, id: &str, secrets: &Secrets) -> Result<(), AppError> {
        if !self.vaulted {
            if secrets.is_empty() {
                return self.store.forget(id);
            }
            let json = serde_json::to_string(secrets)
                .map_err(|e| err!("error.cannotSavePassword", message = e))?;
            return self.store.write(id, &json);
        }
        let mut guard = self.open()?;
        let vault = guard.get_or_insert_with(Vault::new);
        let mut next = vault.clone();
        if secrets.is_empty() {
            next.remove(id);
        } else {
            next.insert(id.to_string(), secrets.clone());
        }
        self.flush(&next)?;
        *vault = next;
        self.store.forget(id)
    }

    /// Forgets everything stored for the connection, for when the connection itself is deleted.
    fn delete(&self, id: &str) -> Result<(), AppError> {
        self.save(id, &Secrets::new())
    }
}

fn keeper() -> &'static Keeper<OsStore> {
    static KEEPER: OnceLock<Keeper<OsStore>> = OnceLock::new();
    KEEPER.get_or_init(|| Keeper::new(OsStore))
}

/// Writes a saved connection's secrets, replacing whatever was there. An empty set deletes them.
pub fn save(id: &str, secrets: &Secrets) -> Result<(), AppError> {
    keeper().save(id, secrets)
}

/// A saved connection's secrets, or an empty set when it has none — which is also what a
/// connection whose entry the user deleted from the OS store looks like.
pub fn load(id: &str) -> Result<Secrets, AppError> {
    keeper().load(id)
}

/// Forgets everything stored for a saved connection.
pub fn delete(id: &str) -> Result<(), AppError> {
    keeper().delete(id)
}

/// Writes a saved connection's secrets to the OS credential store, replacing what was there.
#[tauri::command]
pub async fn secrets_save(id: String, secrets: Secrets) -> Result<(), AppError> {
    in_background(move || save(&id, &secrets)).await
}

/// A saved connection's secrets, or nothing when it has none stored.
#[tauri::command]
pub async fn secrets_load(id: String) -> Result<Secrets, AppError> {
    in_background(move || load(&id)).await
}

/// Forgets a saved connection's secrets, for when the connection itself is deleted.
#[tauri::command]
pub async fn secrets_delete(id: String) -> Result<(), AppError> {
    in_background(move || delete(&id)).await
}

/// The service MixEngine's own keyring entries are filed under — a compile-time constant on this
/// side too, and never taken from a caller: see the module doc of `modules/db/handoff.rs` for why
/// it must not travel on the wire. `SavedConnection.keyringRef` on the frontend is only ever the
/// key half of the address.
const MIXENGINE_SERVICE: &str = "mixengine";

/// Reads one of MixEngine's own keyring entries by the key half of its address. Bypasses
/// `Keeper` entirely on purpose: there is no vault, no cache and no migration for an entry that
/// is not this app's own, and the vault would not save a single dialog for a namespace MixEngine's
/// own process created — see the module doc's macOS paragraph, which is about entries of ours.
///
/// `Ok(None)` for an entry that is not there. MixEngine removes an entry when whatever owned it
/// is gone, and a reference outliving its credential is that account's normal end, not a failure —
/// the caller shows the same empty-password form a connection that was never saved would.
fn read_mixengine_entry(key: &str) -> Result<Option<String>, AppError> {
    match Entry::new(MIXENGINE_SERVICE, key)
        .map_err(|e| err!("error.credentialStoreUnreachable", message = e))?
        .get_password()
    {
        Ok(value) => Ok(Some(value)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(err!("error.cannotReadPassword", message = e)),
    }
}

/// The password a `SavedConnection.keyringRef` points at, or `None` when MixEngine no longer has
/// that entry.
#[tauri::command]
pub async fn secrets_resolve_mixengine(key: String) -> Result<Option<String>, AppError> {
    in_background(move || read_mixengine_entry(&key)).await
}

#[cfg(test)]
mod tests {
    use super::{Keeper, Secrets, Store, VAULT};
    use crate::error::AppError;
    use std::collections::HashMap;
    use std::sync::{Arc, Mutex};

    /// A credential store that is a `HashMap`, and that remembers every account it was asked for,
    /// so a test can say how many dialogs macOS would have raised.
    ///
    /// Shared through an `Arc` because a `Keeper` owns its store: the test needs the store to
    /// outlive one keeper in order to open a second one over it and stand in for a fresh run.
    #[derive(Default)]
    struct MemoryStore {
        items: Mutex<HashMap<String, String>>,
        reads: Mutex<Vec<String>>,
        /// Makes every write fail, standing in for a credential store that is locked, full, or
        /// whose dialog the user answered with *Deny*.
        refuse_writes: Mutex<bool>,
    }

    impl MemoryStore {
        fn seed(&self, account: &str, value: &str) {
            self.items
                .lock()
                .unwrap()
                .insert(account.to_string(), value.to_string());
        }

        fn has(&self, account: &str) -> bool {
            self.items.lock().unwrap().contains_key(account)
        }

        fn refuse_writes(&self, refuse: bool) {
            *self.refuse_writes.lock().unwrap() = refuse;
        }

        fn reads_of(&self, account: &str) -> usize {
            self.reads
                .lock()
                .unwrap()
                .iter()
                .filter(|asked| *asked == account)
                .count()
        }
    }

    impl Store for Arc<MemoryStore> {
        fn read(&self, account: &str) -> Result<Option<String>, AppError> {
            self.reads.lock().unwrap().push(account.to_string());
            Ok(self.items.lock().unwrap().get(account).cloned())
        }

        fn write(&self, account: &str, value: &str) -> Result<(), AppError> {
            if *self.refuse_writes.lock().unwrap() {
                return Err(crate::err!("error.cannotSavePassword"));
            }
            self.seed(account, value);
            Ok(())
        }

        fn forget(&self, account: &str) -> Result<(), AppError> {
            self.items.lock().unwrap().remove(account);
            Ok(())
        }
    }

    /// One password, which is what nearly every one of these is about.
    fn secrets(password: &str) -> Secrets {
        let mut secrets = Secrets::new();
        secrets.insert("password".to_string(), password.to_string());
        secrets
    }

    /// A store and a keeper over it, the store handed back so a test can look inside.
    ///
    /// Both modes are asked for by name rather than taken from `cfg!`, so the whole of this module
    /// is tested wherever the suite runs — the vault included, on a machine that would never use
    /// it.
    fn fixture(vaulted: bool) -> (Arc<MemoryStore>, Keeper<Arc<MemoryStore>>) {
        let store = Arc::new(MemoryStore::default());
        (store.clone(), Keeper::with_vault(store, vaulted))
    }

    /// A keeper that keeps everything in one entry, as macOS does.
    fn vaulted() -> (Arc<MemoryStore>, Keeper<Arc<MemoryStore>>) {
        fixture(true)
    }

    /// A keeper that gives each connection an entry, as Windows and Linux do.
    fn per_entry() -> (Arc<MemoryStore>, Keeper<Arc<MemoryStore>>) {
        fixture(false)
    }

    #[test]
    fn secrets_survive_a_round_trip_through_the_vault() {
        let (_store, keeper) = vaulted();

        // A connection with nothing stored reads as empty rather than as a failure.
        assert!(keeper.load("a").unwrap().is_empty());

        let mut written = secrets("hunter2");
        written.insert("sshPassphrase".to_string(), "let me in".to_string());
        keeper.save("a", &written).unwrap();
        assert_eq!(keeper.load("a").unwrap(), written);
    }

    #[test]
    fn one_connection_leaving_the_vault_does_not_take_another_with_it() {
        let (_store, keeper) = vaulted();
        keeper.save("a", &secrets("one")).unwrap();
        keeper.save("b", &secrets("two")).unwrap();

        keeper.delete("a").unwrap();

        assert!(keeper.load("a").unwrap().is_empty());
        assert_eq!(keeper.load("b").unwrap(), secrets("two"));
    }

    /// The reason the vault exists: ten saved connections opening at once are one visit to the
    /// credential store, which on macOS is one dialog instead of ten.
    #[test]
    fn ten_connections_are_one_visit_to_the_store() {
        let (store, keeper) = vaulted();
        let ids: Vec<String> = (0..10).map(|i| format!("id-{i}")).collect();
        for id in &ids {
            keeper.save(id, &secrets(id)).unwrap();
        }
        drop(keeper);

        // A fresh run: the same store, nothing cached.
        let keeper = Keeper::with_vault(store.clone(), true);
        let before = store.reads_of(VAULT);
        for id in &ids {
            assert_eq!(keeper.load(id).unwrap(), secrets(id));
        }

        assert_eq!(store.reads_of(VAULT) - before, 1);
        // No connection's own id was ever asked for: they all came out of the vault.
        assert_eq!(store.reads_of("id-3"), 0);
    }

    /// What the first run after the update does: an entry written when there was one per
    /// connection is folded into the vault and the old entry removed, so it is asked for once and
    /// never again.
    #[test]
    fn an_entry_from_before_the_vault_moves_across_on_first_read() {
        let (store, keeper) = vaulted();
        store.seed("old", &serde_json::to_string(&secrets("legacy")).unwrap());

        assert_eq!(keeper.load("old").unwrap(), secrets("legacy"));
        assert!(
            !store.has("old"),
            "the old entry is removed once it has been moved"
        );

        assert_eq!(keeper.load("old").unwrap(), secrets("legacy"));
        assert_eq!(
            store.reads_of("old"),
            1,
            "the second read comes from the vault"
        );
    }

    #[test]
    fn saving_nothing_leaves_nothing_behind() {
        let (store, keeper) = vaulted();
        keeper.save("a", &secrets("hunter2")).unwrap();
        assert!(store.has(VAULT));

        keeper.save("a", &Secrets::new()).unwrap();

        assert!(keeper.load("a").unwrap().is_empty());
        assert!(
            !store.has(VAULT),
            "an empty vault is deleted, not stored as an empty object"
        );
    }

    /// A leftover from before the vault does not outlive the password it held, even when the
    /// connection was saved again before anything ever read it.
    #[test]
    fn saving_clears_the_entry_this_connection_used_to_have() {
        let (store, keeper) = vaulted();
        store.seed("a", &serde_json::to_string(&secrets("legacy")).unwrap());

        keeper.save("a", &secrets("current")).unwrap();

        assert!(!store.has("a"));
        assert_eq!(keeper.load("a").unwrap(), secrets("current"));
    }

    /// The move into the vault is a copy before it is a move: a store that will not take the write
    /// leaves the old entry exactly where it was, and the connection still has its password on the
    /// next run.
    #[test]
    fn a_failed_move_into_the_vault_destroys_nothing() {
        let (store, keeper) = vaulted();
        store.seed("old", &serde_json::to_string(&secrets("legacy")).unwrap());
        store.refuse_writes(true);

        assert!(keeper.load("old").is_err());
        assert!(store.has("old"), "the old entry is still there to be read again");

        // The store recovers, and so does the connection — from the entry that was never deleted.
        store.refuse_writes(false);
        assert_eq!(keeper.load("old").unwrap(), secrets("legacy"));
        assert!(!store.has("old"));
    }

    /// A save the store refuses is a save that did not happen anywhere. The run must not go on
    /// reporting the new password back as if it had been written.
    #[test]
    fn a_failed_save_leaves_the_old_password_in_place() {
        let (store, keeper) = vaulted();
        keeper.save("a", &secrets("first")).unwrap();

        store.refuse_writes(true);
        assert!(keeper.save("a", &secrets("second")).is_err());

        assert_eq!(keeper.load("a").unwrap(), secrets("first"));
        store.refuse_writes(false);
        assert_eq!(keeper.load("a").unwrap(), secrets("first"));
    }

    /// What Windows and Linux still do: an entry each, no vault, nothing cached.
    #[test]
    fn without_the_vault_every_connection_keeps_its_own_entry() {
        let (store, keeper) = per_entry();

        assert!(keeper.load("a").unwrap().is_empty());

        keeper.save("a", &secrets("hunter2")).unwrap();
        keeper.save("b", &secrets("two")).unwrap();
        assert_eq!(keeper.load("a").unwrap(), secrets("hunter2"));
        assert!(store.has("a") && store.has("b"));
        assert!(!store.has(VAULT), "no vault is written where none is used");

        keeper.delete("a").unwrap();
        assert!(!store.has("a"));
        assert_eq!(keeper.load("b").unwrap(), secrets("two"));
    }

    /// Nothing is cached without the vault, so a password changed in the store is seen at once —
    /// and, more to the point, the store is read every time rather than once per run.
    #[test]
    fn without_the_vault_every_read_reaches_the_store() {
        let (store, keeper) = per_entry();
        keeper.save("a", &secrets("hunter2")).unwrap();

        keeper.load("a").unwrap();
        keeper.load("a").unwrap();

        assert_eq!(store.reads_of("a"), 2);
        assert_eq!(store.reads_of(VAULT), 0);
    }

    /// Ignored by default: it writes to the machine's real credential store, which a headless
    /// Linux CI box has no running Secret Service for. Run it by hand with
    /// `cargo test -- --ignored` on a desktop to check the store is actually reachable.
    #[test]
    #[ignore]
    fn secrets_survive_a_round_trip_through_the_os_store() {
        let id = format!("mixdb-test-{}", uuid::Uuid::new_v4());

        assert!(super::load(&id).unwrap().is_empty());

        let mut written = secrets("hunter2");
        written.insert("sshPassphrase".to_string(), "let me in".to_string());
        super::save(&id, &written).unwrap();
        assert_eq!(super::load(&id).unwrap(), written);

        super::save(&id, &Secrets::new()).unwrap();
        assert!(super::load(&id).unwrap().is_empty());

        super::delete(&id).unwrap();
    }

    /// Ignored for the same reason as the round-trip above: it reaches the machine's real
    /// credential store. Run by hand with `cargo test -- --ignored`.
    #[test]
    #[ignore]
    fn a_mixengine_entry_round_trips_and_a_missing_one_is_none() {
        let key = format!("mixdb-test-{}", uuid::Uuid::new_v4());
        assert_eq!(super::read_mixengine_entry(&key).unwrap(), None);

        let entry = keyring::Entry::new(super::MIXENGINE_SERVICE, &key).unwrap();
        entry.set_password("hunter2").unwrap();
        assert_eq!(
            super::read_mixengine_entry(&key).unwrap(),
            Some("hunter2".to_string())
        );

        entry.delete_credential().unwrap();
        assert_eq!(super::read_mixengine_entry(&key).unwrap(), None);
    }
}
