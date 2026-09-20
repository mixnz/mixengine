//! Read the environment, refuse to start without what is needed, and serve.
//!
//! Everything this serves lives in the library beside this file.

use std::sync::Arc;

use mixlab_sync::{AppState, config::Config, db::Db, reaper, router};

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "mixlab_sync=info".into()),
        )
        .init();

    let config = match Config::from_env() {
        Ok(config) => config,
        Err(missing) => {
            // **A server missing a piece of its configuration refuses to start, and names the
            // piece** (D8). All of them at once: setting one at a time and restarting is the slow
            // way to find out you needed three.
            eprintln!(
                "mixlab-sync will not start without: {}.\nSee server/native/README.md.",
                missing.join(", ")
            );
            std::process::exit(78); // EX_CONFIG
        }
    };

    if config.test_outbox {
        tracing::warn!(
            "test-outbox mode: no mail is sent, /__test__/outbox serves tokens over HTTP, and the \
             pepper is a published constant. This is for the conformance suite and must never be a \
             deployment."
        );
    }

    let db = match Db::open(&config.database) {
        Ok(db) => db,
        Err(error) => {
            eprintln!("mixlab-sync cannot open {}: {error}", config.database);
            std::process::exit(74); // EX_IOERR
        }
    };

    reaper::spawn(
        Arc::clone(&db),
        config.capabilities.tombstone_retention_days,
    );

    let bind = config.bind.clone();
    let listener = match tokio::net::TcpListener::bind(&bind).await {
        Ok(listener) => listener,
        Err(error) => {
            // A port is a property of the machine, not of this program: say which one, say who
            // to tell, and stop rather than half-starting.
            eprintln!("mixlab-sync cannot listen on {bind}: {error}");
            eprintln!("Set MIXLAB_SYNC_BIND to a free address.");
            std::process::exit(74); // EX_IOERR
        }
    };

    tracing::info!("mixlab-sync listening on {bind}");
    axum::serve(listener, router(Arc::new(AppState { config, db })))
        .await
        .expect("the server stopped unexpectedly");
}
