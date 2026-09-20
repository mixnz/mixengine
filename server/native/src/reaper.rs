//! Reaping tombstones, without an alarm.
//!
//! **This is the other place the two implementations genuinely differ.** The Worker schedules a
//! Durable Object alarm per account, and only when that account has a tombstone to reap — because
//! there an alarm invocation is a request, and a daily one per account would bill for every
//! account that ever existed. Here there is one process and one file, so a task that wakes up and
//! sweeps every account at once is both simpler and cheaper.
//!
//! **The protocol cannot tell the difference**, which is the claim this whole implementation
//! exists to test: `410 cursor-expired` arrives the same way whichever server a client is talking
//! to, and `../conformance/` asserts it against both.

use std::sync::Arc;
use std::time::Duration;

use rusqlite::params;

use crate::crypto::now;
use crate::db::Db;

/// How often to sweep. A quarter of the retention, capped at an hour and floored at a second — the
/// floor is what makes a server configured to reap at once testable at all.
pub fn interval(retention_days: u64) -> Duration {
    let retention = retention_days.saturating_mul(24 * 60 * 60);
    Duration::from_secs((retention / 4).clamp(1, 3600))
}

/// Deletes every tombstone older than the retention, and records how far each account's cursor has
/// to have got to still be complete.
pub fn sweep(
    connection: &mut rusqlite::Connection,
    retention_days: u64,
) -> rusqlite::Result<usize> {
    let horizon = now() - (retention_days * 24 * 60 * 60) as i64;
    let transaction =
        connection.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;

    // Every cursor below the highest seq that is about to go is now incomplete news, and D3 says
    // such a machine is told to resync from empty rather than told it quietly. Recorded before the
    // delete, because afterwards there is nothing left to read the number from.
    transaction.execute(
        "UPDATE account SET reaped_below_seq = MAX(
           reaped_below_seq,
           COALESCE((SELECT MAX(seq) FROM record
                     WHERE record.account_id = account.id AND deleted = 1 AND written_at <= ?1), 0)
         )",
        params![horizon],
    )?;
    let reaped = transaction.execute(
        "DELETE FROM record WHERE deleted = 1 AND written_at <= ?1",
        params![horizon],
    )?;
    transaction.commit()?;
    Ok(reaped)
}

/// Sweeps forever. Spawned once at startup; there is nothing per-account to schedule.
pub fn spawn(db: Arc<Db>, retention_days: u64) {
    let every = interval(retention_days);
    tokio::spawn(async move {
        let mut ticker = tokio::time::interval(every);
        loop {
            ticker.tick().await;
            match db
                .call(move |connection| sweep(connection, retention_days))
                .await
            {
                Ok(0) => {}
                Ok(reaped) => tracing::info!("reaped {reaped} tombstones"),
                Err(error) => tracing::error!("could not reap tombstones: {error}"),
            }
        }
    });
}
