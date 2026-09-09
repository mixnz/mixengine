//! `database.create` — roadmap task **T77a**.
//!
//! Thin, like every handler here: it validates two names, makes sure the instance is up, and hands
//! the work to [`crate::services::databases`]. What it adds is the two refusals a caller can act on
//! — a package with no databases at all, and a service this home does not declare — and it tells
//! them apart, because "no such service: redis@main" would send somebody looking for a service that
//! is right there.
//!
//! **One provisioning at a time per instance** — the T77a design, D10. PostgreSQL's conditional
//! creation reads and then writes, so two callers racing for the same database would put one of them
//! into `database "blog" already exists`. The map here folds the second into waiting for the first,
//! on the precedent of the one [`crate::packages`] holds.

use std::collections::{BTreeMap, HashMap};
use std::sync::Arc;

use mixengine_core::Store;
use mixengine_core::extensions::manifest::{Body, DesktopApp};
use mixengine_core::extensions::store::{self as extension_store, Installed};
use mixengine_core::generate::databases::{Ask, validated_identifier};
use mixengine_core::services::handoff::{self, CREDENTIAL_ENV, Connection};
use mixengine_core::window;
use mixengine_platform::{InstalledApp, Located, Started};
use mixengine_proto::{
    DatabaseAccount, DatabaseClientQuery, DatabaseClientReport, DatabaseCreate,
    DatabaseCredentials, DatabaseCredentialsQuery, DatabaseHandoff, DatabaseOpen, DesktopClient,
    Error, ErrorCode, Launch, SecretAddress, ServiceId,
};
use tokio::sync::Mutex;

use crate::error::ToWire as _;

/// What a database will be handed to: which state to report, what to start, and under which scheme
/// — roadmap task **T107**.
///
/// **One value and not a tuple**, because it grew a third member the day the window stopped being an
/// extension: a `(DesktopClient, Option<InstalledApp>)` with a scheme bolted on is three things a
/// caller has to keep in step by hand, and the scheme is the one of the three that used to be read
/// separately and could disagree.
struct Client {
    /// What `mix database client` prints, and what a refused `open` carries back.
    state: DesktopClient,

    /// How to start it, when this machine has it.
    app: Option<InstalledApp>,

    /// The scheme its handoff URL is written under, when there is something to start.
    scheme: Option<String>,
}

/// The `database.*` half of the API.
#[derive(Debug)]
pub(crate) struct Databases {
    /// What declares a service, remembers how its databases are made, and can start it.
    services: Arc<crate::services::Registry>,

    /// This machine, for its credential store and — roadmap task **T83** — the desktop client.
    host: Arc<dyn mixengine_platform::Host>,

    /// This home's tables: which service listens where, and which extension is the client.
    store: Store,

    /// One provisioning at a time per instance — see the module note.
    busy: Mutex<HashMap<ServiceId, Arc<Mutex<()>>>>,
}

impl Databases {
    /// The one of these the API holds.
    pub(crate) fn new(
        services: Arc<crate::services::Registry>,
        host: Arc<dyn mixengine_platform::Host>,
        store: Store,
    ) -> Arc<Self> {
        Arc::new(Self {
            services,
            host,
            store,
            busy: Mutex::new(HashMap::new()),
        })
    }

    /// `database.create` — make a database and the account that reaches it.
    ///
    /// # Errors
    ///
    /// `invalid_argument` for a name that cannot be one, and for a package with no databases;
    /// `not_found` for a service this home does not declare; `conflict` for an account MixEngine
    /// holds no credential for; `precondition_failed` for an instance that will not start.
    pub(crate) async fn create(&self, asked: &DatabaseCreate) -> Result<DatabaseAccount, Error> {
        // Refused before the instance is started, on `blueprint.capture`'s reasoning: a name that
        // was never going to work should not first cost a database server coming up.
        let database = validated_identifier(&asked.database).map_err(|error| error.to_wire())?;
        let user = validated_identifier(asked.user.as_deref().unwrap_or(&database))
            .map_err(|error| error.to_wire())?;
        let password = asked
            .password
            .as_deref()
            .map(mixengine_core::generate::databases::validated_password)
            .transpose()
            .map_err(|error| error.to_wire())?;

        let provisioning = self.vocabulary(&asked.service).await?;

        // Held across the start and the statements — design D10.
        let gate = {
            let mut busy = self.busy.lock().await;

            Arc::clone(
                busy.entry(asked.service.clone())
                    .or_insert_with(|| Arc::new(Mutex::new(()))),
            )
        };
        let _turn = gate.lock().await;

        self.services.ensure_running(&asked.service).await?;

        let ask = Ask { database, user };
        let made = crate::services::databases::ensure(
            &self.host,
            &provisioning,
            &asked.service,
            &ask,
            password,
        )
        .await?;

        Ok(DatabaseAccount {
            service: asked.service.clone(),
            database: ask.database,
            secret: SecretAddress::of(provisioning.secret_address(&ask.user)),
            user: ask.user,
            made,
        })
    }

