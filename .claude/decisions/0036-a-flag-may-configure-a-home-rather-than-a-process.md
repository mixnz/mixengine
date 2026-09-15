# 0036. A flag on `mixengined` may configure a home rather than the process it starts

**Status**: Accepted
**Date**: 2026-09-16

## Context

Every flag on `mixengined` until now configured one run and was forgotten when it ended.
`--log-level` and `--log-format` shape this process's output, `--index-url` and `--update-url` name
where this process downloads from, `--detach` decides how this process ends. A person reading the
help could hold one rule: *a flag describes the daemon you are starting.*

Phase 17 needed a way for somebody to say **where a home keeps the directories that grow** — the
case that produced it is a machine whose internal disk is small and whose working disk is external.
The mechanism already existed: `[paths]` in `config.toml` moves `runtimes/`, `packages/`, `data/`
and `logs/`, and has since the beginning. What did not exist was a way to reach it. `config.toml`
lives inside the home, most people never open that directory, and a window launched from Finder or
the Start menu cannot see `MIXENGINE_HOME` at all — so for anybody who does not edit TOML by hand,
the setting may as well not be there.

The obvious shape is four flags. The question this record answers is what they should *mean*.

## Decision

`mixengined --runtimes`, `--packages`, `--data` and `--logs` **write `config.toml`**. They do not
override the layout for one run.

Three outcomes, and the second is what makes the flag usable at all:

| | |
| --- | --- |
| Differs from what the file says, nothing installed | Written, logged, the start continues |
| Equal to what the file says | No write, no complaint, the start continues |
| Differs, something installed | **The start fails**, naming what is installed |

## Consequences

**A per-run override was rejected outright, and the reason is in the schema.**
`runtime_installs.install_path` and `services.data_dir` are `TEXT` columns holding absolute paths,
written when the install happened and read forever after. Where a runtime lives is therefore not a
lookup — it is in the row. A flag that applied to one process would let a daemon a service manager
launched and one a terminal launched disagree about the same home, while the database agreed with
neither: `mix runtime list` printing paths that are not there, services failing to start, and
nothing able to say why. A setting that lives in the home cannot produce that, because whoever opens
the home gets the same answer.

**The silent no-op is not a convenience.** A launchd plist, a systemd unit or a shell alias carries
its flags for the life of that file. If asking for what the file already says were a write, the
modification time of `config.toml` would move at every boot; if it were a refusal, the flag would be
a thing that works once and then prevents the daemon from starting. Writing nothing and saying
nothing is the only answer that lets the flag live in the thing that starts the daemon.

**Failing the start is this binary's existing rule, not a new severity.** `--log-format` already
*fails the start rather than being ignored*, on the argument that silently text-formatted output is
a log nobody is reading. A daemon that quietly ran with its data somewhere other than where it was
just told to put it is the same defect with more at stake, and the refusal names the counts and the
file so the person can act.

**The window it may be used in is the database's to define.** "Nothing is installed yet" is three
row counts, not the absence of a configuration file: a first start creates the home and installs
nothing, so `mix status` on a fresh machine decides nothing and leaves the choice open. This is why
there is no `mix init` and no setup step to catch — see the phase's design document, D5.

**What this does not license.** One flag writing one file is not a general permission for flags to
mutate state. The next one that wants to will have to make this argument again, against the same
question: is the thing being set a property of *this run*, or of the home? Where the answer is the
run, the existing rule stands and the flag is forgotten when the process ends.

**`run/` is not among the four, and that is load-bearing beyond tidiness.** `Paths::new` refuses to
move it, so the elevated helper's request, its answer and its lock stay on the same disk as the
home. On macOS that is what lets a person put `data/` on an external volume without granting Full
Disk Access to anything: TCC gates a removable volume, the helper is spawned through `osascript`
with no responsible process to inherit a grant from, and it never touches the chosen disk.
