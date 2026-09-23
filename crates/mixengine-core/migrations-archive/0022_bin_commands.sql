-- Tools somebody installed into a runtime, which `<root>/bin` fronts — roadmap task **T131**.
--
-- `npm install -g yarn` writes `yarn`, `yarn.cmd` and `yarn.ps1` into the Node install's own
-- directory, which is on nobody's PATH: only `<root>/bin` is, and until this table that directory
-- was a projection of a compile-time constant. So the command existed, worked, and could not be
-- typed.
--
-- **Why a table at all, when the disk already knows.** A shim is handed one thing — the name it was
-- invoked by — and has to answer *which language's version resolution decides which copy of `yarn`
-- runs*. Deriving that would mean listing the global directory of every installed runtime on every
-- invocation, so the name is written down once by the pass that found it and read back with a
-- single query. It is also what the refresh needs in order to fill `bin/` at all.
--
-- **A projection and never a record.** `bin_commands::record` rewrites it whole in one transaction,
-- the way `etc/` is rebuilt rather than patched, so a row here never outlives the file it describes
-- by more than one scan. Nothing else may write it, and nothing reads it back into state.
CREATE TABLE bin_commands (
    -- The command as it is typed, with no executable suffix — `yarn`, not `yarn.cmd`. Folded to
    -- lower case by the writer on Windows, where `Yarn` and `yarn` are one file and two rows would
    -- be two copies of the shim racing for one name.
    name TEXT PRIMARY KEY,

    -- `mixengine_proto::RuntimeKind`, spelled exactly as `RuntimeKind::as_str` writes it. Not
    -- CHECKed for the reason `packages.name` is not: the list is Rust's and closed there, and a
    -- constraint here would be a second opinion about the same vocabulary — `bin_commands::all` is
    -- what refuses a word this build cannot read, with a sentence naming the row.
    kind TEXT NOT NULL
) STRICT;