    /// How this service's databases are made, or which of the two misses it was.
    async fn vocabulary(
        &self,
        service: &ServiceId,
    ) -> Result<mixengine_core::generate::Provisioning, Error> {
        // The graph first, because it is what fills the registry's map: a daemon that has served
        // nothing yet remembers no provisioning for anything.
        let graph = self
            .services
            .graph()
            .await
            .map_err(|error| error.to_wire())?;

        if graph.spec(service).is_none() {
            return Err(mixengine_core::Error::Graph(
                mixengine_core::services::GraphError::NoSuchService {
                    id: service.clone(),
                },
            )
            .to_wire());
        }

        self.services.provisioning_for(service).ok_or_else(|| {
            mixengine_core::Error::NoDatabaseVocabulary {
                package: service.name().to_owned(),
            }
            .to_wire()
        })
    }

    /// `database.client` — where this instance could be opened. Reads only — roadmap task **T83**.
    ///
    /// # Errors
    ///
    /// `not_found` for a service this home does not declare; whatever locating the application
    /// costs on this system.
    pub(crate) async fn client(
        &self,
        asked: &DatabaseClientQuery,
    ) -> Result<DatabaseClientReport, Error> {
        let address = handoff::address(&self.store, &asked.service)
            .await
            .map_err(|error| error.to_wire())?;
        let client = self.locate_client().await?.state;

        // **Composed, not looked up** — roadmap task **T84**, the design's D6. This method still
        // touches the credential store not at all: the address is what the recipe's administrator
        // and the service id say it is, which is exactly what makes the convention askable before
        // anything has been opened.
        let secret = address.as_ref().and_then(|address| {
            address
                .administrator
                .as_deref()
                .map(|user| SecretAddress::of(handoff::secret_key(&asked.service, user)))
        });

        Ok(DatabaseClientReport {
            service: asked.service.clone(),
            protocol: address.map(|address| address.protocol),
            secret,
            client,
        })
    }

    /// `database.credentials` — the password held for one account. Reads only — roadmap task
    /// **T77b**.
    ///
    /// # Errors
    ///
    /// `invalid_argument` for a service no client opens or one with no accounts to read a
    /// password for; `not_found` for a service this home does not declare; `precondition_failed`
    /// for an account — administrator included — MixEngine holds no credential for.
    pub(crate) async fn credentials(
        &self,
        asked: &DatabaseCredentialsQuery,
    ) -> Result<DatabaseCredentials, Error> {
        let user = asked
            .user
            .as_deref()
            .map(validated_identifier)
            .transpose()
            .map_err(|error| error.to_wire())?;

        let address = handoff::address(&self.store, &asked.service)
            .await
            .map_err(|error| error.to_wire())?
            .ok_or_else(|| {
                Error::new(
                    ErrorCode::InvalidArgument,
                    format!("{} is not a database a client opens", asked.service),
                )
            })?;

        if user.is_some() && !address.protocol.has_accounts() {
            return Err(Error::new(
                ErrorCode::InvalidArgument,
                format!("{} has no accounts to sign in as", asked.service),
            )
            .with_hint("leave `--user` off: the server has no account to read a password for"));
        }

        let account = user
            .or_else(|| address.administrator.clone())
            .ok_or_else(|| {
                Error::new(
                    ErrorCode::InvalidArgument,
                    format!("{} has no accounts to sign in as", asked.service),
                )
            })?;

        let at = handoff::secret_key(&asked.service, &account);
        let password = self
            .credential(
                &asked.service,
                &account,
                &at,
                address.administrator.as_deref(),
            )
            .await?;

        Ok(DatabaseCredentials {
            service: asked.service.clone(),
            user: account,
            secret: SecretAddress::of(at),
            password,
        })
    }

