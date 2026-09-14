//! A home the way an install leaves one, and the shim binary sitting in its `bin/`.
//!
//! It lives here rather than in `mixengine-testkit` for the reason the CLI's own harness gives:
//! none of it is about MixEngine, it is about *this* suite — a fake runtime unpacked where
//! `provides` says it is, and `bin/` filled through the product's own [`shims::refresh`] so that
//! the `php` these tests run is the file a daemon start would have put there.
//!
//! **No `MIXENGINE_HOME` is ever set in this process.** Every case sets it on the child's own
//! `Command`, which is what `.claude/standards/testing.md` requires and what lets these run in
//! parallel: `std::env::set_var` is process-global, and two homes in one binary would overwrite
//! each other.

// Each integration test binary compiles this module separately, so anything `shim.rs` uses and
// `overhead.rs` does not is dead code in one of them. The alternative is two fixtures that build a
// home slightly differently, which is the one thing a benchmark and the suite it is measured
// against must not have.
#![allow(dead_code)]

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};

use mixengine_core::runtimes::Installation;
use mixengine_core::{Store, paths, runtimes, shims};
use mixengine_proto::{PackageChannel, PackageVersion, RuntimeKind, ServiceId, Timestamp};

/// A fixed moment: nothing here asserts on time, and a fixture that read the clock would be one
/// more thing that can differ between two runs.
const NOW: Timestamp = Timestamp(1_760_000_000_000);

/// Where inside an install directory the fake runtime's program sits.
///
/// Nested rather than at the root, because that is the shape the Unix artifacts have and it is the
/// one that would break a shim which assumed the executable is the directory itself.
pub(crate) fn published_at() -> String {
    format!("bin/php{}", std::env::consts::EXE_SUFFIX)
}

/// A home with runtimes installed in it, and a `bin/` holding the shim under a real command name.
pub(crate) struct Home {
    root: tempfile::TempDir,
}

impl Home {
    /// A home holding one PHP per version named, the first of them the default — which is what
    /// installing them in this order really does.
    pub(crate) fn with(versions: &[&str]) -> Self {
        let root = tempfile::tempdir().expect("a temporary home");
        let home = Self { root };

        let database = home.path().join(paths::DATABASE_FILE_NAME);
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("a runtime for the fixture's own writes");

        runtime.block_on(async {
            let store = Store::open(&database).await.expect("a database");

            for version in versions {
                let directory = home.runtime_directory(version);
                home.unpack_a_fake_runtime(&directory);

                runtimes::remember(
                    &store,
                    &Installation {
                        kind: RuntimeKind::Php,
                        version: PackageVersion::parse(*version).expect("a version"),
                        channel: PackageChannel::Stable,
                        path: directory,
                        bytes: 41_000_000,
                        url: format!("https://example.invalid/php-{version}.tar.zst"),
                        sha256: "00".to_owned(),
                        provides: [("php".to_owned(), published_at())].into_iter().collect(),
                        extension_dir: None,
                        extensions: mixengine_core::index::Extensions::default(),
                    },
                    NOW,
                )
                .await
                .expect("a row");
            }

            // Closed rather than dropped, so the write-ahead log is checkpointed and the `-shm`
            // file goes: a shim opening the database read-only afterwards is the case that has to
            // work on a machine where no daemon has run since the last reboot.
            store.close().await;
        });

        home.fill_bin();
        home
    }

    pub(crate) fn path(&self) -> &Path {
        self.root.path()
    }

    pub(crate) fn runtime_directory(&self, version: &str) -> PathBuf {
        self.path().join("runtimes").join("php").join(version)
    }

    /// What an install would have left on disk: the program, where `provides` says it is.
    fn unpack_a_fake_runtime(&self, directory: &Path) {
        let program = directory.join(published_at());
        std::fs::create_dir_all(program.parent().expect("a bin directory")).expect("a directory");

        // Copied rather than linked, and one copy per version, because the whole question is which
        // of two identical programs ran — the answer is the path it ran from.
        std::fs::copy(mixengine_testkit::package::executable_source(), &program).unwrap_or_else(
            |error| panic!("copy the fake runtime to {}: {error}", program.display()),
        );
    }

