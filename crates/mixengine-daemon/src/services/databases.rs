//! Making a database and the account that reaches it — roadmap task **T77a**.
//!
//! [`mixengine_core::generate::databases`] says *what statements*; this says *with which
//! credential*, and it is here for [`super::first_run`]'s reason: the OS keyring and the process
//! runner are the daemon's.
//!
//! # The order, and why it is that one
//!
//! 1. **Read the superuser's password**, which the service's first run generated and stored.
//! 2. **Probe.** One read-only query, and the only thing that can tell an account of ours from
//!    somebody else's.
//! 3. **Decide** — [`decide`], which is the design's D3 and the whole of what makes step 5 safe.
//! 4. **Store the account's password before touching the server.** T33's ordering, for T33's
//!    reason: what a failure after this point leaves behind is a credential for an account that does
//!    not exist, and the next attempt creates the account with exactly it. The other order leaves an
//!    account whose password exists nowhere, which nothing can repair.
//! 5. **Run the statements**, the last of which logs in as the new account and writes with it.

use std::sync::Arc;

use mixengine_core::generate::Provisioning;
use mixengine_core::generate::databases::{Ask, Credentials, Found, SECRET_LENGTH};
use mixengine_platform::{Host, KEYRING_SERVICE};
use mixengine_proto::{Error, ErrorCode, Made, Provisioned, ServiceId};

use crate::error::ToWire as _;

/// What to do about the account, having probed and asked the keyring.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum Account {
    /// Nothing of ours and nothing on the server: generate a password and store it.
    Generate,

    /// A password a person chose: write it to the keyring before anything runs, exactly as
    /// [`Generate`](Self::Generate) does, then use it. Roadmap task **T77b**.
    ///
    /// **Distinct from [`Stored`](Self::Stored) on purpose.** A chosen password has never been
    /// written yet — not even when it replaces an existing entry — so treating it as already
    /// stored would use it without ever putting it in the keyring, which is the one bug this
    /// distinction exists to rule out.
    Store(String),

    /// Ours, and already in the keyring. Use this, and let the statements bring the server into
    /// line with it. Nothing is written: it is already there.
    Stored(String),

    /// On the server, and MixEngine holds no credential for it. Refuse.
    Foreign,
}

/// The design's **D3**, and roadmap task **T77b**'s D6: a keyring entry is the deed of ownership,
/// and a chosen password is stored exactly where a generated one would be — never a way around the
/// deed. `chosen` overrides what row of the *value* is used, never what row of the *decision* is:
/// the foreign row is unreachable by any value of `chosen`, on purpose.
///
/// Pure, and deliberately so — this is the rule the whole task rests on, and a rule that needs a
/// database and a credential store to exercise is a rule nobody checks.
pub(crate) fn decide(found: Found, stored: Option<String>, chosen: Option<String>) -> Account {
    match (found.user, stored, chosen) {
        // Foreign is foreign regardless of what value was offered: knowing a password is not the
        // deed. This arm is checked before the "some password wins" arms below it, or a chosen
        // password would silently seize a foreign account.
        (true, None, _) => Account::Foreign,

        // A password was offered and the account is either ours already or does not exist yet:
        // the chosen value replaces whatever was stored (or fills nothing) and is written before
        // the statements run, and the statements realign the server to it.
        (_, _, Some(password)) => Account::Store(password),

        // Ours: reuse the stored value. Nothing is written.
        (_, Some(password), None) => Account::Stored(password),

        // Nothing stored, nothing chosen, no account on the server: generate one.
        (false, None, None) => Account::Generate,
    }
}

/// The account's password: the one already stored, or a new one stored before anything runs.
///
/// # Errors
///
/// [`ErrorCode::Conflict`] for [`Account::Foreign`]; a machine with no credential store, which
/// fails here and therefore fails with nothing created.
pub(crate) async fn account_password(
    host: &Arc<dyn Host>,
    address: &str,
    service: &ServiceId,
    user: &str,
    found: Found,
    chosen: Option<String>,
) -> Result<String, Error> {
    match decide(found, read(host, address).await?, chosen) {
        Account::Stored(password) => Ok(password),

        Account::Store(password) => {
            write(host, address, &password).await?;

            Ok(password)
        }

        Account::Foreign => Err(mixengine_core::Error::AccountNotOurs {
            service: service.as_str().to_owned(),
            user: user.to_owned(),
        }
        .to_wire()),

        Account::Generate => {
            let secret = mixengine_platform::generate_secret(SECRET_LENGTH)
                .map_err(|error| error.to_wire())?;

            write(host, address, &secret).await?;

            Ok(secret)
        }
    }
}

