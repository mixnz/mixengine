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

use std::sync::Arc;

use base64::engine::general_purpose::STANDARD;
use base64::Engine as _;
use serde_json::{json, Value};
use tauri_app_lib::sync::account::{Account, Argon, Registration};
use tauri_app_lib::sync::crypto::{self, RecordAddress, Sealed};
use tauri_app_lib::sync::engine::{self, Change, Outgoing};
use tauri_app_lib::sync::lend::Item;
use tauri_app_lib::sync::saved::InMemory;
use tauri_app_lib::sync::session::SyncState;
use tauri_app_lib::sync::store::Store;
use tauri_app_lib::sync::transport::Transport;
use tauri_app_lib::sync::wire::WireRecord;

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

/// The code in the newest letter of `kind` to `email`, read from the test outbox.
async fn letter(email: &str, kind: &str) -> String {
    let (_, outbox) = call(
        reqwest::Method::GET,
        &format!("/__test__/outbox?email={}", email.replace('@', "%40")),
        None,
        None,
    )
    .await;
    outbox["messages"]
        .as_array()
        .and_then(|messages| {
            messages
                .iter()
                .rev()
                .find(|message| message["kind"] == kind)
        })
        .and_then(|message| message["token"].as_str())
        .expect("a letter")
        .to_owned()
}

fn registration(email: &str, a: String) -> Registration {
    Registration {
        email: email.to_owned(),
        a,
        salt_account: random(16),
        argon: Argon::ours(),
        wrapped_mk_password: random(72),
        wrapped_mk_recovery: random(72),
    }
}

/// One account, verified, and the `A` that signs in to it.
async fn account() -> (String, [u8; 32]) {
    let email = format!("desktop-{}@example.invalid", uuid::Uuid::new_v4().simple());
    let a: [u8; 32] = rand::random();
    let server = Account::new(&server(), None).unwrap();
    server
        .register(&registration(&email, STANDARD.encode(a)))
        .await
        .unwrap();
    server
        .verify(&email, &letter(&email, "verification").await)
        .await
        .unwrap();
    (email, a)
}

/// A machine signed in to that account: its transport, its own store, and its device id.
async fn machine(email: &str, a: &[u8; 32], name: &str) -> (Transport, Store, String) {
    let signed_in = Account::new(&server(), None)
        .unwrap()
        .login(email, a, name)
        .await
        .unwrap();
    (
        Transport::new(&server(), &signed_in.access_token, None).unwrap(),
        Store::in_memory(&server()).await.unwrap(),
        signed_in.device_id,
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

fn open(data_key: &[u8; 32], record: &WireRecord) -> Vec<u8> {
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

/// Every page of `collection`, each recorded before the next is read — what the shell does, with
/// the module's write left out.
async fn pull_all(transport: &Transport, store: &Store, collection: &str) -> Vec<WireRecord> {
    let mut all = Vec::new();
    loop {
        let fetched = engine::fetch(transport, store, collection).await.unwrap();
        for record in &fetched.records {
            store.remember(record).await.unwrap();
        }
        engine::commit(store, collection, &fetched).await.unwrap();
        all.extend(fetched.records.iter().cloned());
        if !fetched.more {
            return all;
        }
    }
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

    let arrived = pull_all(&laptop, &laptop_store, &collection).await;

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
    pull_all(&laptop, &laptop_store, &collection).await;

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

    let last = pull_all(&desktop, &desktop_store, &collection)
        .await
        .pop()
        .expect("the desktop is told");
    assert_eq!(last.device, laptop_device);
    assert_eq!(open(&data_key, &last), b"laptop's");
}

#[tokio::test]
#[ignore = "needs a sync server in test-outbox mode; see the module comment"]
async fn a_wrong_code_is_a_wrong_code() {
    let email = format!("desktop-{}@example.invalid", uuid::Uuid::new_v4().simple());
    let server = Account::new(&server(), None).unwrap();
    server
        .register(&registration(&email, random(32)))
        .await
        .unwrap();
    let error = server.verify(&email, "AAAA-AAAA").await.unwrap_err();
    assert_eq!(error.code, "error.syncWrongCode");
}

#[tokio::test]
#[ignore = "needs a sync server in test-outbox mode; see the module comment"]
async fn a_refresh_rotates_and_spends_the_token_it_used() {
    let (email, a) = account().await;
    let server = Account::new(&server(), None).unwrap();
    let signed_in = server.login(&email, &a, "desktop").await.unwrap();
    let refreshed = server.refresh(&signed_in.refresh_token).await.unwrap();
    assert_ne!(refreshed.refresh_token, signed_in.refresh_token);
    let again = server.refresh(&signed_in.refresh_token).await;
    assert_eq!(
        again.err().map(|error| error.code),
        Some("error.syncSignedOut")
    );
}

#[tokio::test]
#[ignore = "needs a sync server in test-outbox mode; see the module comment"]
async fn a_device_list_names_this_machine_and_a_revoke_ends_it() {
    let (email, a) = account().await;
    let server = Account::new(&server(), None).unwrap();
    let desktop = server.login(&email, &a, "desktop").await.unwrap();
    let laptop = server.login(&email, &a, "laptop").await.unwrap();

    let devices = server.devices(&desktop.access_token).await.unwrap();
    assert_eq!(devices.len(), 2);
    assert!(devices
        .iter()
        .any(|device| device.current && device.name == "desktop"));

    server
        .revoke(&desktop.access_token, &laptop.device_id)
        .await
        .unwrap();
    let cut = server.devices(&laptop.access_token).await;
    assert_eq!(
        cut.err().map(|error| error.code),
        Some("error.syncSignedOut")
    );
}

/// Sign up, confirm, sign in on a second machine, and carry an item across — the shell's calls,
/// without the shell. The last push says nothing changed, which is the proof that the laptop
/// recorded what it wrote rather than what it merely received.
#[tokio::test]
#[ignore = "needs a sync server in test-outbox mode; see the module comment"]
async fn the_client_signs_up_signs_in_and_carries_an_item() {
    let dir = tempfile::tempdir().unwrap();
    let email = format!("desktop-{}@example.invalid", uuid::Uuid::new_v4().simple());
    let desktop = SyncState::new(
        Arc::new(InMemory::default()),
        Ok(dir.path().join("desktop.db")),
    );
    let laptop = SyncState::new(
        Arc::new(InMemory::default()),
        Ok(dir.path().join("laptop.db")),
    );

    let recovery = desktop
        .register(&server(), None, &email, "correct horse".into())
        .await
        .unwrap();
    assert_eq!(recovery.split('-').count(), 13);
    let status = desktop
        .verify(&letter(&email, "verification").await, "desktop")
        .await
        .unwrap();
    assert!(status.signed_in);
    laptop
        .login(&server(), None, &email, "correct horse".into(), "laptop")
        .await
        .unwrap();

    let snippet = Item {
        id: "a-snippet".into(),
        data: json!({ "sql": "select 1" }),
    };
    let pushed = desktop
        .push("query-snippets", vec![snippet.clone()])
        .await
        .unwrap();
    assert_eq!(pushed.accepted, 1);

    let page = laptop.pull_page("query-snippets").await.unwrap();
    assert_eq!(page.changes.upserts, vec![snippet.clone()]);
    laptop
        .commit_pull("query-snippets", &page.token)
        .await
        .unwrap();
    let after = laptop.push("query-snippets", vec![snippet]).await.unwrap();
    assert_eq!(after.accepted, 0);
    assert_eq!(after.token, None);

    assert_eq!(laptop.devices().await.unwrap().len(), 2);
}
