# Phase 30 — A copy only you can read

*Goal: a person's second machine has what they ticked and nothing they did not, and the server that
carried it cannot read a byte of it.*

Part of the [build plan](todo.md). Legend: `[ ]` todo · `[~]` in progress · `[x]` done.

Design: [2026-09-20-t177-a-copy-only-you-can-read-design.md](../specs/2026-09-20-t177-a-copy-only-you-can-read-design.md).
Decision: [ADR 0045](../decisions/0045-mixlab-has-an-account-and-mixengine-does-not.md).

---

- [ ] **T177a** The key hierarchy and the record envelope, in `apps/desktop/src-tauri/src/sync/crypto.rs`:
      Argon2id, the four HKDF expansions, XChaCha20-Poly1305 with `collection || id || deleted` as
      AAD, and the wrap/unwrap of `MK` under a password and under a recovery key. No network, no
      account, no storage. It carries test vectors and is written to be read in one sitting —
      spec D1 says the promise is a property of this file and of nothing on the server.
- [ ] **T177b** `/v1` frozen at the spec's D4, and the **conformance suite written first** — before
      the server it will judge, because a suite written afterwards only ever describes what was
      built. Then `mixlab-sync` on Cloudflare Workers, one Durable Object per account: its
      serialized execution is what makes the compare-and-swap and the monotonic `seq` correct, its
      SQLite storage holds the record table, and its alarms reap tombstones at ninety days.
      Registration and email verification through an external provider, login, refresh and
      revocation, the device list, a per-account quota, rate limiting inside the object, and
      `/v1/capabilities`. Nothing in it parses a ciphertext.
- [ ] **T177c** The client half of the protocol: pull by cursor, push under `If-Match`, the `409`
      resolved by `updatedAt` with the device id breaking a tie, and `batch` for the first push
      from a machine that already has a hundred saved things.
- [ ] **T177d** A module lends a collection without the shell learning what it is.
      `ModuleDefinition` gains the syncable set — id, label, reader, writer, default `false` — and
      `registry.ts` wires it as it already wires tabs. `npm run lint` still refuses a third file
      outside `src/modules/` that names a module.
- [ ] **T177e** The account, in Settings: sign up with the recovery-key ceremony (ten groups shown
      once, two typed back), sign in, the per-collection list with every row off, the device list
      with a revoke, the conflict prompt, and the server field for somebody hosting their own.
- [ ] **T177f** The three credential collections — `connection-secrets`, `terminal-host-secrets`,
      `rest-env-secrets` — each behind its own row, each refusing to turn on until the collection it
      belongs to is on.
- [ ] **T177g** What a stranger needs to run one: the server's README, a single-binary deployment,
      and the conformance suite pointed at their own instance. Plus the refusals the spec names —
      history, drafts, workspace layout and usage counts are not in the list, and a test says so by
      enumerating it rather than by trusting the UI.

**The self-hosted binary is deliberately not in this phase.** The spec's D8 commits to a second
implementation — native Rust over a SQLite file — because `/v1` is only a protocol if something
other than the Worker has ever spoken it. It is sequenced after, not dropped, and the thing that
keeps it writable is T177b's ordering: the conformance suite exists before the first server, so it
describes the document rather than the deployment. Its trigger is somebody asking to self-host, and
the task is written then.

**Milestone M30** — on two machines: a fresh install signs in and reproduces exactly the
collections that were ticked, with the rows that were not ticked absent; revoking a device from the
other machine ends its next sync; and **the server's SQLite file, opened by hand, yields no
plaintext** — no host name, no URL, no collection name, nothing but opaque ids and ciphertext. The
last of those is the milestone the other two exist to protect.
