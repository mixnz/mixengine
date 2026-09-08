use std::collections::HashMap;
use std::sync::Mutex;

use tokio_util::sync::CancellationToken;

/// What a client has to be built for. Neither can be changed after the client exists, and both
/// vary per request — so there is a client per combination rather than one for the app.
///
/// `(follow_redirects, accept_invalid_certs)`.
pub type ClientKey = (bool, bool);

/// One HTML response waiting to be loaded into the Preview frame, with the policy it is served
/// with — see `preview.rs` for why it is served at all rather than handed over as `srcdoc`.
pub struct Preview {
    pub id: String,
    pub body: Vec<u8>,
    pub csp: String,
}

/// Blocking locks rather than async ones: nothing is awaited while any is held. The client is
/// cloned out and the map released before anything is sent — a `reqwest::Client` is an `Arc`
/// inside, so cloning it shares the connection pool rather than copying it.
#[derive(Default)]
pub struct RestState {
    /// Kept and reused, which is what makes the second request to a host skip the TLS handshake.
    pub clients: Mutex<HashMap<ClientKey, reqwest::Client>>,
    /// Every send in flight, by the id it was given. Cancelling is looking one up and telling it.
    pub inflight: Mutex<HashMap<String, CancellationToken>>,
    /// Documents the preview scheme can serve, oldest first. A `Vec` rather than a map: it is
    /// capped at a handful, and the order is what the cap evicts by.
    pub previews: Mutex<Vec<Preview>>,
}
