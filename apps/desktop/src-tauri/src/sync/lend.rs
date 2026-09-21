//! What a module lends, turned into what the engine moves — and what comes back, turned into
//! something a module can apply.
//!
//! **`updatedAt` is decided here** (D4). No module stores when an item changed, so the store keeps
//! a hash of each record's canonical plaintext as last agreed with the server, and an item whose
//! hash differs is a change made now. **A hash is recorded only after the change has landed** —
//! pushed and accepted, or pulled and written by the module — never when it is merely sent or
//! received. Recorded early, a write that then failed would read as agreed, and the stale local
//! copy would be pushed back over something newer as if it were an edit.

use std::collections::HashSet;

use base64::engine::general_purpose::STANDARD;
use base64::Engine as _;
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};

use super::crypto::{self, RecordAddress, Sealed};
use super::engine::{Change, Outgoing, Pushed};
use super::store::Store;
use super::wire::WireRecord;
use crate::error::AppError;

/// The two keys D2 derives from `MK` that lending needs: one names, one seals.
pub struct Keys {
    pub id: [u8; 32],
    pub data: [u8; 32],
}

/// One item as a module lends it: `{ id, data }`, the same shape `core/syncCollection.ts` has.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Item {
    pub id: String,
    pub data: Value,
}

/// What a module applies after a pull.
#[derive(Debug, Default, PartialEq, Serialize)]
pub struct Incoming {
    pub upserts: Vec<Item>,
    pub removed: Vec<String>,
}

/// An agreement to record once its change has landed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Agreement {
    pub id: String,
    pub local_id: String,
    pub hash: String,
}

/// The plaintext D3 seals: the real collection name, the real id, and the item.
#[derive(Deserialize)]
struct Envelope {
    collection: String,
    id: String,
    data: Value,
}

/// A value with every object's keys in order, at every depth, serialized.
///
/// **Needed because `preserve_order` is on** in this dependency graph: without it, two readers that
/// built the same item with keys in a different order would hash differently and sync a change
/// nobody made.
pub fn canonical(value: &Value) -> Vec<u8> {
    fn sorted(value: &Value) -> Value {
        match value {
            Value::Object(map) => {
                let mut keys: Vec<&String> = map.keys().collect();
                keys.sort();
                let mut out = Map::new();
                for key in keys {
                    out.insert(key.clone(), sorted(&map[key]));
                }
                Value::Object(out)
            }
            Value::Array(items) => Value::Array(items.iter().map(sorted).collect()),
            other => other.clone(),
        }
    }
    serde_json::to_vec(&sorted(value)).unwrap_or_default()
}

fn hash(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .fold(String::new(), |mut out, byte| {
            use std::fmt::Write;
            let _ = write!(out, "{byte:02x}");
            out
        })
}

/// What a deletion is stamped under. Never a hash: those are 64 hex characters.
const DELETED: &str = "deleted";

fn plaintext(collection: &str, item: &Item) -> Vec<u8> {
    canonical(&json!({ "collection": collection, "id": item.id, "data": item.data }))
}

/// This machine's items as the changes the server does not have, and what to record once they have
/// landed. An item agreed before and no longer returned is a deletion. **Each change carries the
/// time it was first noticed**, which `now` is only for a change seen for the first time.
pub async fn outgoing(
    store: &Store,
    keys: &Keys,
    collection: &str,
    items: &[Item],
    now: i64,
) -> Result<(Vec<Outgoing>, Vec<Agreement>), AppError> {
    let opaque_collection = crypto::opaque_id(&keys.id, collection);
    let mut changes = Vec::new();
    let mut agreements = Vec::new();
    let mut present = HashSet::new();

    for item in items {
        let id = crypto::opaque_id(&keys.id, &item.id);
        present.insert(id.clone());
        let plain = plaintext(collection, item);
        let digest = hash(&plain);
        if store
            .agreed(&opaque_collection, &id)
            .await?
            .is_some_and(|agreed| agreed.hash == digest)
        {
            continue;
        }
        let sealed = crypto::seal_record(
            &keys.data,
            &RecordAddress {
                collection: &opaque_collection,
                id: &id,
                deleted: false,
            },
            &plain,
        )?;
        let updated_at = store.stamp(&opaque_collection, &id, &digest, now).await?;
        changes.push(Outgoing {
            collection: opaque_collection.clone(),
            id: id.clone(),
            updated_at,
            change: Change::Write {
                nonce: STANDARD.encode(sealed.nonce),
                ciphertext: STANDARD.encode(sealed.ciphertext),
            },
        });
        agreements.push(Agreement {
            id,
            local_id: item.id.clone(),
            hash: digest,
        });
    }

    for (id, _) in store.agreed_live(&opaque_collection).await? {
        if !present.contains(&id) {
            let updated_at = store.stamp(&opaque_collection, &id, DELETED, now).await?;
            changes.push(Outgoing {
                collection: opaque_collection.clone(),
                id,
                updated_at,
                change: Change::Delete,
            });
        }
    }
    Ok((changes, agreements))
}

