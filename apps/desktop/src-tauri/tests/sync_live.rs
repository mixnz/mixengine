//! The engine against a real `/v1`: the one test where the client meets a server it did not write.
//!
//! **`#[ignore]`**, like every test here that needs something CI does not have. Run it against
//! `server/native/` in test-outbox mode:
//!
//! ```text
//! cd server/native && MIXLAB_SYNC_TEST_OUTBOX=1 MIXLAB_SYNC_BIND=127.0.0.1:8766 \
//!   MIXLAB_SYNC_DATABASE=/tmp/live.db MIXLAB_SYNC_REGISTRATIONS_PER_HOUR=100000 \
//!   MIXLAB_SYNC_AUTH_PER_HOUR=100000 cargo run
//! cd apps/desktop/src-tauri && MIXLAB_SYNC_TEST_SERVER=http://127.0.0.1:8766 \
//!   cargo test --locked --test sync_live -- --ignored
//! ```

use base64::engine::general_purpose::STANDARD;
use base64::Engine as _;
use serde_json::{json, Value};
use tauri_app_lib::sync::crypto::{self, RecordAddress, Sealed};
use tauri_app_lib::sync::engine::{self, Change, Outgoing};
use tauri_app_lib::sync::store::Store;
use tauri_app_lib::sync::transport::Transport;

fn server() -> String {
    std::env::var("MIXLAB_SYNC_TEST_SERVER")
        .expect("MIXLAB_SYNC_TEST_SERVER names a server running in test-outbox mode")
}

fn random(bytes: usize) -> String {
    STANDARD.encode((0..bytes).map(|_| rand::random::<u8>()).collect::<Vec<_>>())
}

async fn call(
    method: reqwest::Method,
    path: &str,
    token: Option<&str>,
    body: Option<Value>,
) -> (u16, Value) {
    let mut request = reqwest::Client::new().request(method, format!("{}{path}", server()));
    if let Some(token) = token {
        request = request.bearer_auth(token);
    }
    if let Some(body) = body {
        request = request
            .header("content-type", "application/json")
            .body(body.to_string());
    }
    let response = request.send().await.expect("the server answers");
    let status = response.status().as_u16();
    let bytes = response.bytes().await.expect("a body");
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}

/// One account, verified, and the `A` that signs in to it.
async fn account() -> (String, String) {
    let email = format!("desktop-{}@example.invalid", uuid::Uuid::new_v4().simple());
    let a = random(32);
    let (status, _) = call(reqwest::Method::POST, "/v1/auth/register", None, Some(json!({
        "email": email, "a": a, "saltAccount": random(16), "argon": { "m": 65536, "t": 3, "p": 4 },
        "wrappedMkPassword": random(72), "wrappedMkRecovery": random(72),
    })))
    .await;
    assert_eq!(status, 201);

    let (_, outbox) = call(
        reqwest::Method::GET,
        &format!("/__test__/outbox?email={}", email.replace('@', "%40")),
        None,
        None,
    )
    .await;
    let code = outbox["messages"]
        .as_array()
        .and_then(|messages| {
            messages
                .iter()
                .rev()
                .find(|message| message["kind"] == "verification")
        })
        .and_then(|message| message["token"].as_str())
        .expect("a verification letter")
        .to_owned();
    let (status, _) = call(
        reqwest::Method::POST,
        "/v1/auth/verify",
        None,
        Some(json!({ "email": email, "token": code })),
    )
    .await;
    assert_eq!(status, 200);
    (email, a)
}

/// A machine signed in to that account: its transport, its own store, and its device id.
async fn machine(email: &str, a: &str, name: &str) -> (Transport, Store, String) {
    let (status, session) = call(
        reqwest::Method::POST,
        "/v1/auth/login",
        None,
        Some(json!({
            "email": email, "a": a, "deviceName": name,
        })),
    )
    .await;
    assert_eq!(status, 200);
    let token = session["accessToken"].as_str().unwrap();
    let device = session["deviceId"].as_str().unwrap().to_owned();
    (
        Transport::new(&server(), token, None).unwrap(),
        Store::in_memory(&server()).await.unwrap(),
        device,
    )
}

