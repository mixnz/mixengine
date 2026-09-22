---
status: approved
date: 2026-09-23
task: T180
---

# T180: A firewall prompt with work behind it

Follow-up to [T179](2026-09-23-t179-a-want-that-is-gone-leaves-the-queue-design.md), which named this
and left it alone. Phase 8. 2026-09-23.

## The case

`sites::sharing::wants_the_firewall` queues the whole state every time sharing changes: the ports
every shared site needs, or none when nothing is shared. Unlike the other four producers it never
compares anything, so it queues an operation whether or not the machine already holds those rules.

Two shapes of a prompt with nothing behind it:

- **Share, then unshare before granting.** The first change queues *allow 80 and 443*; the second
  replaces it with *allow no ports*, on a machine that was never opened. A person is asked to
  approve a change that changes nothing.
- **Share a second site.** The plan is the same two ports the first share already had applied, and
  it is queued again as if it were new.

T179 fixed the four producers that read the machine. This one cannot read the machine: T74 decided
that the daemon never reads the firewall back, because a rule set is not a thing two homes could
agree about, and the platform's only read (`FirewallRules::naming`) counts rules naming a *program*
rather than MixEngine's own port-scoped ones.

## Principle

**A producer asks for what it has not already had applied.** Where the machine cannot be read, what
this home last had applied is the honest stand-in, and it is a fact this daemon owns rather than one
it guesses.

## D1. The home remembers the plan it had applied

One settings row, written by the daemon and read by nobody else:

```text
key    firewall.applied
value  {"ports": [80, 443], "label": "MixEngine — shared sites"}
```

It is the `FirewallPlan` the helper last reported as done, and it is absent on a home that has never
granted one. `mixengine_core::updates::records::{get, set}` already read and write this table, and
they are generic over the value.

**Absent means no rules**, which is what a fresh home has. A machine whose rules somebody removed by
hand is therefore not noticed, and that is unchanged from today: nothing here has ever read them.

## D2. The grant is what writes it

When a grant settles, the daemon already has each operation and its outcome. A `FirewallApply` that
comes back `Applied`, `AlreadyDone` or `Unmanaged` writes its plan to `firewall.applied`; `Refused`,
`Unsupported` and `Failed` write nothing.

**`Unmanaged` counts, on `settle`'s own rule.** macOS in its ordinary configuration and a Linux
running neither `ufw` nor `firewalld` answer `Unmanaged`, and T74 already settles that beside
`Applied` so the queue stops asking. Recording it keeps the next identical plan from queueing the
same unanswerable prompt. A different plan still queues, and still gets the sentence with the manual
command in it.

## D3. The producer compares, and withdraws

`wants_the_firewall` builds the plan it builds today, then:

- the plan **equals** `firewall.applied` → `Elevation::no_longer_needed("firewall")`, T179's
  withdrawal, so a queued row from an earlier change goes with the want;
- the plan **differs** → enqueue, exactly as today.

The empty plan is not a special case: a home that has never shared has no record, which reads as no
ports, which equals the empty plan.

## Cost

One settings read per sharing change, and one write per grant that carried a firewall operation.

## Alternatives not taken

- **Read the machine's rules back.** `netsh advfirewall firewall show rule` can be filtered by our
  label on Windows, but `ufw` has no comment field to name a rule of ours with — T76 says so — and
  macOS has no port rules at all. It would be one system's answer dressed as three.
- **Keep queueing and let the helper answer `Unchanged`.** That is what happens now. The helper is
  right, and the person still saw a prompt for it.
- **Drop the empty plan and queue nothing.** It would fix the first shape and break the second:
  unsharing a site on a machine that *does* hold rules must still ask to remove them.

## How it is proven

**At the two seams, because the third is not available here.** `sites::sharing`'s own tests are pure
— they have no store and no daemon — and the CLI's `sharing.rs` is `#[ignore]`d behind a real Caddy,
so a share-then-unshare round trip cannot be asserted in an ordinary `cargo test`. What is asserted
is each half, where each half lives:

- **`sites::sharing`:** the decision as a pure function of *what was applied* and *what is wanted*.
  No record and no ports agree; no record and two ports differ; the same two ports agree whatever
  the label says; two ports against three differ.
- **`mixengine-daemon`'s elevation tests**, which do have a store: a settled batch carrying a
  `FirewallApply` writes the plan under `firewall.applied` for `Applied`, `AlreadyDone` and
  `Unmanaged`, and writes nothing for `Refused`, `Unsupported` and `Failed`.
- **`mixengine-core`:** nothing new. `records::get`/`set` are already tested.

## What this does not do

- It does not read this machine's firewall, and it does not add a platform capability that could.
- It does not change what `mix site share` renders, including the manual command an `Unmanaged`
  machine is given.
- It does not touch the other four producers, which T179 settled.

## Settled before approval

1. **`Unmanaged` writes the record** (D2): `settle` already treats it as finished, and not recording
   it would ask a machine with no mechanism the same unanswerable question after every share.
