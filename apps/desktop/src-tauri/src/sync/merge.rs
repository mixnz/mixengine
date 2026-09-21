//! D4's conflict rule, and nothing else.
//!
//! **A conflict is the client's to resolve and the server's to refuse.** A write whose `If-Match`
//! is stale comes back with the record the server holds; this decides which of the two survives.
//! Both machines run it on the same two records and must reach the same answer from opposite
//! sides, which is the property the tests below are about.

use std::cmp::Ordering;

/// Which side of a conflict survives.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Keep {
    Local,
    Remote,
}

/// The later `updatedAt` wins; a tie goes to the lexicographically greater device.
///
/// **An exact tie — same second, same device — keeps the remote.** It is one write arriving twice,
/// and keeping what is already there costs no round trip.
pub fn resolve(
    local_updated_at: i64,
    local_device: &str,
    remote_updated_at: i64,
    remote_device: &str,
) -> Keep {
    match local_updated_at.cmp(&remote_updated_at) {
        Ordering::Greater => Keep::Local,
        Ordering::Less => Keep::Remote,
        Ordering::Equal if local_device > remote_device => Keep::Local,
        Ordering::Equal => Keep::Remote,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_later_write_wins_from_either_side() {
        assert_eq!(resolve(200, "a", 100, "b"), Keep::Local);
        assert_eq!(resolve(100, "a", 200, "b"), Keep::Remote);
    }

    #[test]
    fn a_tie_goes_to_the_greater_device() {
        assert_eq!(resolve(100, "b", 100, "a"), Keep::Local);
        assert_eq!(resolve(100, "a", 100, "b"), Keep::Remote);
    }

    #[test]
    fn the_same_write_twice_keeps_what_is_there() {
        assert_eq!(resolve(100, "a", 100, "a"), Keep::Remote);
    }

    /// **Two machines on opposite sides of one conflict agree on the survivor.** If they did not,
    /// each would overwrite the other for ever.
    #[test]
    fn both_machines_reach_the_same_answer() {
        let cases = [
            (100, "a", 200, "b"),
            (200, "a", 100, "b"),
            (100, "a", 100, "b"),
            (100, "b", 100, "a"),
        ];
        for (t1, d1, t2, d2) in cases {
            let here = resolve(t1, d1, t2, d2);
            let there = resolve(t2, d2, t1, d1);
            assert_ne!(here, there, "{t1}/{d1} against {t2}/{d2}");
        }
    }
}
