# T78b — a scaffold's program is checked at plan time (design)

Proposed roadmap task **T78b**, phase 8, following T78a: *"A `[scaffold]` whose program is not on
the PATH it would run with is a `blocked` step in the plan, not a shell error at the end of an
apply — and it blocks the command, never the project."*

## What was observed, and how

`mix blueprint apply laravel --use-installed --run-scaffold --grant` on a Windows machine with the
0.0.6 release installed. Eleven steps applied — project, runtimes, database and user, site, domain,
certificate, extension — and the twelfth printed:

```
'composer' is not recognized as an internal or external command,
operable program or batch file.
```

Three things about that line, none of them the scaffold's fault:

- **It arrived last.** The plan had said `confirm run composer create-project ...` beside eleven
  steps that were decided up front; the one step it could not decide was the one it left to the
  shell. T77's D10 — *decided here rather than five actions into an apply* — is the rule the
  scaffold step alone does not follow.
- **The person tried to fix it in the only place the message pointed at.** They copied `composer`
  into `<home>/bin`, because that is the directory the plan puts in front of `PATH`. The daemon's
  next start swept it (`filled bin/ ... removed=["composer"]` in `daemon.log`), which is `bin/`
  doing what T26 designed — a projection of `core::shims::COMMANDS`, repaired at every start — and
  nothing had told them so. The file was also named `composer` with no extension, which `cmd.exe`
  would never have run regardless: a working terminal was Git Bash, and the scaffold's shell is not.
- **The product does not ship `composer`, on purpose.** T25 keeps it out of the shim table because
  it is inside no runtime artifact. Two of the six gallery blueprints (`laravel`, `symfony`) run it
  anyway, and nothing between the gallery and the shell asks whether it is there. Shipping it is a
  separate decision with its own ADR; this task is what makes the gap *visible* whether or not that
  decision is ever taken.

## Goal

A plan says, before anything is written, that the scaffold's program is missing — as a `blocked`
step naming the program and the PATH it was looked for on. An apply with a consent for that command
is refused up front with the same words. An apply without one still applies everything else, exactly
as T78a promised, and reports the step as not run for that reason. Nothing changes for a scaffold
whose program is there.

## Scope

**In:**

- One lookup in `mixengine-platform`: is a bare program name on a given `PATH`, by the rule the
  shell that would run it uses.
- The scaffold step's disposition in `core::blueprints::plan`, decided against the PATH the daemon
  would actually hand the command.
- The daemon refusing an apply whose consent names a blocked command, and leaving a blocked command
  unrun when nobody consented.
- The gallery's `laravel` and `symfony` blueprints reporting `composer` honestly on a machine
  without it — no change to the files themselves.

**Out:**

- Shipping `composer`, or any other program a scaffold might want. That reverses T25 and is its own
  task, with an ADR.
- Judging anything past the first word. `composer create-project x && npm ci` is checked for
  `composer` and nothing else: the shell owns the rest of the line, and a check that parsed shell
  syntax would be a second parser with its own disagreements.
- Any change to `BlueprintPlan`, `PlanStep`, or `Disposition` on the wire. `Blocked { reason }`
  already exists and `mix` already prints it.
- A "skip the scaffold" flag. T78a decided there is no flag for *no*; not consenting is still how a
  script applies without the command.

## Decisions

**D1 — The check is a plan disposition, not an apply outcome.** The scaffold step is
`Disposition::Blocked { reason }` when its program cannot be found, and `Confirm` otherwise, decided
in `core::blueprints::plan::plan` where every other step is decided. `mix blueprint apply --dry-run`
prints it as `blocked run <command> — <reason>`, with the rendering `render.rs` already has. No
proto type changes and `packaging/bindings.sh` has nothing to regenerate.

**D2 — Only the first word is judged, and only when it is a bare name.** The word is the command
up to its first whitespace. It is looked up only when all of these hold:

- it contains no quote (`"`, `'`, `` ` ``) and no shell metacharacter (`$ ( ) { } | & ; < >`);
- it contains no path separator (`/`, and `\` on every system — a blueprint is one file for three
  shells) — a program named by path is the author's claim, and checking it would mean deciding what
  a relative path is relative to;
- it does not contain `=` — `VAR=value program` is an assignment, not a program;
- it is not a builtin of `cmd.exe` or `sh`. The list is small and written down in one place:
  `cd`, `echo`, `set`, `exit`, `type`, `printf`, `test`, `true`, `false`, `export`, `.`, `:`,
  `call`, `start`, `rem`, `if`, `for`. `echo hello> made.txt` — the command the scaffold suite runs
  on Windows today — has to stay `confirm`, and so does `printf hello` on Unix, where `dash` answers
  it without ever consulting `PATH`.

A word the rules skip leaves the step `Confirm`. **A false `blocked` is the more expensive
mistake**: it stops a blueprint that would have worked, on a machine where the person cannot see
why, so every doubt resolves to *not judging*.

**D3 — The PATH it is looked up on is the PATH it would run with.** `plan()` takes the PATH as an
argument and never reads the environment itself; the daemon hands it
`scaffold::environment(paths)["PATH"]` — `<home>/bin` first, then the daemon process's own `PATH` —
from the one `planned()` function a dry run and a real apply both go through. This is what makes
the answer worth trusting: the plan and the shell look at the same string.

It also names the surprise this design exists to explain. **A program installed after the daemon
started is not on the daemon's PATH** until the daemon restarts, and `<home>/bin` is swept of
strangers at every start. The reason text says both, in words:

```
`composer` is not on the PATH the command would run with (<home>/bin, then the daemon's own PATH)
```

and the refusal's hint says what to do about it: *put it on your PATH and restart the daemon, or
apply without `--run-scaffold`* — never *copy it into `bin/`*.

**D4 — The lookup lives in `mixengine-platform`, one rule per shell.**
`process::program_on_path(name: &str, path: &OsStr) -> Option<PathBuf>`, with the platform crate's
usual per-OS split behind one signature:

- **Windows** follows `cmd.exe`: in each `PATH` entry, a name containing a `.` is tried as written,
  and then every extension in `PATHEXT` is appended in order (`.COM;.EXE;.BAT;.CMD;...`, with the
  compiled-in default `cmd.exe` uses when the variable is absent). A bare `composer` with no
  extension is *not* a hit — which is exactly the file the person copied and exactly what `cmd.exe`
  said about it. `cmd.exe` also searches the current directory first; the scaffold's current
  directory is the project root, which is empty at that moment, so that step is not modelled.
- **Unix** follows `execvp`: in each `PATH` entry, a regular file with any execute bit set.

An empty `PATH` entry (`a::b`) means the current directory to `sh` and is skipped here for the same
reason: the project root holds nothing yet. The function reads `PATHEXT` and nothing else from the
process environment, and the caller supplies `PATH`, so a test can build one from a temporary
directory.

**D5 — A blocked scaffold blocks the command, not the apply.** This is the one place `Blocked`
does not mean *this plan never becomes a job*, and it follows from what T78a already made the
scaffold: the single step that is optional. Concretely:

- `refusal()` counts every `Blocked` and `Unsupported` step **except** a `RunScaffold`; a blocked
  scaffold is refused only when the request carries a consent for it, as
  `precondition_failed` with the reason as its message and D3's hint.
- `steps::untouched_with_consent` answers `StepResult::NotRun { why: reason }` for a blocked
  `RunScaffold`, with or without a consent — with one it was refused before the job existed, so
  reaching here means the plan changed underneath the apply, and *not running* is the safe reading
  of a command whose program is not there.
- Nothing else in the executor changes; a blocked scaffold never reaches `scaffold::run_command`.

Refusing the whole apply instead would have been fewer lines and would have taken back T78a's
promise that *a blueprint must not become worthless over the one step nobody answered for* — on
exactly the machines where it matters, the ones without `composer`.

**D6 — The gallery is not edited.** `laravel.toml` and `symfony.toml` keep `composer
create-project`; what changes is that a home without `composer` now reads `blocked` where it read
`confirm`. `nextjs.toml` runs `npx`, which is a shim in every home, and stays `confirm` everywhere.
The gallery's own rule in `blueprints.md` — spelled the same for `cmd.exe` and `sh` — gains the
sentence that its first word has to be a program, because the plan now reads it as one.

## Testing

- **`mixengine-platform`**, unit tests beside `program_on_path`, on a temporary directory:
  Windows finds `tool.bat` and `tool.exe` for `tool`, and does not find a bare `tool`; Unix finds a
  file with `0o755` and not one with `0o644`; a name that is nowhere is `None`; an empty entry and
  a missing directory in `PATH` are skipped without error.
- **`mixengine-core`**, in `plan.rs` beside the existing scaffold tests, with a PATH of one
  temporary directory: an absent program is `Blocked` with D3's words; a present one is `Confirm`;
  `echo hello> made.txt`, `"C:\x\y.exe" --flag`, `VAR=1 program`, `./local` are all `Confirm`.
- **`mixengine-daemon`**, beside `refusal` and `untouched_with_consent`: a blocked scaffold with a
  consent is refused as `precondition_failed`; without one it is not a refusal; a blocked
  `RunScaffold` step is `NotRun` with the reason.
- **`mixengine-cli`**, in the `scaffold` suite, which already imports a blueprint with a command of
  its choosing: a command whose program is a name nothing on the machine has — `--dry-run` prints
  the `blocked` line, `apply` without `--run-scaffold` succeeds and reports the step not run,
  `apply --run-scaffold` exits non-zero with the refusal. The existing `echo` / `printf` tests
  are what prove D2's builtin rule.
- **By hand, on this machine**, against a dev build in a sandbox home: `mix blueprint apply laravel
  --dry-run` shows `blocked` for `composer`; the same with `composer.bat` on the PATH the daemon was
  started with shows `confirm`.

## What this closes, and where it is written

- `.claude/roadmap/phase-8-differentiators.md`: a `T78b` entry after T78a, ticked when it lands,
  pointing at this document.
- `.claude/features/blueprints.md`, *Scaffold commands*: one bullet for D1–D5, and the gallery
  paragraph's first-word rule (D6).
- The next task, whether MixEngine ships `composer`, starts from the sentence this one leaves in
  every plan: the gap is now on the screen instead of at the end of the job.