/// After a push: agree on every change except those another machine's version beat.
pub async fn settle_pushed(
    store: &Store,
    keys: &Keys,
    collection: &str,
    agreements: Vec<Agreement>,
    pushed: &Pushed,
) -> Result<(), AppError> {
    let lost: HashSet<&str> = pushed
        .superseded
        .iter()
        .map(|record| record.id.as_str())
        .collect();
    let kept = agreements
        .into_iter()
        .filter(|agreement| !lost.contains(agreement.id.as_str()));
    settle(store, keys, collection, kept.collect()).await
}

/// After a module has written what a pull brought: agree on it.
pub async fn settle(
    store: &Store,
    keys: &Keys,
    collection: &str,
    agreements: Vec<Agreement>,
) -> Result<(), AppError> {
    let opaque_collection = crypto::opaque_id(&keys.id, collection);
    for agreement in agreements {
        store
            .agree(
                &opaque_collection,
                &agreement.id,
                &agreement.local_id,
                &agreement.hash,
            )
            .await?;
    }
    Ok(())
}

/// After a module has written what a pull or a lost conflict brought: record each record's version,
/// then agree on what it says. **Only after the write** — see the module comment; the engine
/// leaves a lost conflict unrecorded for exactly this call.
pub async fn land(
    store: &Store,
    keys: &Keys,
    collection: &str,
    records: &[WireRecord],
    agreements: Vec<Agreement>,
) -> Result<(), AppError> {
    for record in records {
        store.remember(record).await?;
    }
    settle(store, keys, collection, agreements).await
}

