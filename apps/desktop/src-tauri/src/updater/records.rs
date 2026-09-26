//! What MixLab remembers between runs about updating — spec D8. In MixLab's data directory, never
//! in the MixEngine home.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use super::feed::write_atomically;

pub const DECISION: &str = "decision.json";
pub const IN_PROGRESS: &str = "in-progress.json";

/// What the person decided in Settings → Updates.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Decision {
    /// A version the person chose never to be offered again.
    #[serde(default)]
    pub skipped: Option<String>,
    /// *Check for updates automatically* — on unless the person turned it off (spec D6).
    #[serde(default = "on")]
    pub automatic: bool,
}

fn on() -> bool {
    true
}

impl Default for Decision {
    fn default() -> Self {
        Self {
            skipped: None,
            automatic: true,
        }
    }
}

/// An update that has stopped something, written before it does.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct InProgress {
    pub from: String,
    pub to: String,
    pub directory: PathBuf,
    pub daemon_was_running: bool,
    pub services: Vec<String>,
}

pub struct Records {
    directory: PathBuf,
}

impl Records {
    pub fn new(directory: PathBuf) -> Self {
        Self { directory }
    }

    pub fn decision(&self) -> Decision {
        self.read(DECISION).unwrap_or_default()
    }

    pub fn set_decision(&self, decision: &Decision) -> std::io::Result<()> {
        self.write(DECISION, decision)
    }

    pub fn in_progress(&self) -> Option<InProgress> {
        self.read(IN_PROGRESS)
    }

    pub fn set_in_progress(&self, record: &InProgress) -> std::io::Result<()> {
        self.write(IN_PROGRESS, record)
    }

    pub fn clear_in_progress(&self) {
        let _ = std::fs::remove_file(self.directory.join(IN_PROGRESS));
    }

    /// `None` for a file that is missing or damaged: a start must never fail over this.
    fn read<T: serde::de::DeserializeOwned>(&self, name: &str) -> Option<T> {
        let bytes = std::fs::read(self.directory.join(name)).ok()?;
        serde_json::from_slice(&bytes).ok()
    }

    fn write<T: Serialize>(&self, name: &str, value: &T) -> std::io::Result<()> {
        std::fs::create_dir_all(&self.directory)?;
        let bytes = serde_json::to_vec_pretty(value).map_err(std::io::Error::other)?;
        write_atomically(&self.directory.join(name), &bytes)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nothing_written_reads_as_the_default_and_the_default_checks() {
        let directory = tempfile::tempdir().unwrap();
        let records = Records::new(directory.path().to_path_buf());
        assert_eq!(records.decision(), Decision::default());
        assert!(
            records.decision().automatic,
            "checking is on by default (spec D6)"
        );
        assert_eq!(records.in_progress(), None);
    }

    #[test]
    fn what_is_written_is_what_is_read_and_clearing_forgets_it() {
        let directory = tempfile::tempdir().unwrap();
        let records = Records::new(directory.path().to_path_buf());
        let record = InProgress {
            from: "0.0.9".into(),
            to: "0.0.10".into(),
            directory: directory.path().to_path_buf(),
            daemon_was_running: true,
            services: vec!["mariadb@main".into(), "php-fpm@8.3".into()],
        };
        records.set_in_progress(&record).unwrap();
        assert_eq!(records.in_progress(), Some(record));
        records.clear_in_progress();
        assert_eq!(records.in_progress(), None);

        records
            .set_decision(&Decision {
                skipped: Some("0.0.10".into()),
                automatic: false,
            })
            .unwrap();
        assert_eq!(records.decision().skipped.as_deref(), Some("0.0.10"));
        assert!(!records.decision().automatic);
    }

    #[test]
    fn a_record_from_before_the_switch_existed_still_checks() {
        let directory = tempfile::tempdir().unwrap();
        std::fs::write(directory.path().join(DECISION), br#"{"skipped":"0.0.10"}"#).unwrap();
        assert!(
            Records::new(directory.path().to_path_buf())
                .decision()
                .automatic
        );
    }

    #[test]
    fn a_damaged_record_reads_as_none_rather_than_failing_the_start() {
        let directory = tempfile::tempdir().unwrap();
        std::fs::write(directory.path().join(IN_PROGRESS), b"{not json").unwrap();
        assert_eq!(
            Records::new(directory.path().to_path_buf()).in_progress(),
            None
        );
    }
}