/// Make the database and the account, and answer with what was made.
///
/// # Errors
///
/// An instance whose first run never stored a superuser credential; everything
/// [`account_password`] refuses; and whatever a failed statement reports, carrying what the client
/// printed.
pub(crate) async fn ensure(
    host: &Arc<dyn Host>,
    provisioning: &Provisioning,
    service: &ServiceId,
    ask: &Ask,
    chosen: Option<String>,
) -> Result<Provisioned, Error> {
    let root = read(host, &provisioning.root_address())
        .await?
        .ok_or_else(|| {
            Error::new(
                ErrorCode::PreconditionFailed,
                format!("{service} has no superuser credential in this machine's keyring"),
            )
            .with_hint(
                "that password is written by the service's first run — `mix service start` \
                 performs it",
            )
        })?;

    let probe = provisioning
        .probe(ask, &root)
        .map_err(|error| error.to_wire())?;
    let found = Found::read(super::step::run(&probe).await?.output());

    let account = account_password(
        host,
        &provisioning.secret_address(&ask.user),
        service,
        &ask.user,
        found,
        chosen,
    )
    .await?;

    let credentials = Credentials { root, account };
    let steps = provisioning
        .steps(ask, found, &credentials)
        .map_err(|error| error.to_wire())?;

    for step in &steps {
        super::step::run(step).await?;
    }

    Ok(Provisioned {
        database: made(found.database),
        user: made(found.user),
    })
}

/// What one object was, said the way the wire says it.
fn made(existed: bool) -> Made {
    match existed {
        true => Made::Existing,
        false => Made::Created,
    }
}

/// Read one credential, off the runtime's threads.
///
/// `spawn_blocking` for the reason [`super::first_run`] gives: the keyring blocks, and on Linux it
/// blocks on a D-Bus round trip to a daemon that may be prompting somebody to unlock it.
///
/// Reached by `database.open` as well (roadmap task **T83**), which reads an account's password
/// at the moment of the handoff — one reader, so the two agree on the address and the thread.
pub(crate) async fn read(host: &Arc<dyn Host>, address: &str) -> Result<Option<String>, Error> {
    let (host, address) = (Arc::clone(host), address.to_owned());

    tokio::task::spawn_blocking(move || host.keyring().secret(KEYRING_SERVICE, &address))
        .await
        .map_err(|_| {
            Error::new(
                ErrorCode::Internal,
                "the task reading a credential did not finish".to_owned(),
            )
        })?
        .map_err(|error| error.to_wire())
}

/// Store one, the same way.
async fn write(host: &Arc<dyn Host>, address: &str, secret: &str) -> Result<(), Error> {
    let (host, address, secret) = (Arc::clone(host), address.to_owned(), secret.to_owned());

    tokio::task::spawn_blocking(move || {
        host.keyring()
            .set_secret(KEYRING_SERVICE, &address, &secret)
    })
    .await
    .map_err(|_| {
        Error::new(
            ErrorCode::Internal,
            "the task storing a credential did not finish".to_owned(),
        )
    })?
    .map_err(|error| error.to_wire())
}

#[cfg(test)]
mod tests {
    //! **[`ensure`] itself is not tested here, and deliberately.** A [`Provisioning`] can only be
    //! built by `mixengine-core`'s generator — the wall [`super::first_run`]'s own test module
    //! documents — so a test of it would be a test of the generator. What it adds over the two
    //! functions below is the *order*, and every part of that order is proved: the credential rule
    //! here, the statements in `mixengine_core::generate::recipes`, and the whole of it against real
    //! servers in `crates/mixengine-cli/tests/mariadb.rs`.

    use mixengine_platform::mock::{Host as MockHost, SecretOp};

    use super::*;

    /// A host whose keyring answers, or one that has none at all.
    fn host(available: bool) -> (Arc<MockHost>, Arc<dyn Host>) {
        let home = std::env::temp_dir();
        let mock = Arc::new(match available {
            true => MockHost::with_home(home),
            false => MockHost::without_keyring(home, "there is no secret service on this machine"),
        });

        (Arc::clone(&mock), mock)
    }

    /// `mariadb@main`, which is what every address below is composed from.
    fn service() -> ServiceId {
        ServiceId::parse("mariadb@main").expect("an id")
    }

    /// **The whole of design D3, and it needs neither a server nor a credential store.**
    ///
    /// A keyring entry is the deed of ownership. The row that matters is the last one: an account on
    /// the server that MixEngine holds no password for is somebody else's, and the alternative to
    /// refusing is an `ALTER USER` that silently seizes it.
    #[test]
    fn a_keyring_entry_is_what_says_an_account_is_ours() {
        let nothing = Found {
            database: false,
            user: false,
        };
        let account = Found {
            database: false,
            user: true,
        };

        assert_eq!(decide(nothing, None, None), Account::Generate);
        assert_eq!(
            decide(nothing, Some("kept".to_owned()), None),
            Account::Stored("kept".to_owned()),
            "a password stored for an account that does not exist yet is the half-finished attempt \
             D5 leaves behind, and the next run creates the account with exactly it"
        );
        assert_eq!(
            decide(account, Some("kept".to_owned()), None),
            Account::Stored("kept".to_owned()),
            "ours: reuse the stored value and let the statements realign the server to it"
        );
        assert_eq!(decide(account, None, None), Account::Foreign);
    }

