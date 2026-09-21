//! Pull and push, over a [`Remote`] and a [`Store`].
//!
//! **Everything here is sealed.** A caller seals before pushing and opens after pulling; this file
//! moves ciphertext and settles conflicts from the two fields D4's rule reads, so it never needs a
//! key and never sees a plaintext. **Callers pull before they push**, which is what lets a push
//! trust that a record it has never seen is one the server does not have.

use super::chunk::chunk;
use super::merge::{resolve, Keep};
use super::store::Store;
use super::transport::{refusal, PageOutcome, Remote};
use super::wire::{BatchResult, Capabilities, ErrorBody, Operation, RecordBody, WireRecord};
use crate::error::AppError;

/// How many times one push goes round a conflict before giving up. Two machines writing one
/// record in the same second settle in one round; the rest is for a third arriving meanwhile.
const MAX_ROUNDS: usize = 3;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Change {
    Write { nonce: String, ciphertext: String },
    Delete,
}

/// One change this machine wants the server to have. `collection` and `id` are already opaque.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Outgoing {
    pub collection: String,
    pub id: String,
    pub updated_at: i64,
    pub change: Change,
}

/// What a push did.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct Pushed {
    /// Written as this machine had them.
    pub accepted: usize,
    /// Conflicts the other side won. **The caller writes these down and then lands them**
    /// (`lend::land`), exactly as it would a pulled page: this machine's version of each lost, and
    /// until the winner is written here nothing about the record is recorded.
    pub superseded: Vec<WireRecord>,
}

/// What a pull did.
#[derive(Debug, PartialEq, Eq)]
pub struct Pulled {
    pub applied: usize,
    /// The server had forgotten this machine's cursor and the pull started over from nothing. What
    /// was applied is then the whole collection, and anything local that is not in it was deleted
    /// on the server longer ago than tombstones are kept.
    pub restarted: bool,
}

/// Everything new in `collection` since this machine last looked, page by page.
///
/// **Each page is applied before the cursor moves past it.** A page the caller could not apply is
/// read again next time, rather than recorded as seen and never delivered.
pub async fn pull<R: Remote>(
    remote: &R,
    store: &Store,
    collection: &str,
    mut apply: impl FnMut(&[WireRecord]) -> Result<(), AppError>,
) -> Result<Pulled, AppError> {
    let mut since = store.since(collection).await?;
    let mut pulled = Pulled {
        applied: 0,
        restarted: false,
    };
    loop {
        match remote.page(collection, since).await? {
            PageOutcome::CursorExpired if !pulled.restarted => {
                store.forget(collection).await?;
                since = 0;
                pulled.restarted = true;
            }
            // Expired again from the beginning: a server bug, and not one to loop on.
            PageOutcome::CursorExpired => {
                return Err(err!("error.syncServerRefused", code = "cursor-expired"))
            }
            PageOutcome::Page(page) => {
                apply(&page.records)?;
                for record in &page.records {
                    store.remember(record).await?;
                }
                store.set_since(collection, page.next_since).await?;
                pulled.applied += page.records.len();
                since = page.next_since;
                if !page.more {
                    return Ok(pulled);
                }
            }
        }
    }
}

/// This machine's changes, in batches, settling each conflict by D4's rule.
pub async fn push<R: Remote>(
    remote: &R,
    store: &Store,
    limits: &Capabilities,
    device: &str,
    changes: Vec<Outgoing>,
) -> Result<Pushed, AppError> {
    let mut pushed = Pushed::default();
    let mut pending = changes;

    for _ in 0..MAX_ROUNDS {
        if pending.is_empty() {
            return Ok(pushed);
        }

        let mut sent = Vec::new();
        let mut operations = Vec::new();
        for change in &pending {
            match operation_for(store, change).await? {
                Some(operation) => {
                    sent.push(change);
                    operations.push(operation);
                }
                // A deletion of something the server never told this machine about: there is
                // nothing there to delete.
                None => pushed.accepted += 1,
            }
        }

        let mut retry = Vec::new();
        let mut offset = 0;
        for batch in chunk(operations, limits)? {
            let results = remote.batch(&batch).await?;
            if results.len() != batch.len() {
                return Err(err!("error.syncServerAnswerUnreadable"));
            }
            for (result, change) in results.into_iter().zip(&sent[offset..offset + batch.len()]) {
                let BatchResult {
                    status,
                    record,
                    error,
                } = result;
                match (status, record) {
                    (200 | 201, Some(record)) => {
                        store.remember(&record).await?;
                        pushed.accepted += 1;
                    }
                    (409 | 412, Some(current)) => match resolve(
                        change.updated_at,
                        device,
                        current.updated_at,
                        &current.device,
                    ) {
                        // The retry replaces the server's version, so it says `If-Match` with it.
                        Keep::Local => {
                            store.remember(&current).await?;
                            retry.push((*change).clone());
                        }
                        // Not remembered: the version it reveals is recorded with the winner, once
                        // the caller has written it down (`lend::land`). Remembered here, a failed
                        // write would leave the next push carrying it — no `409`, and the older
                        // edit replaces the newer one (D4).
                        Keep::Remote => pushed.superseded.push(current),
                    },
                    // Deleting what the server no longer has is the outcome that was wanted.
                    (404, _) if change.change == Change::Delete => pushed.accepted += 1,
                    _ => {
                        return Err(error
                            .map(|error| refusal(&ErrorBody { error }))
                            .unwrap_or_else(|| err!("error.syncServerAnswerUnreadable")))
                    }
                }
            }
            offset += batch.len();
        }
        pending = retry;
    }

    if pending.is_empty() {
        Ok(pushed)
    } else {
        Err(err!("error.syncConflictUnresolved"))
    }
}