    /// Fill `bin/` the way a daemon start does — **through the product's own function**.
    ///
    /// Roadmap task T26. It used to copy one file under one name, which proved the shim reads
    /// `argv[0]` and proved nothing whatever about how a real `bin/` comes to exist. Going through
    /// [`shims::refresh`] is what makes this suite the end-to-end claim of Phase 2's milestone
    /// rather than half of it: the directory a person's PATH points at is filled by the code that
    /// fills it, and the `php` run below is the file that code put there.
    pub(crate) fn fill_bin(&self) -> shims::Refreshed {
        self.fill_bin_also_fronting(&[])
    }

    /// The same, plus names nothing in this home claims.
    ///
    /// For the one case that has to exist: a copy left in `bin/` after whatever put it there was
    /// uninstalled, which is the state a person meets in the moment between removing a database
    /// and the next refresh.
    pub(crate) fn front(&self, name: &str) {
        self.fill_bin_also_fronting(&[name]);
    }

    fn fill_bin_also_fronting(&self, names: &[&str]) -> shims::Refreshed {
        let mut extra = self.client_extras();

        extra.extend(names.iter().map(|name| shims::Extra {
            name: (*name).to_owned(),
            origin: shims::Origin::Global {
                kind: RuntimeKind::Node,
            },
        }));

        shims::refresh(
            &self.path().join("bin"),
            Path::new(env!("CARGO_BIN_EXE_mixengine-shim")),
            &extra,
        )
        .expect("bin/ can be filled in a temporary home")
    }

    /// The client commands of the installed service packages — roadmap task **T130**.
    ///
    /// **The daemon's own walk**, through the same two functions `crate::shims::Shims::extras` uses,
    /// for [`fill_bin`](Self::fill_bin)'s reason one step further along: what this suite claims is
    /// that a name a person can type is a name the shim then resolves, and a fixture that composed
    /// `bin/` by hand would be asserting only the second half of that.
    fn client_extras(&self) -> Vec<shims::Extra> {
        let database = self.path().join(paths::DATABASE_FILE_NAME);

        if !database.is_file() {
            return Vec::new();
        }

        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("a runtime for the fixture's own reads");

        runtime.block_on(async {
            let store = Store::open(&database).await.expect("a database");
            let catalogue = mixengine_core::generate::Catalogue::builtin();

            let claims = mixengine_core::services::client::claims(&store, &catalogue, None)
                .await
                .expect("the installed rows can be read");

            store.close().await;

            shims::resolve_claims(&claims).0
        })
    }

    /// A service package on disk and in the database, optionally with one instance of it.
    ///
    /// `provides` is the artifact's own map — the keys are MixEngine's names and the values are
    /// wherever the publisher put the file — and every value becomes a copy of the recording
    /// program, so a command that reaches one can say which file it was and what it was told.
    pub(crate) fn install_package(
        &self,
        package: &str,
        version: &str,
        provides: &[(&str, &str)],
        instance: Option<(&str, u16)>,
    ) {
        let directory = self.path().join("packages").join(package).join(version);

        let provides: BTreeMap<String, String> = provides
            .iter()
            .map(|(name, at)| ((*name).to_owned(), (*at).to_owned()))
            .collect();

        for published in provides.values() {
            let program = directory.join(published);
            std::fs::create_dir_all(program.parent().expect("a directory")).expect("a directory");
            std::fs::copy(mixengine_testkit::package::executable_source(), &program)
                .unwrap_or_else(|error| panic!("copy to {}: {error}", program.display()));
        }

        let database = self.path().join(paths::DATABASE_FILE_NAME);
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("a runtime for the fixture's own writes");

        runtime.block_on(async {
            let store = Store::open(&database).await.expect("a database");

            mixengine_core::packages::remember(
                &store,
                &mixengine_core::packages::Installation {
                    package: package.to_owned(),
                    version: PackageVersion::parse(version).expect("a version"),
                    path: directory.clone(),
                    bytes: 41_000_000,
                    url: format!("https://example.invalid/{package}-{version}.tar.zst"),
                    sha256: "00".to_owned(),
                    provides,
                },
                NOW,
            )
            .await
            .expect("a packages row");

            store.close().await;
        });

        if let Some((id, port)) = instance {
            self.instantiate(package, version, id, port);
        }

        self.fill_bin();
    }