/// Pulled records, opened, as what a module applies — and what to agree on once it has.
///
/// A tombstone removes the local id this machine agreed on; one it never agreed on names nothing
/// here. **An opened record whose own id does not hash to its address is refused**: the AAD binds
/// the address, and this binds the id inside it, so a record cannot claim to be another item.
pub async fn incoming(
    store: &Store,
    keys: &Keys,
    collection: &str,
    records: &[WireRecord],
) -> Result<(Incoming, Vec<Agreement>), AppError> {
    let opaque_collection = crypto::opaque_id(&keys.id, collection);
    let mut incoming = Incoming::default();
    let mut agreements = Vec::new();

    for record in records
        .iter()
        .filter(|record| record.collection == opaque_collection)
    {
        if record.deleted {
            if let Some(agreed) = store.agreed(&opaque_collection, &record.id).await? {
                incoming.removed.push(agreed.local_id);
            }
            continue;
        }
        let unreadable = || err!("error.syncCannotOpenRecord");
        let nonce: [u8; 24] = STANDARD
            .decode(record.nonce.as_deref().ok_or_else(unreadable)?)
            .map_err(|_| unreadable())?
            .try_into()
            .map_err(|_| unreadable())?;
        let ciphertext = STANDARD
            .decode(record.ciphertext.as_deref().ok_or_else(unreadable)?)
            .map_err(|_| unreadable())?;
        let plain = crypto::open_record(
            &keys.data,
            &RecordAddress {
                collection: &record.collection,
                id: &record.id,
                deleted: false,
            },
            &Sealed { nonce, ciphertext },
        )?;
        let envelope: Envelope = serde_json::from_slice(&plain).map_err(|_| unreadable())?;
        if envelope.collection != collection
            || crypto::opaque_id(&keys.id, &envelope.id) != record.id
        {
            return Err(unreadable());
        }
        let value: Value = serde_json::from_slice(&plain).map_err(|_| unreadable())?;
        agreements.push(Agreement {
            id: record.id.clone(),
            local_id: envelope.id.clone(),
            hash: hash(&canonical(&value)),
        });
        incoming.upserts.push(Item {
            id: envelope.id,
            data: envelope.data,
        });
    }
    Ok((incoming, agreements))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn keys() -> Keys {
        let master = crypto::new_master_key();
        Keys {
            id: crypto::id_key(&master),
            data: crypto::data_key(&master),
        }
    }

    fn item(id: &str, data: Value) -> Item {
        Item {
            id: id.into(),
            data,
        }
    }

    /// What the server would hand back for a change `outgoing` produced.
    fn landed(change: &Outgoing, version: i64) -> WireRecord {
        let (nonce, ciphertext, deleted) = match &change.change {
            Change::Write { nonce, ciphertext } => {
                (Some(nonce.clone()), Some(ciphertext.clone()), false)
            }
            Change::Delete => (None, None, true),
        };
        WireRecord {
            collection: change.collection.clone(),
            id: change.id.clone(),
            version,
            seq: version,
            updated_at: change.updated_at,
            deleted,
            device: "d".into(),
            nonce,
            ciphertext,
        }
    }

    #[test]
    fn key_order_does_not_change_the_bytes() {
        let a: Value = serde_json::from_str(r#"{"b":1,"a":{"d":2,"c":[{"f":3,"e":4}]}}"#).unwrap();
        let b: Value = serde_json::from_str(r#"{"a":{"c":[{"e":4,"f":3}],"d":2},"b":1}"#).unwrap();
        assert_eq!(canonical(&a), canonical(&b));
    }

    #[tokio::test]
    async fn a_first_lend_is_every_item() {
        let (store, keys) = (Store::in_memory("s").await.unwrap(), keys());
        let (changes, agreements) = outgoing(
            &store,
            &keys,
            "c",
            &[item("1", json!({"n": 1})), item("2", json!({"n": 2}))],
            100,
        )
        .await
        .unwrap();
        assert_eq!(changes.len(), 2);
        assert_eq!(agreements.len(), 2);
        assert!(changes.iter().all(|change| change.updated_at == 100));
    }

    /// Nothing changed is nothing to send — even when a reader built the item in another order.
    #[tokio::test]
    async fn an_agreed_item_is_not_sent_again() {
        let (store, keys) = (Store::in_memory("s").await.unwrap(), keys());
        let first = [item("1", serde_json::from_str(r#"{"a":1,"b":2}"#).unwrap())];
        let (changes, agreements) = outgoing(&store, &keys, "c", &first, 100).await.unwrap();
        store.remember(&landed(&changes[0], 1)).await.unwrap();
        settle(&store, &keys, "c", agreements).await.unwrap();

        let reordered = [item("1", serde_json::from_str(r#"{"b":2,"a":1}"#).unwrap())];
        let (again, _) = outgoing(&store, &keys, "c", &reordered, 200).await.unwrap();
        assert!(again.is_empty());
    }

    #[tokio::test]
    async fn an_edit_is_sent_and_a_removal_is_a_deletion() {
        let (store, keys) = (Store::in_memory("s").await.unwrap(), keys());
        let items = [item("1", json!("one")), item("2", json!("two"))];
        let (changes, agreements) = outgoing(&store, &keys, "c", &items, 100).await.unwrap();
        for change in &changes {
            store.remember(&landed(change, 1)).await.unwrap();
        }
        settle(&store, &keys, "c", agreements).await.unwrap();

        let (next, _) = outgoing(&store, &keys, "c", &[item("1", json!("ONE"))], 200)
            .await
            .unwrap();
        assert_eq!(next.len(), 2);
        assert!(next
            .iter()
            .any(|change| matches!(change.change, Change::Write { .. })));
        assert!(next.iter().any(|change| change.change == Change::Delete));
    }

    #[tokio::test]
    async fn what_one_machine_lends_another_can_apply() {
        let keys = keys();
        let here = Store::in_memory("s").await.unwrap();
        let there = Store::in_memory("s").await.unwrap();
        let (changes, _) = outgoing(&here, &keys, "c", &[item("1", json!({"x": 1}))], 100)
            .await
            .unwrap();
        let records: Vec<_> = changes.iter().map(|change| landed(change, 1)).collect();

        let (applied, agreements) = incoming(&there, &keys, "c", &records).await.unwrap();
        assert_eq!(applied.upserts, vec![item("1", json!({"x": 1}))]);
        assert_eq!(agreements.len(), 1);
    }

    #[tokio::test]
    async fn a_tombstone_removes_what_was_agreed_here() {
        let (store, keys) = (Store::in_memory("s").await.unwrap(), keys());
        let (changes, agreements) = outgoing(&store, &keys, "c", &[item("1", json!(1))], 100)
            .await
            .unwrap();
        store.remember(&landed(&changes[0], 1)).await.unwrap();
        settle(&store, &keys, "c", agreements).await.unwrap();

        let mut dead = landed(&changes[0], 2);
        dead.deleted = true;
        let (applied, _) = incoming(&store, &keys, "c", &[dead]).await.unwrap();
        assert_eq!(applied.removed, vec!["1".to_string()]);
    }

    /// A record moved into another item's slot is refused rather than applied as that item.
    #[tokio::test]
    async fn a_record_cannot_claim_another_item() {
        let (store, keys) = (Store::in_memory("s").await.unwrap(), keys());
        let (changes, _) = outgoing(&store, &keys, "c", &[item("1", json!(1))], 100)
            .await
            .unwrap();
        let mut moved = landed(&changes[0], 1);
        moved.id = crypto::opaque_id(&keys.id, "2");
        assert!(incoming(&store, &keys, "c", &[moved]).await.is_err());
    }

    #[tokio::test]
    async fn a_superseded_change_is_not_agreed() {
        let (store, keys) = (Store::in_memory("s").await.unwrap(), keys());
        let (changes, agreements) = outgoing(&store, &keys, "c", &[item("1", json!(1))], 100)
            .await
            .unwrap();
        store.remember(&landed(&changes[0], 1)).await.unwrap();
        let pushed = Pushed {
            accepted: 0,
            superseded: vec![landed(&changes[0], 2)],
        };
        settle_pushed(&store, &keys, "c", agreements, &pushed)
            .await
            .unwrap();
        let opaque = crypto::opaque_id(&keys.id, "c");
        assert_eq!(store.agreed(&opaque, &changes[0].id).await.unwrap(), None);
    }

    /// A retry is not a newer edit. Stamped afresh on each attempt, an edit made offline yesterday
    /// would beat one made elsewhere this morning simply by being retried last (D4).
    #[tokio::test]
    async fn a_change_keeps_the_time_it_was_first_noticed() {
        let (store, keys) = (Store::in_memory("s").await.unwrap(), keys());
        let draft = [item("1", json!("draft"))];
        let (first, _) = outgoing(&store, &keys, "c", &draft, 100).await.unwrap();
        let (retry, _) = outgoing(&store, &keys, "c", &draft, 200).await.unwrap();
        assert_eq!(first[0].updated_at, 100);
        assert_eq!(retry[0].updated_at, 100, "a retry is the same edit");

        let (edited, _) = outgoing(&store, &keys, "c", &[item("1", json!("final"))], 300)
            .await
            .unwrap();
        assert_eq!(edited[0].updated_at, 300, "a further edit is a newer one");
    }

    #[tokio::test]
    async fn a_deletion_keeps_its_time_too() {
        let (store, keys) = (Store::in_memory("s").await.unwrap(), keys());
        let (changes, agreements) = outgoing(&store, &keys, "c", &[item("1", json!(1))], 100)
            .await
            .unwrap();
        store.remember(&landed(&changes[0], 1)).await.unwrap();
        settle(&store, &keys, "c", agreements).await.unwrap();

        let (first, _) = outgoing(&store, &keys, "c", &[], 200).await.unwrap();
        let (retry, _) = outgoing(&store, &keys, "c", &[], 300).await.unwrap();
        assert_eq!(first[0].updated_at, 200);
        assert_eq!(retry[0].updated_at, 200);
    }

    /// A winner written down and landed is agreed: the loser has nothing left to push. This is the
    /// step that ends a conflict (D4).
    #[tokio::test]
    async fn a_landed_winner_leaves_nothing_to_push() {
        let keys = keys();
        let (store, there) = (
            Store::in_memory("s").await.unwrap(),
            Store::in_memory("s").await.unwrap(),
        );
        let (theirs, _) = outgoing(&there, &keys, "c", &[item("1", json!("theirs"))], 300)
            .await
            .unwrap();
        let winner = landed(&theirs[0], 2);
        let (written, agreements) = incoming(&store, &keys, "c", std::slice::from_ref(&winner))
            .await
            .unwrap();
        land(&store, &keys, "c", &[winner], agreements)
            .await
            .unwrap();

        let (next, _) = outgoing(&store, &keys, "c", &written.upserts, 400)
            .await
            .unwrap();
        assert!(next.is_empty());
        let opaque = crypto::opaque_id(&keys.id, "c");
        assert_eq!(
            store
                .seen(&opaque, &theirs[0].id)
                .await
                .unwrap()
                .map(|seen| seen.version),
            Some(2)
        );
    }

    /// An edit that another machine's version replaced is gone, and typing the same bytes again
    /// later is a new edit — not the old one come back with its old time.
    #[tokio::test]
    async fn an_edit_a_pull_replaced_is_forgotten() {
        let keys = keys();
        let (store, there) = (
            Store::in_memory("s").await.unwrap(),
            Store::in_memory("s").await.unwrap(),
        );
        outgoing(&store, &keys, "c", &[item("1", json!("mine"))], 100)
            .await
            .unwrap();

        let (theirs, _) = outgoing(&there, &keys, "c", &[item("1", json!("theirs"))], 150)
            .await
            .unwrap();
        let record = landed(&theirs[0], 1);
        let (_, agreements) = incoming(&store, &keys, "c", std::slice::from_ref(&record))
            .await
            .unwrap();
        store.remember(&record).await.unwrap();
        settle(&store, &keys, "c", agreements).await.unwrap();

        let (again, _) = outgoing(&store, &keys, "c", &[item("1", json!("mine"))], 500)
            .await
            .unwrap();
        assert_eq!(again[0].updated_at, 500);
    }
}
