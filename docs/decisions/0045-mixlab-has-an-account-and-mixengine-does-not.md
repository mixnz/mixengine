# 0045. MixLab has an account, and MixEngine does not

**Status**: Accepted
**Date**: 2026-09-20

## Context

A person who uses MixLab on two machines keeps two of everything by hand. Carrying saved
connections, REST collections and snippets across is worth building, and the design is
[T177](../specs/2026-09-20-t177-a-copy-only-you-can-read-design.md). Three accepted documents have
to be answered first, because a careless reading of any of them forbids it.

**[ADR 0022](0022-a-crash-report-is-recorded-by-default-and-sent-by-nothing.md) says there is
nowhere to upload to** — *"No transmission. No endpoint, no client, no queue, no key"* — and
[../features/updates.md](../features/updates.md) says there is no telemetry here. Both sentences
were written about a crash reporter, and both were arguments about **MixEngine counting its users**.
Neither was an argument about a person choosing to put their own files somewhere.

**[CLAUDE.md](../../CLAUDE.md) says there is no client-only capability**: every mutating API method
must be reachable from `mix`. An account reachable only from a window would break that rule — if
the account were MixEngine's.

**[ADR 0027](0027-the-desktop-client-lives-in-this-repository.md) already drew that line**, for
exactly this shape of thing. Its rule 2 splits the application in two: the `mixengine` module is a
thin client of the daemon, while `db`, `rest`, `terminal` and `tools` are *"a toolbox that runs in
the application's own process … the daemon never learns they exist"*, because *"a MySQL client for
somebody's staging server is not one of MixEngine's capabilities."*

And **the repository question had been answered twice, in opposite directions**: ADR 0027 pulled
the desktop client *in*, because two installers on two cadences was what users were refusing, while
`mixengine-packages` stayed *out* and cost a whole workflow —
[gallery.yml](../../.github/workflows/gallery.yml) — built only to tell it that it had gone stale.

## Decision

**The account belongs to MixLab's toolbox, it is end-to-end encrypted, and its server lives in its
own repository.**

1. **It is the toolbox's account, so `mix` does not sign in.** What it carries is what the toolbox
   already keeps: a person's saved connections, their REST collection, their snippets. None of that
   is a MixEngine capability, so "no client-only capability" is satisfied the way ADR 0027 rule 2
   satisfies it for the toolbox itself — by the capability not being MixEngine's. The daemon gains
   no API method, `crates/` gains no binary, and a headless install is unchanged.

2. **The server cannot read what it holds.** Records are encrypted on the machine that wrote them
   under a key derived from the account password and never sent; the server stores opaque ids,
   ciphertext and a version. It follows, and is accepted, that it cannot merge, cannot search,
   cannot render anything in a browser, and cannot recover an account whose password and recovery
   key are both lost. A server able to do any of those is a server able to read.

3. **Nothing syncs until a person says which things do.** The setting is a list of collections, all
   off, with credentials on rows of their own. There is no single switch, and no collection is
   opted in by an update.

4. **The server is `mixlab-sync`, a repository of its own, from its first commit.** It is
   deployed rather than released, it is the one component here a stranger is asked to run on their
   own hardware, and it would drag a web framework and a database into a workspace whose duplicate
   ban and elevated-helper budget [ADR 0027 rule 5](0027-the-desktop-client-lives-in-this-repository.md)
   protects. ADR 0027's reason for pulling MixLab in — two installers, two updaters, two downloads
   for one product — does not apply to something nobody downloads.

   The cost is `mixengine-packages`' cost, and it is paid the same way: **the protocol is normative
   in this repository**, in the spec's D2 to D4, `/v1` is frozen before the client is written, and
   a change to it is a new path rather than an edit. The server repository carries a conformance
   suite written against that document, which also tells a self-hoster whether what they run is
   correct.

5. **ADR 0022 stands, unweakened.** A crash report is still recorded by default and transmitted by
   nothing. This decision opens no channel for it, and none for telemetry: an account proves who
   may write to a row, counts nothing, and reports nothing. The one thing that leaves a machine is
   what a person ticked, encrypted before it goes.

## Consequences

- MixLab gains its first outbound HTTP client that talks to something other than a server the user
  typed in. It is confined to `src-tauri/src/sync/`, and the toolbox lint still forbids every
  module from dialling the daemon.
- The master key joins the existing `MixLab` credential-store service rather than opening a second
  one, so macOS asks its unrecognised-application question no more often than it does today.
- Support gains a case it cannot fix. Somebody who loses both password and recovery key loses the
  data, and the registration flow spends real friction — typing part of the recovery key back —
  buying that down.
- Two repositories now describe one protocol. When `/v2` is wanted, it is two coordinated releases,
  which is the price this decision accepts in exchange for a server a stranger can read and run.