    /// One more instance of an already-installed package, on a port this test chose.
    ///
    /// **[`Port::Fixed`] and never [`Port::Allocate`]**, which is what keeps this suite honest on a
    /// busy machine: allocation asks the operating system whether a number is free, and whether
    /// 3307 is free is a property of the machine rather than of MixEngine
    /// (`.claude/standards/testing.md`). What these cases assert is which *row* a command resolves
    /// to, and a row is a row whether or not anything is listening on it.
    pub(crate) fn instantiate(&self, package: &str, version: &str, id: &str, port: u16) {
        let database = self.path().join(paths::DATABASE_FILE_NAME);
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("a runtime for the fixture's own writes");

        runtime.block_on(async {
            let store = Store::open(&database).await.expect("a database");

            mixengine_core::services::create(
                &store,
                mixengine_platform::host().as_ref(),
                &mixengine_core::services::Declaration {
                    service: ServiceId::parse(id).expect("a service id"),
                    origin: mixengine_core::services::Origin::Package {
                        name: package.to_owned(),
                        version: PackageVersion::parse(version).expect("a version"),
                    },
                    instance_name: id.to_owned(),
                    port: mixengine_core::services::Port::Fixed(port),
                    bind_addr: None,
                    data_dir: None,
                    autostart: false,
                    overrides: "{}".to_owned(),
                },
            )
            .await
            .expect("a services row");

            store.close().await;
        });

        self.fill_bin();
    }

    /// Another language installed beside the PHPs, publishing what its real artifact publishes.
    ///
    /// Not a second fixture but a method on this one, because what it is here to exercise is a home
    /// with **more than one** language in it: `bin/` is one directory holding shims for all of them,
    /// and a `node` row must not change what `php` resolves to.
    pub(crate) fn install(
        &self,
        kind: RuntimeKind,
        version: &str,
        provides: BTreeMap<String, String>,
    ) {
        let directory = self
            .path()
            .join("runtimes")
            .join(kind.as_str())
            .join(version);

        for published in provides.values() {
            let program = directory.join(published);
            std::fs::create_dir_all(program.parent().expect("a directory")).expect("a directory");
            if program.extension().is_some_and(|kind| kind == "cmd") {
                continue; // written by the case that wants one, since its contents are the point
            }
            std::fs::copy(mixengine_testkit::package::executable_source(), &program)
                .unwrap_or_else(|error| panic!("copy to {}: {error}", program.display()));
        }

        let database = self.path().join(paths::DATABASE_FILE_NAME);
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("a runtime for the fixture's own writes");

        runtime.block_on(async {
            let store = Store::open(&database).await.expect("a database");
            runtimes::remember(
                &store,
                &Installation {
                    kind,
                    version: PackageVersion::parse(version).expect("a version"),
                    channel: PackageChannel::Stable,
                    path: directory,
                    bytes: 37_000_000,
                    url: format!("https://example.invalid/{}-{version}.zip", kind.as_str()),
                    sha256: "00".to_owned(),
                    provides,
                    extension_dir: None,
                    extensions: mixengine_core::index::Extensions::default(),
                },
                NOW,
            )
            .await
            .expect("a row");
            store.close().await;
        });
    }

    /// A project directory under this home's temporary root, with the manifest it pins with.
    pub(crate) fn project(&self, name: &str, manifest: Option<&str>) -> PathBuf {
        let directory = self.path().join("projects").join(name);
        std::fs::create_dir_all(&directory).expect("a project directory");

        if let Some(body) = manifest {
            std::fs::write(directory.join("mixengine.toml"), body).expect("a manifest");
        }

        directory
    }

    /// The shim in `bin/` that answers to `command`, as a path a `Command` can be built from.
    pub(crate) fn shim(&self, command: &str) -> PathBuf {
        self.path()
            .join("bin")
            .join(format!("{command}{}", std::env::consts::EXE_SUFFIX))
    }

