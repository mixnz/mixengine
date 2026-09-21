//! Splitting a push into batches the server said it would take (`/v1/capabilities`).
//!
//! Three limits bind and a client chunks by whichever binds first (D4a): the number of operations,
//! the size of the encoded body, and the size of any one record. The first two are split around;
//! the third is one item no batching can make fit, and is refused before anything is sent.

use super::wire::{Capabilities, Operation};
use crate::error::AppError;

/// What `{"operations":[` and `]}` add to a batch, and the comma between two entries.
const ENVELOPE_BYTES: u64 = 17;
const SEPARATOR_BYTES: u64 = 1;

pub fn chunk(
    operations: Vec<Operation>,
    limits: &Capabilities,
) -> Result<Vec<Vec<Operation>>, AppError> {
    let mut batches = Vec::new();
    let mut current: Vec<Operation> = Vec::new();
    let mut current_bytes = ENVELOPE_BYTES;

    for operation in operations {
        if record_bytes(&operation) > limits.max_record_bytes {
            return Err(err!("error.syncRecordTooLarge"));
        }
        let size = encoded_len(&operation)?;
        if ENVELOPE_BYTES + size > limits.max_batch_bytes {
            return Err(err!("error.syncRecordTooLarge"));
        }

        let separator = if current.is_empty() {
            0
        } else {
            SEPARATOR_BYTES
        };
        let full = current.len() as u64 >= limits.max_batch_operations
            || current_bytes + separator + size > limits.max_batch_bytes;
        if full {
            batches.push(std::mem::take(&mut current));
            current_bytes = ENVELOPE_BYTES;
        }

        let separator = if current.is_empty() {
            0
        } else {
            SEPARATOR_BYTES
        };
        current_bytes += separator + size;
        current.push(operation);
    }

    if !current.is_empty() {
        batches.push(current);
    }
    Ok(batches)
}

fn encoded_len(operation: &Operation) -> Result<u64, AppError> {
    serde_json::to_vec(operation)
        .map(|bytes| bytes.len() as u64)
        .map_err(|_| err!("error.syncCannotEncodeRequest"))
}

/// The decoded length of the ciphertext — **what both servers count** against `maxRecordBytes`,
/// computed the way they compute it, without decoding.
fn record_bytes(operation: &Operation) -> u64 {
    match operation {
        Operation::Put { record, .. } => decoded_len(&record.ciphertext),
        Operation::Delete { .. } => 0,
    }
}

fn decoded_len(base64: &str) -> u64 {
    let padding = if base64.ends_with("==") {
        2
    } else if base64.ends_with('=') {
        1
    } else {
        0
    };
    (base64.len() as u64 / 4) * 3 - padding
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sync::wire::RecordBody;

    fn limits(operations: u64, batch_bytes: u64, record_bytes: u64) -> Capabilities {
        Capabilities {
            protocol_versions: vec!["v1".into()],
            max_record_bytes: record_bytes,
            max_batch_operations: operations,
            max_batch_bytes: batch_bytes,
            max_page_records: 500,
            account_quota_bytes: 20_971_520,
            tombstone_retention_days: 90,
            closing_on: None,
            features: vec![],
        }
    }

    fn put(ciphertext_bytes: usize) -> Operation {
        Operation::Put {
            collection: "c".repeat(64),
            id: "i".repeat(64),
            if_match: None,
            if_none_match: true,
            record: RecordBody {
                updated_at: 1,
                nonce: "n".repeat(32),
                // Unpadded base64 of `ciphertext_bytes` bytes, when that is a multiple of three.
                ciphertext: "A".repeat(ciphertext_bytes / 3 * 4),
            },
        }
    }

    #[test]
    fn nothing_to_send_is_no_batch() {
        assert!(chunk(vec![], &limits(10, 1_000_000, 1_000_000))
            .unwrap()
            .is_empty());
    }

    #[test]
    fn the_count_binds() {
        let batches = chunk(
            (0..7).map(|_| put(30)).collect(),
            &limits(3, 1_000_000, 1_000_000),
        )
        .unwrap();
        assert_eq!(
            batches.iter().map(Vec::len).collect::<Vec<_>>(),
            vec![3, 3, 1]
        );
    }

    /// **Measured, not trusted**: every batch this produces is encoded and checked against the
    /// limit, so the envelope constants cannot drift from what actually goes on the wire.
    #[test]
    fn the_bytes_bind_and_no_batch_goes_over() {
        let limit = 2_000;
        let batches = chunk(
            (0..20).map(|_| put(300)).collect(),
            &limits(100, limit, 1_000_000),
        )
        .unwrap();
        assert!(batches.len() > 1);
        for batch in &batches {
            let encoded = serde_json::to_vec(&serde_json::json!({ "operations": batch })).unwrap();
            assert!(encoded.len() as u64 <= limit, "{} > {limit}", encoded.len());
        }
        assert_eq!(batches.iter().map(Vec::len).sum::<usize>(), 20);
    }

    #[test]
    fn one_record_over_the_limit_is_refused_before_anything_is_sent() {
        let error = chunk(vec![put(30), put(300)], &limits(10, 1_000_000, 200)).unwrap_err();
        assert_eq!(error.code, "error.syncRecordTooLarge");
    }

    #[test]
    fn it_counts_what_the_servers_count() {
        assert_eq!(decoded_len("AAAA"), 3);
        assert_eq!(decoded_len("AAA="), 2);
        assert_eq!(decoded_len("AA=="), 1);
    }
}
