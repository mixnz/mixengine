//! `<root>/bin` and this user's PATH — the only door into either. Roadmap task **T26**.
//!
//! Two mechanisms with one purpose, which is why they are one type: filling the directory makes
//! `php` a file, putting the directory on the PATH makes `php` a word somebody can type, and either
//! on its own does nothing a person would notice. `path.install` does both and `path.status`
//! reports both.
//!
//! **The two halves have opposite policies about being done without being asked**, and the split is
//! where the change lands.
//!
//! `<root>/bin` is inside the home, so it is refreshed on **every start**, beside the recovery
//! passes that reconcile services and jobs: it is a projection of a table in this binary, exactly as
//! `etc/` is a projection of the database, and a home whose `bin/` was deleted is repaired by
//! starting the daemon. Nothing outside the root is touched by it and there is nothing for a user to
//! consent to.
//!
//! The PATH is **only ever changed when somebody asks**. It is a file in the user's home on Unix and
//! a value in their registry hive on Windows — outside the root, and outside what
//! `.claude/architecture/overview.md` lists as MixEngine's to write on its own account. A daemon
//! that edited `~/.zprofile` because it happened to start at login would be a program that changed
//! the shell of somebody who had only installed it.

use std::path::PathBuf;
use std::sync::Arc;

use mixengine_core::{Paths, shims};
use mixengine_platform::{Host, PathState};
use mixengine_proto::{Error, PathPlace, PathReport};

use crate::error::ToWire as _;

/// The home's `bin/`, the binary that fills it, and the machine whose PATH it goes on.
#[derive(Debug)]
pub(crate) struct Shims {
    /// `<root>/bin`.
    bin: PathBuf,

    /// The program that is running, which is what the shim binary is found beside.
    ///
    /// Held rather than the resolved shim, so that a broken installation is reported by the call
    /// that needs it rather than by refusing to start: a daemon with no `mixengine-shim` next to it
    /// can still supervise every service in this home, and saying so at `path.install` is where a
    /// person can act on it.
    program: PathBuf,

    /// The OS, for the half of this that is not a file inside the home.
    host: Arc<dyn Host>,

    /// The rows `bin/` is a projection of — roadmap tasks **T130** and **T131**.
    ///
    /// The directory stopped being a projection of one compiled constant when it started fronting
    /// the clients of installed packages and the tools somebody put inside a runtime, and this is
    /// what that cost: the thing that fills `bin/` now has to be able to read the database.
    store: mixengine_core::Store,

    /// Which packages this build knows how to run, which is what declares their client commands.
    catalogue: mixengine_core::generate::Catalogue,

    /// Held across every refresh, so two of them cannot sweep against two different expectations.
    ///
    /// **Three callers now instead of one**: the start, `path.install`, and the pass that notices a
    /// global install (T131). A refresh removes what is not expected *before* it writes what is, so
    /// two overlapping passes could each delete the other's files and leave a name on somebody's
    /// PATH with nothing behind it. The window is small and the failure is not, which is the shape
    /// of a lock that is worth taking.
    filling: tokio::sync::Mutex<()>,
}

impl Shims {
    pub(crate) fn new(
        paths: &Paths,
        program: PathBuf,
        host: Arc<dyn Host>,
        store: mixengine_core::Store,
        catalogue: mixengine_core::generate::Catalogue,
    ) -> Self {
        Self {
            bin: paths.bin().to_path_buf(),
            program,
            host,
            store,
            catalogue,
            filling: tokio::sync::Mutex::new(()),
        }
    }

    /// Put one copy of the shim in `bin/` per command, and clear out what is not one.
    ///
    /// Called at every start and by [`install`](Self::install). Touches nothing outside the home.
    ///
    /// Answers the **wire** error rather than the domain one, although its only other caller is the
    /// start-up path that logs it: everything below the API boundary in this binary has already
    /// been through [`ToWire`](crate::error::ToWire), and a second error type flowing up through
    /// one method would be one place for a hint to go missing.
    pub(crate) async fn refresh(&self) -> Result<shims::Refreshed, Error> {
        let shim = shims::source(&self.program).map_err(|error| error.to_wire())?;
        let (extra, conflicts) = self.extras().await?;

        let _filling = self.filling.lock().await;

        let mut refreshed = shims::refresh(&self.bin, &shim, &extra).map_err(|e| e.to_wire())?;
        refreshed.conflicts = conflicts;

        Ok(refreshed)
    }