    /// Run `bin/php` from `cwd` and have the program it becomes write down what it was handed.
    ///
    /// **`--touch` is load-bearing rather than decoration.** `fakeservice --dump-env` records the
    /// environment and then goes on to *be a service*, which in a test is not a failure but a hang;
    /// the touch file is what makes it a one-shot, and it doubles as the proof that the arguments
    /// reached the program at all. Every case that expects a program to run goes through here so
    /// that none of them can forget it.
    pub(crate) fn record(
        &self,
        cwd: &Path,
        session: &BTreeMap<&str, String>,
        exit_code: i32,
    ) -> Recorded {
        self.record_command("php", cwd, session, exit_code)
    }

    /// The same for a command that is not `php`, which is what a home with a second language in it
    /// needs: the recording is about the shim and not about PHP.
    pub(crate) fn record_command(
        &self,
        command: &str,
        cwd: &Path,
        session: &BTreeMap<&str, String>,
        exit_code: i32,
    ) -> Recorded {
        let dump = cwd.join(format!("environment-{command}.txt"));
        let touched = cwd.join(format!("ran-{command}.txt"));

        let run = self.run_with(
            command,
            cwd,
            &[
                "--dump-env",
                &dump.display().to_string(),
                "--touch",
                &touched.display().to_string(),
                "--exit-code",
                &exit_code.to_string(),
            ],
            session,
        );

        // A run that refused has no dump to read, and reading one would fail on the file rather
        // than on the assertion the case is about.
        let reached = touched.is_file();

        Recorded {
            environment: if reached {
                dumped(&dump)
            } else {
                BTreeMap::new()
            },
            reached,
            run,
        }
    }

    /// The same, with variables the user's session would have exported.
    pub(crate) fn run_with(
        &self,
        command: &str,
        cwd: &Path,
        arguments: &[&str],
        environment: &BTreeMap<&str, String>,
    ) -> Run {
        let shim = self.shim(command);

        let output = Command::new(&shim)
            .args(arguments)
            .current_dir(cwd)
            // On the child, never on this process: the home is an argument here, exactly as the
            // testing standard requires, and it happens to be spelled as a variable because a shim
            // has nowhere else to be told.
            .env("MIXENGINE_HOME", self.path())
            .envs(environment)
            .output()
            .unwrap_or_else(|error| panic!("run {}: {error}", shim.display()));

        Run { output }
    }
}

/// A run whose program was asked to record what it was handed.
pub(crate) struct Recorded {
    /// The run itself: its status and whatever the shim said on the way out.
    pub(crate) run: Run,

    /// The environment the program was given, or empty if it never ran.
    environment: BTreeMap<String, String>,

    /// Whether the program ran at all, which is what its own arguments arriving proves.
    pub(crate) reached: bool,
}

impl Recorded {
    /// One variable the program recorded, by name.
    pub(crate) fn recorded(&self, name: &str) -> Option<&str> {
        self.environment.get(name).map(String::as_str)
    }

    /// Which runtime really ran: the first entry of the `PATH` the program was given.
    pub(crate) fn ran_from(&self) -> PathBuf {
        let path = self
            .environment
            .iter()
            // Windows spells it `Path`, and a child's block keeps whichever spelling it already had.
            .find(|(name, _)| name.eq_ignore_ascii_case("PATH"))
            .map(|(_, value)| value.clone())
            .unwrap_or_else(|| panic!("no PATH was recorded: {}", self.run.stderr()));

        std::env::split_paths(&path)
            .next()
            .expect("the PATH has an entry")
    }
}

/// One run of a shim, and what can be asked of it afterwards.
pub(crate) struct Run {
    output: Output,
}

impl Run {
    /// The status a shell would see.
    pub(crate) fn code(&self) -> i32 {
        self.output.status.code().expect("the child exited")
    }

    pub(crate) fn stderr(&self) -> String {
        String::from_utf8_lossy(&self.output.stderr).into_owned()
    }
}

/// The environment the program was handed, as `fakeservice --dump-env` recorded it.
fn dumped(path: &Path) -> BTreeMap<String, String> {
    let text = std::fs::read_to_string(path)
        .unwrap_or_else(|error| panic!("the program did not record its environment: {error}"));

    text.lines()
        .filter_map(|line| line.split_once('='))
        .map(|(name, value)| (name.to_owned(), value.to_owned()))
        .collect()
}