    /// `database.open` — hand this instance to the installed desktop client — roadmap task **T83**.
    ///
    /// The order is the design's data flow: validate, address, locate, start, read the credential,
    /// launch. "Not installed" and "no client" come back as states before anything is started, and
    /// the credential is read as late as the order allows.
    ///
    /// # Errors
    ///
    /// `invalid_argument` for a name that cannot be one, a service no client opens, or an account
    /// on a server without accounts; `not_found` for a service this home does not declare;
    /// `precondition_failed` for an instance that will not start or an account MixEngine holds no
    /// credential for; `process_failed` for an application that died within a second of starting.
    pub(crate) async fn open(&self, asked: &DatabaseOpen) -> Result<DatabaseHandoff, Error> {
        let user = asked
            .user
            .as_deref()
            .map(validated_identifier)
            .transpose()
            .map_err(|error| error.to_wire())?;
        let database = asked
            .database
            .as_deref()
            .map(validated_identifier)
            .transpose()
            .map_err(|error| error.to_wire())?;

        let address = handoff::address(&self.store, &asked.service)
            .await
            .map_err(|error| error.to_wire())?
            .ok_or_else(|| {
                Error::new(
                    ErrorCode::InvalidArgument,
                    format!("{} is not a database a desktop client opens", asked.service),
                )
            })?;

        if user.is_some() && !address.protocol.has_accounts() {
            return Err(Error::new(
                ErrorCode::InvalidArgument,
                format!("{} has no accounts to sign in as", asked.service),
            )
            .with_hint("leave `--user` off: the client connects without one"));
        }

        let located = self.locate_client().await?;
        let (Some(app), Some(scheme)) = (located.app, located.scheme) else {
            return Ok(DatabaseHandoff {
                service: asked.service.clone(),
                protocol: address.protocol,
                user: None,
                database,
                secret: None,
                client: located.state,
                launched: None,
            });
        };
        let client = located.state;

        self.services.ensure_running(&asked.service).await?;

        let account = user.or_else(|| address.administrator.clone());
        let (secret, env) = match &account {
            Some(account) => {
                // The shared composition — roadmap task **T84**. The recipe that wrote this entry
                // and the handoff that reads it name one function, so the two cannot drift.
                let at = handoff::secret_key(&asked.service, account);
                let password = self
                    .credential(
                        &asked.service,
                        account,
                        &at,
                        address.administrator.as_deref(),
                    )
                    .await?;
                (
                    Some(SecretAddress::of(at)),
                    BTreeMap::from([(CREDENTIAL_ENV.to_owned(), password)]),
                )
            }
            None => (None, BTreeMap::new()),
        };

        let url = handoff::url(&Connection {
            scheme: &scheme,
            label: asked.service.as_str(),
            address: &address,
            user: account.as_deref(),
            database: database.as_deref(),
            secret_key: secret.as_ref().map(|at| at.key.as_str()),
        });

        let launched = self.launch(&app, url, env).await?;

        Ok(DatabaseHandoff {
            service: asked.service.clone(),
            protocol: address.protocol,
            user: account,
            database,
            secret,
            client,
            launched: Some(launched),
        })
    }

    /// The first installed `desktop-app` extension, by id, with the body already unwrapped.
    async fn desktop_extension(&self) -> Result<Option<(Installed, DesktopApp)>, Error> {
        let installed = extension_store::all(&self.store)
            .await
            .map_err(|error| error.to_wire())?;

        Ok(installed
            .into_iter()
            .find_map(|one| match &one.manifest.body {
                Body::DesktopApp(app) => {
                    let app = app.clone();
                    Some((one, app))
                }
                _ => None,
            }))
    }

