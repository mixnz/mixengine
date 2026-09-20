//! Read the environment, refuse to start without what is needed, and serve.
//!
//! Everything this serves lives in the library beside this file.

use mixlab_sync::config::Config;

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

    let bind = config.bind.clone();
    let listener = match tokio::net::TcpListener::bind(&bind).await {
        Ok(listener) => listener,
        Err(error) => {
            eprintln!("mixlab-sync cannot listen on {bind}: {error}");
            std::process::exit(74); // EX_IOERR
        }
    };

    tracing::info!("mixlab-sync listening on {bind}");
    axum::serve(listener, mixlab_sync::router(config))
        .await
        .expect("the server stopped unexpectedly");
}