fn seal(
    data_key: &[u8; 32],
    collection: &str,
    id: &str,
    plaintext: &[u8],
    updated_at: i64,
) -> Outgoing {
    let sealed = crypto::seal_record(
        data_key,
        &RecordAddress {
            collection,
            id,
            deleted: false,
        },
        plaintext,
    )
    .unwrap();
    Outgoing {
        collection: collection.into(),
        id: id.into(),
        updated_at,
        change: Change::Write {
            nonce: STANDARD.encode(sealed.nonce),
            ciphertext: STANDARD.encode(sealed.ciphertext),
        },
    }
}

fn open(data_key: &[u8; 32], record: &tauri_app_lib::sync::wire::WireRecord) -> Vec<u8> {
    let nonce: [u8; 24] = STANDARD
        .decode(record.nonce.as_ref().unwrap())
        .unwrap()
        .try_into()
        .unwrap();
    let ciphertext = STANDARD
        .decode(record.ciphertext.as_ref().unwrap())
        .unwrap();
    crypto::open_record(
        data_key,
        &RecordAddress {
            collection: &record.collection,
            id: &record.id,
            deleted: false,
        },
        &Sealed { nonce, ciphertext },
    )
    .unwrap()
}

#[tokio::test]
#[ignore = "needs a sync server in test-outbox mode; see the module comment"]
async fn a_second_machine_reads_what_the_first_wrote() {
    let master = crypto::new_master_key();
    let (id_key, data_key) = (crypto::id_key(&master), crypto::data_key(&master));
    let collection = crypto::opaque_id(&id_key, "saved-queries");
    let id = crypto::opaque_id(&id_key, "a-local-uuid");

    let (email, a) = account().await;
    let (desktop, desktop_store, desktop_device) = machine(&email, &a, "desktop").await;
    let (laptop, laptop_store, _) = machine(&email, &a, "laptop").await;
    let limits = desktop.capabilities().await.unwrap();

    let pushed = engine::push(
        &desktop,
        &desktop_store,
        &limits,
        &desktop_device,
        vec![seal(&data_key, &collection, &id, b"select 1", 100)],
    )
    .await
    .unwrap();
    assert_eq!(pushed.accepted, 1);

    let mut arrived = Vec::new();
    engine::pull(&laptop, &laptop_store, &collection, |records| {
        arrived.extend(records.iter().cloned());
        Ok(())
    })
    .await
    .unwrap();

    assert_eq!(arrived.len(), 1);
    assert_eq!(arrived[0].device, desktop_device);
    assert_eq!(open(&data_key, &arrived[0]), b"select 1");
}

#[tokio::test]
#[ignore = "needs a sync server in test-outbox mode; see the module comment"]
async fn two_machines_settle_a_conflict_the_same_way() {
    let master = crypto::new_master_key();
    let (id_key, data_key) = (crypto::id_key(&master), crypto::data_key(&master));
    let collection = crypto::opaque_id(&id_key, "saved-queries");
    let id = crypto::opaque_id(&id_key, "a-local-uuid");

    let (email, a) = account().await;
    let (desktop, desktop_store, desktop_device) = machine(&email, &a, "desktop").await;
    let (laptop, laptop_store, laptop_device) = machine(&email, &a, "laptop").await;
    let limits = desktop.capabilities().await.unwrap();

    engine::push(
        &desktop,
        &desktop_store,
        &limits,
        &desktop_device,
        vec![seal(&data_key, &collection, &id, b"first", 100)],
    )
    .await
    .unwrap();
    engine::pull(&laptop, &laptop_store, &collection, |_| Ok(()))
        .await
        .unwrap();

    // Both edit the version they both saw; the laptop's edit is later.
    engine::push(
        &desktop,
        &desktop_store,
        &limits,
        &desktop_device,
        vec![seal(&data_key, &collection, &id, b"desktop's", 200)],
    )
    .await
    .unwrap();
    let pushed = engine::push(
        &laptop,
        &laptop_store,
        &limits,
        &laptop_device,
        vec![seal(&data_key, &collection, &id, b"laptop's", 300)],
    )
    .await
    .unwrap();
    assert_eq!(
        pushed.accepted, 1,
        "the later write wins and goes round again"
    );

    let mut last = None;
    engine::pull(&desktop, &desktop_store, &collection, |records| {
        last = records.last().cloned();
        Ok(())
    })
    .await
    .unwrap();
    let last = last.expect("the desktop is told");
    assert_eq!(last.device, laptop_device);
    assert_eq!(open(&data_key, &last), b"laptop's");
}
