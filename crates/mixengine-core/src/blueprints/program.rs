//! What a plan reads out of a `[scaffold]` command: its program, when that can be told.
//!
//! Roadmap task **T78b**. A command is a line for `cmd.exe` or `sh`, and the one thing a plan can
//! decide about it up front is whether the program its first word names is there to be run. Only
//! that, and only when the first word is a bare name — every doubt resolves to *not judging*,
//! because a false `blocked` stops a blueprint that would have worked (the design's D2).

use std::ffi::OsStr;

use mixengine_proto::Disposition;

/// Words either shell answers itself, without ever consulting `PATH`.
///
/// Small on purpose and written down once: `echo hello> made.txt` is what the scaffold suite runs
/// on Windows, and `printf` is a builtin to `dash`. A word here leaves the step to the shell.
const BUILTINS: &[&str] = &[
    "cd", "echo", "set", "exit", "type", "printf", "test", "true", "false", "export", ".", ":",
    "call", "start", "rem", "if", "for",
];

/// What makes a first word something other than a bare program name.
const NOT_A_BARE_NAME: &[char] = &[
    '"', '\'', '`', '$', '(', ')', '{', '}', '|', '&', ';', '<', '>', '/', '\\', '=',
];

/// The program `command` would run, when its first word is a bare name — [`None`] otherwise.
#[must_use]
pub fn bare_name(command: &str) -> Option<&str> {
    let first = command.split_whitespace().next()?;

    if first.contains(NOT_A_BARE_NAME) || BUILTINS.contains(&first.to_ascii_lowercase().as_str()) {
        return None;
    }

    Some(first)
}

/// The scaffold step's disposition: `Confirm` unless its program is a bare name nothing on
/// `scaffold_path` answers to, which is `Blocked` — decided here rather than at the end of a job
/// (the design's D1 and D3).
#[must_use]
pub fn disposition(command: &str, scaffold_path: &OsStr) -> Disposition {
    match bare_name(command) {
        Some(name)
            if mixengine_platform::process::program_on_path(name, scaffold_path).is_none() =>
        {
            Disposition::Blocked {
                reason: format!(
                    "`{name}` is not on the PATH the command would run with (<home>/bin, then \
                     the daemon's own PATH)"
                ),
            }
        }
        _ => Disposition::Confirm {
            what: command.to_owned(),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// **Only a bare first word is judged** — roadmap task **T78b**, its design's D2.
    #[test]
    fn a_bare_first_word_is_the_program() {
        assert_eq!(
            bare_name("composer create-project laravel/laravel ."),
            Some("composer")
        );
        assert_eq!(
            bare_name("  npx --yes create-next-app@latest ."),
            Some("npx")
        );
    }

    /// Quotes, shell syntax, paths, assignments and builtins are all left to the shell.
    #[test]
    fn anything_that_is_not_a_bare_name_is_left_to_the_shell() {
        for command in [
            "echo hello> made.txt",
            "printf hello > made.txt",
            "ECHO hello",
            r#""C:\tools\run.exe" --flag"#,
            "'./run' now",
            "VAR=1 program",
            "./local --flag",
            r".\local.cmd",
            "$HOME/bin/tool",
            "",
            "   ",
        ] {
            assert_eq!(bare_name(command), None, "{command:?}");
        }
    }

    /// A program nothing on the PATH answers to is `Blocked`, naming it and both halves of the
    /// PATH it was looked for on (D3).
    #[test]
    fn a_missing_program_is_blocked_with_its_name_and_where_it_was_looked_for() {
        let judged = disposition("composer create-project laravel/laravel .", OsStr::new(""));

        let Disposition::Blocked { reason } = judged else {
            panic!("a missing program is blocked: {judged:?}");
        };
        assert!(reason.contains("`composer`"), "{reason}");
        assert!(reason.contains("<home>/bin"), "{reason}");
        assert!(reason.contains("daemon's own PATH"), "{reason}");
    }

    /// A word the rule does not judge is `Confirm` even on an empty PATH.
    #[test]
    fn a_word_that_is_not_judged_is_something_to_agree_to() {
        assert!(matches!(
            disposition("echo hello> made.txt", OsStr::new("")),
            Disposition::Confirm { what } if what == "echo hello> made.txt"
        ));
    }
}