    /// The commands `bin/` fronts on installed packages' behalf — roadmap task **T130**.
    ///
    /// **A recipe declares, the rows decide.** Which names exist at all is
    /// [`Recipe::clients`](mixengine_core::generate::Recipe::clients), compiled in; which of them
    /// this home can actually run is three facts out of the database, asked once per package:
    ///
    /// - is any version of it installed, and which one would a command resolve to
    ///   ([`client::chosen`](mixengine_core::services::client::chosen)),
    /// - does *that* install publish the executable the client names — a Windows MariaDB packs no
    ///   `mariadb-backup` on every branch, and a name in `bin/` resolving to nothing is worse than
    ///   a missing one,
    /// - and is there an instance, on the product's documented port, which is what settles a name
    ///   two packages both want.
    ///
    /// A package that is not installed is skipped rather than reported: `bin/` holding `node` on a
    /// machine with no Node.js is [`shims::COMMANDS`]' deliberate choice and is right for a
    /// *runtime*, whose shim then says which command to type. It is wrong here, because there is no
    /// such sentence to say — `mysqldump` on a machine that has never had a database is a name
    /// nothing would ever make work.
    async fn extras(&self) -> Result<(Vec<shims::Extra>, Vec<shims::Conflict>), Error> {
        // The whole walk is [`client::claims`], because the shim performs the same one with the
        // name it was invoked by: two implementations would be a `bin/` holding a command the shim
        // then refused, or a command the shim ran that this directory had given to another package.
        //
        // A database that cannot be read fails the whole refresh rather than composing `bin/` out
        // of half a query — the half that failed would be swept away as commands nothing claims.
        let claims = mixengine_core::services::client::claims(&self.store, &self.catalogue, None)
            .await
            .map_err(|error| error.to_wire())?;

        Ok(shims::resolve_claims(&claims))
    }

    /// `path.status` — what a terminal opened a minute from now would find.
    ///
    /// Reads `bin/` rather than reporting [`COMMANDS`](mixengine_core::shims::COMMANDS): the
    /// question is what is *there*, and a listing composed from the table would answer it out of
    /// this binary's constants on a machine where the directory had been deleted.
    pub(crate) fn status(&self) -> Result<PathReport, Error> {
        let state = self
            .host
            .path_integration()
            .state(&self.bin)
            .map_err(|error| error.to_wire())?;

        Ok(self.report(state, self.installed(), Vec::new()))
    }

    /// `path.install` — fill `bin/`, then put it on the PATH.
    ///
    /// **That order and not the other**, because the failure that survives has to be the harmless
    /// one: a directory of shims nothing can find is invisible, and a PATH entry naming a directory
    /// that was never filled is a `php` that resolves to nothing.
    pub(crate) async fn install(&self) -> Result<PathReport, Error> {
        let refreshed = self.refresh().await?;

        let state = self
            .host
            .path_integration()
            .add(&self.bin)
            .map_err(|error| error.to_wire())?;

        Ok(self.report(state, refreshed.commands, refreshed.refused))
    }

    /// `path.uninstall` — take `bin/` off the PATH, and leave it exactly as it is.
    ///
    /// The shims stay. They are inside the home, they cost a few megabytes there, and removing what
    /// makes the home work in order to undo one line in a profile would be an uninstall wearing a
    /// smaller command's name — `.claude/architecture/overview.md` has removing the home remove
    /// them.
    pub(crate) fn uninstall(&self) -> Result<PathReport, Error> {
        let state = self
            .host
            .path_integration()
            .remove(&self.bin)
            .map_err(|error| error.to_wire())?;

        Ok(self.report(state, self.installed(), Vec::new()))
    }

    /// The commands `bin/` answers to right now, read off the directory.
    ///
    /// Best effort, and the empty list is the honest answer for a directory that cannot be read: a
    /// status that invented the table's contents would say `php` is there on a machine where it is
    /// not, which is the one thing this method exists to be able to deny.
    fn installed(&self) -> Vec<String> {
        let known: Vec<String> = shims::COMMANDS.iter().map(shims::file_name).collect();

        let Ok(entries) = std::fs::read_dir(&self.bin) else {
            return Vec::new();
        };

        let mut present: Vec<String> = entries
            .flatten()
            .map(|entry| entry.file_name().to_string_lossy().into_owned())
            // A copy a Windows refresh could not overwrite and moved out of the way. It is rubbish
            // the next sweep collects, not a command anybody can type.
            .filter(|name| !name.ends_with(shims::MOVED_ASIDE))
            .collect();

        let same = |left: &str, right: &str| match cfg!(windows) {
            true => left.eq_ignore_ascii_case(right),
            false => left == right,
        };

        // In the table's order rather than the directory's, which is arbitrary on every filesystem
        // and stable on none — a listing somebody scans has to be one the eye can predict, which is
        // `runtime.list_installed`'s own reasoning.
        let mut listing: Vec<String> = known
            .into_iter()
            .filter(|name| present.iter().any(|found| same(found, name)))
            .collect();

        // **And then everything else `bin/` holds, alphabetically** — roadmap tasks T130 and T131.
        // A listing composed from [`shims::COMMANDS`] alone used to be the whole answer and is now
        // a claim that `mysqldump` and `yarn` are not there, on a machine where a person can see
        // them and run them.
        present.retain(|found| !listing.iter().any(|name| same(found, name)));
        present.sort();
        listing.extend(present);

        listing
    }

    /// The wire shape of an answer, from the OS's half and the directory's.
    fn report(&self, state: PathState, commands: Vec<String>, stale: Vec<String>) -> PathReport {
        PathReport {
            directory: self.bin.display().to_string(),
            on_path: state.complete(),
            places: state
                .locations
                .into_iter()
                .map(|location| PathPlace {
                    name: location.name,
                    present: location.present,
                    changed: location.changed,
                })
                .collect(),
            commands,
            stale,
        }
    }
}
