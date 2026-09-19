# 0025. A credential is answered only by a method that exists to answer it

**Status**: Accepted
**Date**: 2026-09-06

## Context

Roadmap task **T77a**'s design settled a rule and wrote three tests to guard it:
`database.create` and `database.open` name the address a credential lives at and never the value
itself. `mixengine-proto/src/database.rs`'s own module note states it as the type's whole reason for
existing — *"What is not here is the password"* — and
`nothing_on_the_wire_is_shaped_like_a_password` and
`a_handoff_names_the_keyring_address_and_nothing_shaped_like_a_password` assert it of every response
those two methods answer.

Roadmap task **T77b** needed a way for a person to get a database's password into a project's own
`.env` — the one place T77a's design left unreached, since `database.open`'s recipient is a process
MixEngine starts, not a file a person edits by hand. `architecture/security-model.md` had already
promised this, in a line written before `mix database` existed: *"`mix service credentials <id>`
reveals it on demand."* No such command was ever built — `roadmap/phase-8-differentiators.md`'s T82
entry records finding the promise broken: *"the manifest cited a `mix service credentials` that does
not exist."*

Adding the command means a response that carries a password for the first time in this workspace,
which is the T77a rule's exact opposite. Both cannot be written down as this workspace's rule at
once; one has to be the general case and the other the named exception.

## Decision

**A credential crosses the wire only in the response of a method whose entire purpose is to answer
it, and never as a member of a response serving some other purpose.**

`database.create` answers `DatabaseAccount`, `database.open` answers `DatabaseHandoff`, and neither
gained a password field: both keep naming the address only, and both keep the tests that assert it.
`database.credentials` is the one method built for the opposite reason — asked, it answers
`DatabaseCredentials { service, user, secret, password }`, and a test
(`a_credentials_answer_does_carry_the_password_because_that_is_what_it_is_for`) asserts the
serialised form *does* contain the value, inverting every neighbouring test in that file on purpose.

`DatabaseCredentials` still redacts on `Debug`: its hand-written implementation prints the
password's byte length and never the value, on the precedent
`generate::databases::Credentials` set for the same reason — a `tracing` line on a failed request is
one call away from printing whatever `{:?}` finds, and this is the one response type where that
would matter.

Safe to write down because of what the transport already is:
[daemon-and-ipc.md](../architecture/daemon-and-ipc.md) — the endpoint is owner-only and
kernel-enforced, a Unix socket at mode `0600` with peer credentials checked, or a named pipe whose
DACL names one SID and whose owner a client verifies before it sends. Whoever can call
`database.credentials` can already reach the same value two other ways: `database.open` puts it in
a process's environment, and the OS credential store lists the entry under `mixengine` for anyone
with the account's own login. `database.credentials` adds a *third* way to reach a value already
reachable by the same person, not a new exposure.

## Consequences

`ServiceSpec`'s own rule — [ADR 0006](0006-servicespec-in-proto-and-secret-free.md) — is untouched.
That rule is about a document generated to disk and read by a supervisor for the life of a service;
this is a reply that exists for the length of one request, and it governs a different question:
never *at rest*, versus never *by accident*.

The next response that wants to carry something password-shaped has to ask which rule it is under.
If its purpose is something else — creating an account, handing a process a credential, describing
a server — the password stays out, exactly as `DatabaseAccount` and `DatabaseHandoff` show. If its
whole purpose is answering a credential, it is a new method built for that, with its own redacting
`Debug` and its own test asserting the value is present on purpose — not a field added to a response
that already exists.

`docs/superpowers/specs/2026-09-06-t77b-a-password-a-person-can-read-and-choose-design.md` is where
this task's fuller reasoning and its CLI shape live; this records the rule for whoever adds the next
method and finds two precedents pointing opposite ways.

## Alternatives considered

**A `--reveal` flag on `database.create` and `database.open`.** Rejected: it would put a password in
the answer of a method whose every other caller — `blueprint.apply`, a future graphical client —
does not ask for one and must not be handed one it never requested. A flag that changes a response's
*shape* rather than its *content* is the harder rule to keep, since a caller that forgets to check
for the field would silently start compiling a value it should never hold.

**Reading the keyring directly from `mix`, bypassing the daemon.** Rejected on
[ADR 0006](0006-servicespec-in-proto-and-secret-free.md)'s own layering and on
`mixengine-platform`'s design: a CLI process touching the OS credential store directly is a second
reader of an entry the daemon owns, and on macOS a keychain item's ACL names its creator — a second
process asking for the same entry is the dialog `mariadb.rs`'s module note measured costing a whole
CI run. The daemon reading its own entry and answering over IPC is what keeps the read silent.