    /// The client as a state, how to start it, and the scheme it reads — roadmap task **T107**.
    ///
    /// **The window answers first, and the condition is the scheme.** MixLab is MixEngine's client
    /// *for `mixdb://`*: on a machine that also has standalone MixDB it is the one MixEngine
    /// installs, updates and supports, and after this phase `mixnz/mixdb` is archived. But
    /// `desktop-app` is a general mechanism, and an entry naming some other client for some other
    /// scheme must not be shadowed by a window that cannot read its URLs — so the window answers
    /// when there is no extension, or when the installed one's scheme is the window's own.
    ///
    /// **One read of the store and not two.** `scheme()` used to be a second read, with an
    /// `Internal` error for *the desktop client vanished between two reads* standing in for the race
    /// between them; the client is resolved once here and the race is gone with it.
    async fn locate_client(&self) -> Result<Client, Error> {
        let extension = self.desktop_extension().await?;
        let ours = extension
            .as_ref()
            .is_none_or(|(_, app)| app.scheme == window::SCHEME);

        if ours && let Located::Installed(app) = self.locate_window().await? {
            return Ok(Client {
                state: DesktopClient::Installed {
                    extension: None,
                    name: window::NAME.to_owned(),
                    program: app.program.display().to_string(),
                },
                app: Some(app),
                scheme: Some(window::SCHEME.to_owned()),
            });
        }

        let Some((installed, app)) = extension else {
            return Ok(Client {
                state: DesktopClient::NoClient,
                app: None,
                scheme: None,
            });
        };
        let id = installed.id.clone();
        let name = installed.name().to_owned();
        let homepage = installed.manifest.extension.homepage.clone();

        let Some(hint) = app.detect.here().map(str::to_owned) else {
            return Ok(Client {
                state: DesktopClient::NotInstalled {
                    extension: id,
                    name,
                    searched: format!(
                        "nowhere — the manifest names no way to find it on {}",
                        std::env::consts::OS
                    ),
                    homepage,
                },
                app: None,
                scheme: None,
            });
        };

        // Off the runtime: a registry walk, a Spotlight query.
        let host = Arc::clone(&self.host);
        let located = tokio::task::spawn_blocking(move || host.desktop_apps().locate(&hint))
            .await
            .map_err(|_| {
                Error::new(
                    ErrorCode::Internal,
                    "the task locating the client did not finish".to_owned(),
                )
            })?
            .map_err(|error| error.to_wire())?;

        Ok(match located {
            Located::Installed(found) => Client {
                state: DesktopClient::Installed {
                    extension: Some(id),
                    name,
                    program: found.program.display().to_string(),
                },
                app: Some(found),
                scheme: Some(app.scheme),
            },
            Located::NotInstalled { searched } => Client {
                state: DesktopClient::NotInstalled {
                    extension: id,
                    name,
                    searched,
                    homepage,
                },
                app: None,
                scheme: None,
            },
        })
    }

    /// This install's own window, off the runtime — roadmap task **T107**.
    ///
    /// A handful of `stat`s rather than a registry walk, and still through `spawn_blocking`: the two
    /// lookups are asked the same way because a caller reading this should not have to know which of
    /// them is cheap this month.
    async fn locate_window(&self) -> Result<Located, Error> {
        let host = Arc::clone(&self.host);

        tokio::task::spawn_blocking(move || {
            host.desktop_apps()
                .locate_window(window::EXECUTABLE, window::BUNDLE)
        })
        .await
        .map_err(|_| {
            Error::new(
                ErrorCode::Internal,
                "the task locating the window did not finish".to_owned(),
            )
        })?
        .map_err(|error| error.to_wire())
    }

    /// The account's password, read now — the moment of the handoff and no earlier.
    async fn credential(
        &self,
        service: &ServiceId,
        account: &str,
        at: &str,
        administrator: Option<&str>,
    ) -> Result<String, Error> {
        crate::services::databases::read(&self.host, at)
            .await?
            .ok_or_else(|| {
                if Some(account) == administrator {
                    Error::new(
                        ErrorCode::PreconditionFailed,
                        format!("{service} has no superuser credential in this machine's keyring"),
                    )
                    .with_hint(
                        "that password is written by the service's first run — `mix service \
                         start` performs it",
                    )
                } else {
                    Error::new(
                        ErrorCode::PreconditionFailed,
                        format!("MixEngine holds no credential for `{account}` on {service}"),
                    )
                    .with_hint(format!(
                        "`mix database create {service} --name <database> --user {account}` \
                         makes one"
                    ))
                }
            })
    }

