//! Noticing that somebody installed a tool into a runtime — roadmap task **T131**.
//!
//! `npm install -g yarn` writes a program into the Node install's own bindir and tells nobody. This
//! is what turns that into a command: a short loop that compares each installed runtime's bindir
//! against the modification time it last saw, and — only when one has moved — re-scans, rewrites
//! [`bin_commands`](mixengine_core::bin_commands) and refills `<root>/bin`.
//!
//! # Why a poll rather than a watcher
//!
//! A filesystem watcher would react a little sooner and would cost a dependency whose behaviour is
//! a different program on each of the three systems — `ReadDirectoryChangesW`, FSEvents, inotify —
//! with its own queue, its own coalescing and its own failure modes to reason about on every one of
//! them. What is being watched here is a handful of directories, and the question asked of each is
//! one `stat`.
//!
//! # What an idle machine pays
//!
//! One `stat` per installed runtime per tick, and **nothing else**: a tick where no directory has
//! moved returns before it opens the database. That is what keeps this inside M7's promise that
//! thirty idle minutes leave only the daemon and the web server — a machine with four runtimes
//! installed pays four `stat`s every two seconds, and `bench`'s idle measurement is what checks
//! that rather than this sentence.
//!
//! The period is `[bin] rescan_seconds` so that a person who would rather type `mix path rescan`,
//! or a filesystem whose directory times are expensive, can slow it down.

use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, SystemTime};

use mixengine_core::{Store, runtimes};

use crate::shims::Shims;

/// Start the loop, and hand back the handle that stops it.
///
/// Nothing here can fail the daemon: every pass that cannot read the rows or cannot write `bin/`
/// logs and waits for the next tick, on the rule every recovery pass in `main` follows. A machine
/// whose `bin/` is momentarily out of date is a machine that works; one whose daemon refused to
/// start over it is not.
pub(crate) fn start(
    shims: Arc<Shims>,
    store: Store,
    period: Duration,
) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        let mut seen: BTreeMap<PathBuf, SystemTime> = BTreeMap::new();
        let mut ticks = tokio::time::interval(period);

        // The first tick fires immediately and is what makes a daemon start notice a tool installed
        // while it was stopped. `Delay` and not `Burst`, so a machine that was suspended does not
        // wake to a queue of missed passes it then runs back to back.
        ticks.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);

        loop {
            ticks.tick().await;

            let Some(times) = bindir_times(&store).await else {
                continue;
            };

            if times == seen {
                continue;
            }

            seen = times;

            match shims.rescan().await {
                Ok(refreshed) if refreshed.written.is_empty() && refreshed.removed.is_empty() => {}
                Ok(refreshed) => tracing::info!(
                    written = ?refreshed.written,
                    removed = ?refreshed.removed,
                    "bin/ caught up with what is installed"
                ),
                Err(error) => tracing::warn!(
                    %error,
                    "a tool installed into a runtime could not be made a command"
                ),
            }
        }
    })
}

/// Each installed runtime's bindir, and when it last changed.
///
/// A directory that is not there has no entry rather than an error: a `Scripts` nothing has ever
/// installed into is the ordinary state of a fresh Python, and its *appearance* is exactly the event
/// this is watching for.
///
/// [`None`] for a tick that could not read the installs — reported here rather than handed back,
/// because the caller's only possible answer is to wait for the next one, and a `Result` carrying
/// `mixengine_core::Error` would make this signature the largest thing in the file.
async fn bindir_times(store: &Store) -> Option<BTreeMap<PathBuf, SystemTime>> {
    let installed = match runtimes::records(store, None).await {
        Ok(installed) => installed,
        Err(error) => {
            tracing::warn!(%error, "could not look for globally installed tools");
            return None;
        }
    };

    let mut times = BTreeMap::new();

    for runtime in installed {
        let Some(bindir) =
            runtimes::globals::directory(runtime.kind, std::path::Path::new(&runtime.path))
        else {
            continue;
        };

        // The directory's own modification time, which every filesystem this project supports moves
        // when a file is created in or removed from it — which is precisely what `npm install -g`
        // and `npm uninstall -g` do.
        if let Ok(modified) = std::fs::metadata(&bindir).and_then(|metadata| metadata.modified()) {
            times.insert(bindir, modified);
        }
    }

    Some(times)
}
