---
status: approved
date: 2026-09-23
task: T179
---

# T179: A want that is gone leaves the queue

Found while taking [T41a](../roadmap/phase-4-sites-and-elevation.md)'s readings, 2026-09-22.

## The case

The elevation queue is how MixEngine asks for the few things that need an administrator. A producer
reads what this home declares, compares it with the machine, and queues an operation when the two
differ. `mix elevation status` lists what is waiting, and `mix elevation grant` raises one prompt for
all of it.

**A producer can add to that queue and cannot take anything out of it.** `Elevation::require_hosts`
returns early when the machine already matches what the home declares, and an operation queued by an
earlier reading is left where it is.

Measured on 2026-09-22 with a sandbox home, no grant in between:

1. `mix site create --domain hd.local --i-know --kind static` → waiting: *point 1 name at 127.0.0.1
   in the hosts file: hd.local*.
2. `mix site delete hd.local` → still waiting: *point 1 name at 127.0.0.1 in the hosts file:
   hd.local*, for a home that now declares no such site.

Two things follow, and the second is the one that matters:

- **The sentence is wrong before a prompt.** On the Hyper-V machine the same defect read from the
  other side: the queue said *remove MixEngine's block from the hosts file* while a site declared a
  name, and granting it wrote the block. What a person reads and what the grant does were two
  different things, one click apart.
- **Granting writes something nobody declared.** In the reproduction above, a grant would put
  `hd.local` in the machine's hosts file for a home that has no such site.

`mix elevation drop` exists, but it is a person's decision about a want, not a mechanism for a want
that has already evaporated.

## Principle

**A producer answers one question — what does this machine need? — and "nothing" is an answer it has
to be able to give.** A queue that only grows describes a machine that no longer exists.

## D1. `withdraw`, beside `enqueue`

`mixengine_core::elevation` gains one function, the opposite of `enqueue`:

```rust
/// Forget the operation of one family, because this machine no longer needs it.
pub async fn withdraw(store: &Store, key: &str) -> Result<usize>
```

It deletes the row whose `dedupe_key` is `key` and answers how many went (0 or 1, since the key is
unique). `key` is `PrivilegedOp::dedupe_key`'s own value, so the family is spelled once:
`hosts-apply`, `resolver`, `trust-store`, `port-access`.

The daemon wraps it, on `Elevation::enqueue`'s shape:

```rust
async fn no_longer_needed(&self, key: &str) -> Result<(), Error>
```

**It publishes `ElevationRequired` with the queue that is left** when a row went, and nothing when
none did. That event carries the whole queue rather than the newest row, so a client that drew the
old list redraws the shorter one. A withdrawal that removed nothing is not news, on the same rule
that keeps a producer's retry loop off a client's screen.

## D2. Where a producer says "nothing"

Each producer withdraws its own family on the path where it finds the machine already agrees, and
only there:

| Producer | Withdraws when |
| --- | --- |
| `require_hosts` | the block on disk equals the block this home declares |
| `require_resolver` | `state.plan(..)` is `None`: the machine already routes what it should |
| `require_trust_store` | `state.plan(..)` is `None`, and the home that has no authority at all |
| `require_port_access` | `state.granted`, or the plan this system cannot make |

**A reading that failed withdraws nothing.** Every one of these producers already returns early when
a probe cannot read the machine, and the reason is written down in each: a probe that failed has said
nothing about what to ask for. It has said nothing about what to stop asking for either.

**Withdrawing is not revoking**, which matters most for `require_port_access`: T42's D12 refuses to
revoke a capability here, because a home with no front end cannot supply the binary the question
needs. Withdrawal touches this home's queue and never the machine, so a grant nobody has answered
stops being offered while the machine keeps whatever it already has. A home with no front end still
withdraws nothing, because it still cannot read the machine.

## D3. The firewall producer needs no change

`sites::sharing::wants_the_firewall` enqueues the whole state every time, including the empty one:
unsharing the last site queues *apply no rules*, which is a real operation on a machine that holds
rules. It never short-circuits, so it has no path where a stale row survives.

What it does instead is queue an operation on a machine that may already hold no rules. That is a
prompt with nothing behind it rather than a wrong sentence, it is not what T41a found, and it is left
alone here.

## D4. A deletion still costs a prompt, and that is right

Deleting the only site that needed a hosts entry, **after** the entry was granted, leaves the block
on disk and the queue holding *remove MixEngine's block from the hosts file*. That is unchanged by
this task: the machine really does hold something this home no longer declares, and removing it needs
an administrator. What changes is only the case where the machine and the home already agree.

M4's *"creating a site prompts for nothing"* is about a machine already wired by first-run setup, and
is not touched.

## How it is proven

- **`mixengine-core`:** `withdraw` removes the row of one family and leaves the others; withdrawing
  what is not there is not an error, on `discard`'s rule.
- **`mixengine-daemon`, against the mock host:**
  - a queued `hosts-apply` goes when the hosts file already matches what the home declares, and the
    event that follows carries the shorter queue;
  - a queued `resolver`, `trust-store` and `port-access` each go on their own producer's agreeing
    path;
  - a probe that fails leaves the queue as it was, for each of the four.
- **`crates/mixengine-cli/tests/`:** the reproduction itself, unignored — create a site with a
  `.local` domain, delete it, and `elevation status` is empty.

## What this does not do

- It does not change `mix elevation drop`, which stays a person's decision.
- It does not revoke anything on the machine, and it does not add a producer that could.
- It does not touch the firewall producer (D3), or the uninstall's rows, which are not producers.

## Settled before approval

1. **`require_trust_store` withdraws when the home has no authority** (`der` is `None`): there is
   nothing left to trust, so a queued install describes a home that no longer exists. A store that
   could not be *read* is the other case, and it still withdraws nothing.