    /// Start the client, off the runtime, and judge it — the design's D8.
    async fn launch(
        &self,
        app: &InstalledApp,
        url: String,
        env: BTreeMap<String, String>,
    ) -> Result<Launch, Error> {
        let host = Arc::clone(&self.host);
        let app = app.clone();
        let program = app.program.display().to_string();

        let started = tokio::task::spawn_blocking(move || {
            host.desktop_apps()
                .launch(&app, &[std::ffi::OsString::from(url)], &env)
        })
        .await
        .map_err(|_| {
            Error::new(
                ErrorCode::Internal,
                "the task starting the client did not finish".to_owned(),
            )
        })?
        .map_err(|error| error.to_wire())?;

        match started {
            Started::Running { pid } => Ok(Launch::Running { pid }),
            Started::HandedOn => Ok(Launch::HandedOn),
            Started::Failed { status } => Err(Error::new(
                ErrorCode::ProcessFailed,
                format!("the client exited a moment after it was started ({status})"),
            )
            .with_hint(format!("run it by hand to read what it says: {program}"))),
        }
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use mixengine_core::extensions::store::{Installed, Source, remember};
    use mixengine_platform::mock::Host as MockHost;
    use mixengine_platform::{Host as _, KEYRING_SERVICE};
    use mixengine_proto::{
        DatabaseClientQuery, DatabaseOpen, DatabaseProtocol, DesktopClient, ErrorCode, ExtensionId,
        Launch, ServiceId, Timestamp,
    };

    use super::*;
    use crate::services::fixture;

    fn id(text: &str) -> ServiceId {
        ServiceId::parse(text).expect("an id")
    }

    /// A home with the given database rows, a fakeservice declared under each id, on `host`.
    async fn databases(
        host: Arc<MockHost>,
        rows: &[(&str, &str, i64)],
    ) -> (mixengine_testkit::Home, Arc<Databases>) {
        let (home, paths, store) = fixture::home(&[]).await;

        for (service, package, port) in rows {
            let instance = service.split('@').nth(1).unwrap_or("main");
            let package_id: i64 = sqlx::query_scalar(
                "INSERT INTO packages (name, version, install_path, installed_at, source_url, sha256)
                 VALUES (?, '1.0.0', '/packages/x', '2026-09-03T00:00:00Z', 'https://example', 'ab')
                 ON CONFLICT (name, version) DO UPDATE SET name = excluded.name RETURNING id",
            )
            .bind(package)
            .fetch_one(store.pool())
            .await
            .expect("a package row");

            sqlx::query(
                "INSERT INTO services (id, package_id, instance_name, state, port, bind_addr)
                 VALUES (?, ?, ?, 'stopped', ?, '127.0.0.1')",
            )
            .bind(service)
            .bind(package_id)
            .bind(instance)
            .bind(port)
            .execute(store.pool())
            .await
            .expect("a service row");
        }

        let specs = rows
            .iter()
            .map(|(service, _, _)| fixture::spec(service).build().expect("a spec"))
            .collect();
        let services = Arc::new(fixture::registry_on(
            &paths,
            &store,
            Arc::new(fixture::Declared(specs)),
            Arc::clone(&host) as Arc<dyn mixengine_platform::Host>,
        ));

        (home, Databases::new(services, host, store))
    }

    /// The MixDB fixture, installed from a directory.
    async fn a_mixdb(store: &Store) {
        let manifest = mixengine_core::extensions::manifest::read(
            std::path::Path::new("extension.toml"),
            mixengine_testkit::extension::MIXDB,
        )
        .expect("the fixture parses");

        remember(
            store,
            &Installed {
                id: ExtensionId::parse("mixdb").expect("an id"),
                manifest,
                install_dir: std::path::PathBuf::from("/extensions/mixdb"),
                data_dir: std::path::PathBuf::from("/data/extensions/mixdb"),
                source: Source::Path,
                signed: false,
                installed_at: Timestamp(0),
                ports: BTreeMap::new(),
            },
        )
        .await
        .expect("the row");
    }

    /// The same fixture reading a scheme of its own — roadmap task **T107**.
    ///
    /// One string apart from [`a_mixdb`], because one string is the whole of what the ordering rule
    /// turns on: the window answers for its own scheme and stands aside for any other.
    async fn a_desktop_app(store: &Store, id: &str, scheme: &str) {
        let body = mixengine_testkit::extension::MIXDB
            .replace("id = \"mixdb\"", &format!("id = \"{id}\""))
            .replace("scheme = \"mixdb\"", &format!("scheme = \"{scheme}\""));
        let manifest = mixengine_core::extensions::manifest::read(
            std::path::Path::new("extension.toml"),
            &body,
        )
        .expect("the fixture parses");

        remember(
            store,
            &Installed {
                id: ExtensionId::parse(id).expect("an id"),
                manifest,
                install_dir: std::path::PathBuf::from("/extensions/other"),
                data_dir: std::path::PathBuf::from("/data/extensions/other"),
                source: Source::Path,
                signed: false,
                installed_at: Timestamp(0),
                ports: BTreeMap::new(),
            },
        )
        .await
        .expect("the row");
    }

    fn open(service: &str, user: Option<&str>, database: Option<&str>) -> DatabaseOpen {
        DatabaseOpen {
            service: id(service),
            user: user.map(str::to_owned),
            database: database.map(str::to_owned),
        }
    }

    /// No `desktop-app` extension is a state, to both methods, and nothing is started for it.
    #[tokio::test]
    async fn with_no_desktop_app_extension_the_answer_is_no_client() {
        let host = Arc::new(MockHost::with_home(std::env::temp_dir()));
        let (_home, databases) = databases(host, &[("redis@main", "redis", 6379)]).await;

        let report = databases
            .client(&DatabaseClientQuery {
                service: id("redis@main"),
            })
            .await
            .expect("answers");
        assert_eq!(report.protocol, Some(DatabaseProtocol::Redis));
        assert_eq!(report.client, DesktopClient::NoClient);

        let handoff = databases
            .open(&open("redis@main", None, None))
            .await
            .expect("a state");
        assert_eq!(handoff.client, DesktopClient::NoClient);
        assert_eq!(handoff.launched, None);
    }

    /// **The merged product's client, on a machine that never had MixDB** — roadmap task **T107**.
    /// No extension is installed, and `mix database open` still lands somewhere.
    #[tokio::test]
    async fn the_window_is_the_client_when_no_extension_is_installed() {
        let host = Arc::new(MockHost::with_window(
            std::env::temp_dir(),
            "/opt/mixengine/mixlab",
        ));
        let (_home, databases) = databases(host, &[("redis@main", "redis", 6379)]).await;

        let report = databases
            .client(&DatabaseClientQuery {
                service: id("redis@main"),
            })
            .await
            .expect("answers");

        match report.client {
            DesktopClient::Installed {
                extension,
                name,
                program,
            } => {
                assert_eq!(extension, None, "the window is not an extension");
                assert_eq!(name, mixengine_core::window::NAME);
                assert!(program.contains("mixlab"), "{program}");
            }
            other => panic!("{other:?}"),
        }
    }

    /// **The window wins over a standalone MixDB.** A MixDB user who installs MixEngine has both;
    /// the one MixEngine installs, updates and supports is the one a database opens in.
    #[tokio::test]
    async fn the_window_answers_before_the_mixdb_extension() {
        let host = Arc::new(MockHost::with_window_and_desktop_app(
            std::env::temp_dir(),
            "/opt/mixengine/mixlab",
            "/opt/mixdb/mixdb",
        ));
        let (_home, databases) = databases(host, &[("redis@main", "redis", 6379)]).await;
        a_mixdb(&databases.store).await;

        match databases
            .client(&DatabaseClientQuery {
                service: id("redis@main"),
            })
            .await
            .expect("answers")
            .client
        {
            DesktopClient::Installed { name, .. } => {
                assert_eq!(name, mixengine_core::window::NAME);
            }
            other => panic!("{other:?}"),
        }
    }

    /// **A client for some other scheme is not shadowed.** `desktop-app` is a general mechanism, and
    /// the window is MixEngine's client for `mixdb://` and for nothing else — roadmap task **T107**.
    #[tokio::test]
    async fn an_extension_for_another_scheme_still_answers() {
        let host = Arc::new(MockHost::with_window_and_desktop_app(
            std::env::temp_dir(),
            "/opt/mixengine/mixlab",
            "/opt/elsewhere/elsewhere",
        ));
        let (_home, databases) = databases(host, &[("redis@main", "redis", 6379)]).await;
        a_desktop_app(&databases.store, "elsewhere", "elsewhere").await;

        match databases
            .client(&DatabaseClientQuery {
                service: id("redis@main"),
            })
            .await
            .expect("answers")
            .client
        {
            DesktopClient::Installed { extension, .. } => {
                assert_eq!(
                    extension.as_ref().map(ExtensionId::as_str),
                    Some("elsewhere"),
                    "the extension named this client"
                );
            }
            other => panic!("{other:?}"),
        }
    }

    /// The URL a window handoff produces carries the window's own scheme, and it is the window that
    /// is started — T83's rule, on the new path.
    #[tokio::test]
    async fn a_window_handoff_carries_the_scheme_and_starts_the_window() {
        let host = Arc::new(MockHost::with_window(
            std::env::temp_dir(),
            "/opt/mixengine/mixlab",
        ));
        let (_home, databases) =
            databases(Arc::clone(&host), &[("redis@main", "redis", 6379)]).await;

        let handoff = databases
            .open(&open("redis@main", None, None))
            .await
            .expect("opened");
        assert_eq!(handoff.launched, Some(Launch::Running { pid: 4242 }));

        let launched = host.launched();
        assert_eq!(launched.len(), 1, "{launched:?}");
        assert!(
            launched[0].program.ends_with("mixlab"),
            "{:?}",
            launched[0].program
        );
        let url = launched[0]
            .args
            .last()
            .expect("the URL")
            .to_string_lossy()
            .into_owned();
        assert!(
            url.starts_with(&format!("{}://connect?", mixengine_core::window::SCHEME)),
            "{url}"
        );
    }

    /// The extension without the application is the other state, and it says where it looked and
    /// where to get it.
    #[tokio::test]
    async fn an_extension_without_the_application_is_not_installed_and_names_where_it_looked() {
        let host = Arc::new(MockHost::with_home(std::env::temp_dir()));
        let (_home, databases) = databases(host, &[("redis@main", "redis", 6379)]).await;
        a_mixdb(&databases.store).await;

        let report = databases
            .client(&DatabaseClientQuery {
                service: id("redis@main"),
            })
            .await
            .expect("answers");

        match report.client {
            DesktopClient::NotInstalled {
                extension,
                name,
                searched,
                homepage,
            } => {
                assert_eq!(extension.as_str(), "mixdb");
                assert_eq!(name, "MixDB");
                assert!(!searched.is_empty());
                assert_eq!(homepage.as_deref(), Some("https://github.com/mixnz/mixdb"));
            }
            other => panic!("{other:?}"),
        }
    }

    /// A service no client opens: `protocol: null` to `client`, a refusal by name to `open` — the
    /// T77a distinction between the package and the operating system.
    #[tokio::test]
    async fn a_cache_with_no_protocol_is_a_state_to_client_and_a_refusal_to_open() {
        let host = Arc::new(MockHost::with_home(std::env::temp_dir()));
        let (_home, databases) = databases(host, &[("memcached@main", "memcached", 11211)]).await;

        let report = databases
            .client(&DatabaseClientQuery {
                service: id("memcached@main"),
            })
            .await
            .expect("answers");
        assert_eq!(report.protocol, None);

        let refused = databases
            .open(&open("memcached@main", None, None))
            .await
            .expect_err("refused");
        assert_eq!(refused.code, ErrorCode::InvalidArgument);
        assert!(
            refused.message.contains("memcached@main"),
            "{}",
            refused.message
        );
    }

    /// A server with no accounts is handed over with no variable at all, and refuses `--user`.
    #[tokio::test]
    async fn a_redis_is_opened_with_no_account_and_no_variable() {
        let host = Arc::new(MockHost::with_desktop_app(
            std::env::temp_dir(),
            "/opt/mixdb/mixdb",
        ));
        let (_home, databases) =
            databases(Arc::clone(&host), &[("redis@main", "redis", 6379)]).await;
        a_mixdb(&databases.store).await;

        let handoff = databases
            .open(&open("redis@main", None, None))
            .await
            .expect("opened");
        assert_eq!(handoff.launched, Some(Launch::Running { pid: 4242 }));
        assert_eq!(handoff.secret, None);

        let launched = host.launched();
        assert_eq!(launched.len(), 1);
        let url = launched[0]
            .args
            .last()
            .expect("the URL")
            .to_string_lossy()
            .into_owned();
        assert!(
            url.starts_with("mixdb://connect?kind=redis&host=127.0.0.1&port=6379"),
            "{url}"
        );
        assert!(!url.contains("password"), "{url}");
        // A server with no accounts has no entry to point a saved connection at — T84.
        assert!(!url.contains("secret_key"), "{url}");
        assert!(launched[0].env_names.is_empty());

        let refused = databases
            .open(&open("redis@main", Some("x"), None))
            .await
            .expect_err("no accounts");
        assert_eq!(refused.code, ErrorCode::InvalidArgument);
    }

    /// **The design's D2, at the daemon.** The password is in the environment under the one name
    /// and nowhere in the URL; a missing credential is a precondition and starts nothing.
    #[tokio::test]
    async fn a_database_is_opened_with_the_credential_in_the_environment_and_not_the_url() {
        let host = Arc::new(MockHost::with_desktop_app(
            std::env::temp_dir(),
            "/opt/mixdb/mixdb",
        ));
        let (_home, databases) =
            databases(Arc::clone(&host), &[("mariadb@main", "mariadb", 3306)]).await;
        a_mixdb(&databases.store).await;

        // **`client` says where the credential is, and reads nothing to find out** — roadmap task
        // **T84**, the design's D6. Asked before anything has been stored, so an answer here can
        // only have been composed.
        let report = databases
            .client(&DatabaseClientQuery {
                service: id("mariadb@main"),
            })
            .await
            .expect("a report");
        let at = report.secret.as_ref().expect("an address");
        assert_eq!(at.service, KEYRING_SERVICE);
        assert_eq!(at.key, "mariadb@main/root");

        let missing = databases
            .open(&open("mariadb@main", None, None))
            .await
            .expect_err("no credential yet");
        assert_eq!(missing.code, ErrorCode::PreconditionFailed);
        assert!(host.launched().is_empty());

        host.keyring()
            .set_secret(KEYRING_SERVICE, "mariadb@main/root", "s3cret-value")
            .expect("stored");

        let handoff = databases
            .open(&open("mariadb@main", None, Some("blog")))
            .await
            .expect("opened");
        let at = handoff.secret.as_ref().expect("an address");
        assert_eq!(at.service, mixengine_platform::KEYRING_SERVICE);
        assert_eq!(at.key, "mariadb@main/root");
        assert_eq!(handoff.user.as_deref(), Some("root"));

        let launched = host.launched();
        let url = launched[0]
            .args
            .last()
            .expect("the URL")
            .to_string_lossy()
            .into_owned();
        assert!(
            url.contains(
                "kind=mysql&host=127.0.0.1&port=3306&user=root&database=blog\
                 &label=mariadb%40main&password_env=MIXENGINE_DB_PASSWORD\
                 &secret_key=mariadb%40main%2Froot"
            ),
            "{url}"
        );
        assert!(!url.contains("s3cret"), "{url}");
        // **The key travels, the namespace does not** — roadmap task **T84**, the design's D5.
        assert!(!url.contains(KEYRING_SERVICE), "{url}");
        assert_eq!(
            launched[0].env_names,
            vec!["MIXENGINE_DB_PASSWORD".to_owned()]
        );

        let named = databases
            .open(&open("mariadb@main", Some("blog"), None))
            .await
            .expect_err("no such account of ours");
        assert_eq!(named.code, ErrorCode::PreconditionFailed);
        assert!(named.message.contains("blog"), "{}", named.message);
    }

    fn credentials_query(service: &str, user: Option<&str>) -> DatabaseCredentialsQuery {
        DatabaseCredentialsQuery {
            service: id(service),
            user: user.map(str::to_owned),
        }
    }

    /// **The administrator by default** — roadmap task **T77b** — exactly as `database.open`'s own
    /// default: the two commands answer the same question for a process and for a person.
    #[tokio::test]
    async fn credentials_defaults_to_the_administrator() {
        let host = Arc::new(MockHost::with_home(std::env::temp_dir()));
        host.keyring()
            .set_secret(KEYRING_SERVICE, "mariadb@main/root", "root-secret")
            .expect("the mock store takes it");
        let (_home, databases) =
            databases(Arc::clone(&host), &[("mariadb@main", "mariadb", 3306)]).await;

        let answer = databases
            .credentials(&credentials_query("mariadb@main", None))
            .await
            .expect("answers");

        assert_eq!(answer.user, "root");
        assert_eq!(answer.password, "root-secret");
        assert_eq!(answer.secret.key, "mariadb@main/root");
    }

    /// A named account with no entry is the same refusal `database.open` already gives, with the
    /// same hint pointing at `database create`.
    #[tokio::test]
    async fn credentials_for_an_account_with_no_entry_is_precondition_failed() {
        let host = Arc::new(MockHost::with_home(std::env::temp_dir()));
        let (_home, databases) =
            databases(Arc::clone(&host), &[("mariadb@main", "mariadb", 3306)]).await;

        let error = databases
            .credentials(&credentials_query("mariadb@main", Some("blog")))
            .await
            .expect_err("no entry for blog yet");

        assert_eq!(error.code, ErrorCode::PreconditionFailed);
    }

    /// A service with no accounts refuses by name, as `database.open --user` already does.
    #[tokio::test]
    async fn credentials_on_a_service_with_no_accounts_is_invalid_argument() {
        let host = Arc::new(MockHost::with_home(std::env::temp_dir()));
        let (_home, databases) =
            databases(Arc::clone(&host), &[("redis@main", "redis", 6379)]).await;

        let error = databases
            .credentials(&credentials_query("redis@main", None))
            .await
            .expect_err("redis has no accounts");

        assert_eq!(error.code, ErrorCode::InvalidArgument);
    }
}