    /// **A chosen password is stored exactly where a generated one would be** — roadmap task
    /// **T77b**, spec D6 — same branch, same row of the table, whether nothing was stored yet or
    /// something already was.
    #[test]
    fn a_chosen_password_is_stored_the_way_a_generated_one_is() {
        let nothing = Found {
            database: false,
            user: false,
        };
        let account = Found {
            database: false,
            user: true,
        };

        assert_eq!(
            decide(nothing, None, Some("chosen".to_owned())),
            Account::Store("chosen".to_owned()),
            "no server account and no keyring entry: the chosen password is written and then used, \
             exactly as Generate's would be — never Stored, which writes nothing"
        );
        assert_eq!(
            decide(account, Some("old".to_owned()), Some("chosen".to_owned())),
            Account::Store("chosen".to_owned()),
            "ours already, but the person wants it changed: replace the keyring entry and let the \
             statements' ALTER USER realign the server"
        );
    }

    /// **Knowing a password is not ownership** — spec D6's last row, the one that matters. An
    /// account on the server MixEngine holds no keyring entry for is refused even when the caller
    /// supplied its correct password: the deed is the keyring entry, never a value proven correct.
    #[test]
    fn a_foreign_account_is_refused_even_with_a_chosen_password() {
        let account = Found {
            database: false,
            user: true,
        };

        assert_eq!(
            decide(account, None, Some("i-know-it".to_owned())),
            Account::Foreign
        );
    }

    /// **Design D5.** The password is stored before anything could run, so what a later failure
    /// leaves is a credential for an account that does not exist — which the next attempt uses to
    /// create it. The opposite order leaves an account whose password exists nowhere.
    #[tokio::test]
    async fn a_new_account_has_its_password_stored_before_a_statement_could_run() {
        let (mock, host) = host(true);

        let password = account_password(
            &host,
            "mariadb@main/blog",
            &service(),
            "blog",
            Found::default(),
            None,
        )
        .await
        .expect("a password");

        assert_eq!(password.chars().count(), SECRET_LENGTH);
        assert_eq!(
            mock.secret_operations(),
            vec![SecretOp::Stored {
                service: KEYRING_SERVICE.to_owned(),
                key: "mariadb@main/blog".to_owned(),
            }]
        );
    }

    /// **A chosen password reaches the keyring, not just the return value** — roadmap task
    /// **T77b**. Asserting only `decide`'s output would pass even if the caller forgot to write a
    /// value nobody had stored yet; this is the test that actually exercises the write.
    #[tokio::test]
    async fn a_chosen_password_is_written_to_the_keyring_before_it_is_used() {
        let (mock, host) = host(true);

        let password = account_password(
            &host,
            "mariadb@main/blog",
            &service(),
            "blog",
            Found::default(),
            Some("chosen-by-a-person".to_owned()),
        )
        .await
        .expect("a password");

        assert_eq!(password, "chosen-by-a-person");
        assert_eq!(
            mock.keyring()
                .secret(KEYRING_SERVICE, "mariadb@main/blog")
                .expect("the mock store answers"),
            Some("chosen-by-a-person".to_owned()),
            "the chosen password must actually be in the keyring, not merely returned"
        );
    }

    /// **Ours is not rotated.** A stored password comes back unchanged and nothing is written: what
    /// realigns a server that has drifted is the `ALTER USER` in the statements, not a new secret.
    #[tokio::test]
    async fn an_account_of_ours_keeps_the_password_it_has() {
        let (mock, host) = host(true);
        mock.keyring()
            .set_secret(KEYRING_SERVICE, "mariadb@main/blog", "kept")
            .expect("the mock store takes it");

        let password = account_password(
            &host,
            "mariadb@main/blog",
            &service(),
            "blog",
            Found {
                database: true,
                user: true,
            },
            None,
        )
        .await
        .expect("a password");

        assert_eq!(password, "kept");
        assert_eq!(
            mock.secret_operations()
                .iter()
                .filter(|op| matches!(op, SecretOp::Stored { .. }))
                .count(),
            1,
            "the stored password was rotated"
        );
    }

    /// **Design D3's third branch**, as the error a client renders.
    #[tokio::test]
    async fn an_account_we_hold_no_credential_for_is_refused() {
        let (_, host) = host(true);

        let error = account_password(
            &host,
            "mariadb@main/blog",
            &service(),
            "blog",
            Found {
                database: false,
                user: true,
            },
            None,
        )
        .await
        .expect_err("it refuses");

        assert_eq!(error.code, ErrorCode::Conflict);
        assert!(error.message.contains("blog"), "{}", error.message);
    }

    /// **A machine with no credential store fails here**, which is before anything could have been
    /// created — T33's ordering, and the reason this reads the keyring at all rather than letting
    /// the statements discover it.
    #[tokio::test]
    async fn a_machine_with_no_credential_store_fails_before_anything_is_made() {
        let (mock, host) = host(false);

        account_password(
            &host,
            "mariadb@main/blog",
            &service(),
            "blog",
            Found::default(),
            None,
        )
        .await
        .expect_err("there is nowhere to put a password");

        assert!(
            mock.secret_operations().is_empty(),
            "a store that refuses reads must not have been written to either"
        );
    }
}