async fn operation_for(store: &Store, change: &Outgoing) -> Result<Option<Operation>, AppError> {
    let seen = store.seen(&change.collection, &change.id).await?;
    Ok(match &change.change {
        Change::Write { nonce, ciphertext } => Some(Operation::Put {
            collection: change.collection.clone(),
            id: change.id.clone(),
            if_match: seen.map(|seen| seen.version),
            if_none_match: seen.is_none(),
            record: RecordBody {
                updated_at: change.updated_at,
                nonce: nonce.clone(),
                ciphertext: ciphertext.clone(),
            },
        }),
        Change::Delete => seen.map(|seen| Operation::Delete {
            collection: change.collection.clone(),
            id: change.id.clone(),
            if_match: seen.version,
        }),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sync::wire::{ErrorDetail, Page};
    use std::collections::BTreeMap;
    use std::sync::Mutex;

    /// Just enough of `/v1` in a `Mutex` to exercise the engine: versions, `seq`, the writing
    /// device, `409`, `412`, paging two at a time, and a cursor the server can forget.
    struct Fake {
        device: String,
        state: Mutex<State>,
    }

    #[derive(Default)]
    struct State {
        records: BTreeMap<(String, String), WireRecord>,
        seq: i64,
        /// A cursor below this is one the server has forgotten.
        forgotten_below: i64,
    }

    impl Fake {
        fn new(device: &str) -> Self {
            Self {
                device: device.into(),
                state: Mutex::new(State::default()),
            }
        }

        /// A record written by some other machine, as if it had arrived first.
        fn holds(&self, id: &str, version: i64, updated_at: i64, device: &str) {
            let mut state = self.state.lock().unwrap();
            state.seq += 1;
            let seq = state.seq;
            state.records.insert(
                ("c".into(), id.into()),
                WireRecord {
                    collection: "c".into(),
                    id: id.into(),
                    version,
                    seq,
                    updated_at,
                    deleted: false,
                    device: device.into(),
                    nonce: Some("n".into()),
                    ciphertext: Some("theirs".into()),
                },
            );
        }

        fn current(&self, id: &str) -> WireRecord {
            self.state.lock().unwrap().records[&("c".to_string(), id.to_string())].clone()
        }
    }

    fn conflict(status: u16, record: WireRecord) -> BatchResult {
        BatchResult {
            status,
            record: Some(record),
            error: Some(ErrorDetail {
                code: "version-conflict".into(),
                retry_after: None,
            }),
        }
    }

    impl Remote for Fake {
        async fn page(&self, collection: &str, since: i64) -> Result<PageOutcome, AppError> {
            let state = self.state.lock().unwrap();
            if since != 0 && since < state.forgotten_below {
                return Ok(PageOutcome::CursorExpired);
            }
            let mut records: Vec<_> = state
                .records
                .values()
                .filter(|record| record.collection == collection && record.seq > since)
                .cloned()
                .collect();
            records.sort_by_key(|record| record.seq);
            let more = records.len() > 2;
            records.truncate(2);
            let next_since = records.last().map_or(since, |record| record.seq);
            Ok(PageOutcome::Page(Page {
                records,
                next_since,
                more,
            }))
        }

        async fn batch(&self, operations: &[Operation]) -> Result<Vec<BatchResult>, AppError> {
            let mut state = self.state.lock().unwrap();
            let mut results = Vec::new();
            for operation in operations {
                let (collection, id) = match operation {
                    Operation::Put { collection, id, .. }
                    | Operation::Delete { collection, id, .. } => (collection.clone(), id.clone()),
                };
                let key = (collection.clone(), id.clone());
                let existing = state.records.get(&key).cloned();
                let expected = match operation {
                    Operation::Put {
                        if_none_match: true,
                        ..
                    } => {
                        if let Some(current) = existing.clone() {
                            results.push(conflict(412, current));
                            continue;
                        }
                        0
                    }
                    Operation::Put { if_match, .. } => if_match.unwrap_or(0),
                    Operation::Delete { if_match, .. } => *if_match,
                };
                if let Some(current) = existing.clone() {
                    if current.version != expected {
                        results.push(conflict(409, current));
                        continue;
                    }
                }
                state.seq += 1;
                let seq = state.seq;
                let version = existing.as_ref().map_or(0, |current| current.version) + 1;
                let record = match operation {
                    Operation::Put { record, .. } => WireRecord {
                        collection,
                        id,
                        version,
                        seq,
                        updated_at: record.updated_at,
                        deleted: false,
                        device: self.device.clone(),
                        nonce: Some(record.nonce.clone()),
                        ciphertext: Some(record.ciphertext.clone()),
                    },
                    Operation::Delete { .. } => WireRecord {
                        collection,
                        id,
                        version,
                        seq,
                        updated_at: existing.map_or(0, |current| current.updated_at),
                        deleted: true,
                        device: self.device.clone(),
                        nonce: None,
                        ciphertext: None,
                    },
                };
                state.records.insert(key, record.clone());
                results.push(BatchResult {
                    status: if version == 1 { 201 } else { 200 },
                    record: Some(record),
                    error: None,
                });
            }
            Ok(results)
        }
    }

    fn limits() -> Capabilities {
        Capabilities {
            protocol_versions: vec!["v1".into()],
            max_record_bytes: 1_000_000,
            max_batch_operations: 2,
            max_batch_bytes: 1_000_000,
            max_page_records: 2,
            account_quota_bytes: 20_971_520,
            tombstone_retention_days: 90,
            closing_on: None,
            features: vec![],
        }
    }

    fn write(id: &str, updated_at: i64, ciphertext: &str) -> Outgoing {
        Outgoing {
            collection: "c".into(),
            id: id.into(),
            updated_at,
            change: Change::Write {
                nonce: "n".into(),
                ciphertext: ciphertext.into(),
            },
        }
    }

    #[tokio::test]
    async fn a_first_push_creates_and_remembers_what_it_created() {
        let (server, store) = (Fake::new("mine"), Store::in_memory("s").await.unwrap());
        let pushed = push(
            &server,
            &store,
            &limits(),
            "mine",
            (0..5).map(|n| write(&n.to_string(), 100, "x")).collect(),
        )
        .await
        .unwrap();
        assert_eq!(
            pushed,
            Pushed {
                accepted: 5,
                superseded: vec![]
            }
        );
        assert_eq!(
            store.seen("c", "3").await.unwrap().map(|seen| seen.version),
            Some(1)
        );
    }

    #[tokio::test]
    async fn a_second_push_says_if_match_with_what_it_remembered() {
        let (server, store) = (Fake::new("mine"), Store::in_memory("s").await.unwrap());
        push(
            &server,
            &store,
            &limits(),
            "mine",
            vec![write("a", 100, "one")],
        )
        .await
        .unwrap();
        push(
            &server,
            &store,
            &limits(),
            "mine",
            vec![write("a", 200, "two")],
        )
        .await
        .unwrap();
        assert_eq!(server.current("a").version, 2);
        assert_eq!(server.current("a").ciphertext.as_deref(), Some("two"));
    }

    #[tokio::test]
    async fn the_later_write_wins_a_conflict_and_goes_round_again() {
        let (server, store) = (Fake::new("mine"), Store::in_memory("s").await.unwrap());
        server.holds("a", 1, 100, "theirs");
        let pushed = push(
            &server,
            &store,
            &limits(),
            "mine",
            vec![write("a", 200, "mine")],
        )
        .await
        .unwrap();
        assert_eq!(pushed.accepted, 1);
        assert_eq!(server.current("a").ciphertext.as_deref(), Some("mine"));
        assert_eq!(server.current("a").device, "mine");
    }

    #[tokio::test]
    async fn the_earlier_write_is_superseded_and_handed_back() {
        let (server, store) = (Fake::new("mine"), Store::in_memory("s").await.unwrap());
        server.holds("a", 1, 300, "theirs");
        let pushed = push(
            &server,
            &store,
            &limits(),
            "mine",
            vec![write("a", 200, "mine")],
        )
        .await
        .unwrap();
        assert_eq!(pushed.accepted, 0);
        assert_eq!(pushed.superseded.len(), 1);
        assert_eq!(pushed.superseded[0].ciphertext.as_deref(), Some("theirs"));
        assert_eq!(server.current("a").ciphertext.as_deref(), Some("theirs"));
    }

    /// The loser learns nothing until it has written the winner down. Learnt early, a failed write
    /// would leave the next push carrying the winner's version: no `409`, and the older edit
    /// replaces the newer one without a conflict ever being seen (D4).
    #[tokio::test]
    async fn a_lost_conflict_is_met_again_until_its_winner_is_written() {
        let (server, store) = (Fake::new("mine"), Store::in_memory("s").await.unwrap());
        server.holds("a", 1, 300, "theirs");
        let edit = || vec![write("a", 200, "mine")];

        let first = push(&server, &store, &limits(), "mine", edit())
            .await
            .unwrap();
        assert_eq!(first.superseded.len(), 1);
        assert_eq!(store.seen("c", "a").await.unwrap(), None);

        // The winner was never written here, so the same edit is pushed again.
        let second = push(&server, &store, &limits(), "mine", edit())
            .await
            .unwrap();
        assert_eq!(second.superseded.len(), 1);
        assert_eq!(server.current("a").version, 1);
        assert_eq!(server.current("a").ciphertext.as_deref(), Some("theirs"));
    }

    #[tokio::test]
    async fn a_tie_goes_to_the_greater_device() {
        let (server, store) = (Fake::new("zeta"), Store::in_memory("s").await.unwrap());
        server.holds("a", 1, 100, "alpha");
        let pushed = push(
            &server,
            &store,
            &limits(),
            "zeta",
            vec![write("a", 100, "zeta")],
        )
        .await
        .unwrap();
        assert_eq!(pushed.accepted, 1);
        assert_eq!(server.current("a").device, "zeta");
    }

    #[tokio::test]
    async fn a_pull_reads_every_page_and_moves_the_cursor_after_each() {
        let (server, store) = (Fake::new("theirs"), Store::in_memory("s").await.unwrap());
        for n in 0..5 {
            server.holds(&n.to_string(), 1, 100, "theirs");
        }
        let mut seen = Vec::new();
        let pulled = pull(&server, &store, "c", |records| {
            seen.extend(records.iter().map(|record| record.id.clone()));
            Ok(())
        })
        .await
        .unwrap();
        assert_eq!(
            pulled,
            Pulled {
                applied: 5,
                restarted: false
            }
        );
        assert_eq!(seen.len(), 5);
        assert_eq!(store.since("c").await.unwrap(), 5);
        assert_eq!(
            store.seen("c", "4").await.unwrap().map(|seen| seen.version),
            Some(1)
        );
    }

    #[tokio::test]
    async fn a_page_that_could_not_be_applied_is_read_again() {
        let (server, store) = (Fake::new("theirs"), Store::in_memory("s").await.unwrap());
        server.holds("a", 1, 100, "theirs");
        let failed = pull(&server, &store, "c", |_| Err(err!("error.cannotWriteFile"))).await;
        assert!(failed.is_err());
        assert_eq!(store.since("c").await.unwrap(), 0);
        assert_eq!(store.seen("c", "a").await.unwrap(), None);
    }

    #[tokio::test]
    async fn a_forgotten_cursor_starts_over_from_nothing() {
        let (server, store) = (Fake::new("theirs"), Store::in_memory("s").await.unwrap());
        server.holds("a", 1, 100, "theirs");
        store.set_since("c", 1).await.unwrap();
        server.state.lock().unwrap().forgotten_below = 50;
        let pulled = pull(&server, &store, "c", |_| Ok(())).await.unwrap();
        assert!(pulled.restarted);
        assert_eq!(pulled.applied, 1);
    }

    /// A conflict that never settles — another machine that always wins by a tie it should lose —
    /// is given up on rather than chased for ever.
    #[tokio::test]
    async fn a_conflict_that_never_settles_is_given_up_on() {
        struct Stubborn;
        impl Remote for Stubborn {
            async fn page(&self, _: &str, _: i64) -> Result<PageOutcome, AppError> {
                unreachable!("push does not page")
            }
            async fn batch(&self, operations: &[Operation]) -> Result<Vec<BatchResult>, AppError> {
                Ok(operations
                    .iter()
                    .map(|_| {
                        conflict(
                            409,
                            WireRecord {
                                collection: "c".into(),
                                id: "a".into(),
                                version: 9,
                                seq: 9,
                                updated_at: 100,
                                deleted: false,
                                device: "alpha".into(),
                                nonce: Some("n".into()),
                                ciphertext: Some("x".into()),
                            },
                        )
                    })
                    .collect())
            }
        }
        let store = Store::in_memory("s").await.unwrap();
        let error = push(
            &Stubborn,
            &store,
            &limits(),
            "zeta",
            vec![write("a", 100, "z")],
        )
        .await
        .unwrap_err();
        assert_eq!(error.code, "error.syncConflictUnresolved");
    }
}
