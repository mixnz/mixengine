---
name: tests-that-say-why
description: Use when writing or changing any test that starts a real program, a daemon, a service or a command — and when a CI failure turns out to be unreadable, so the next one is not.
---

# Tests that say why

The rule lives in [docs/standards/testing.md](../../../docs/standards/testing.md), **Mandatory rule
8**. Read it there; this file is the how.

A test fails twice: once on the machine that wrote it, where everything is inspectable, and once on
CI, where the only artifact is the message. Write the message for the second reader.

## The question to ask before committing an assertion

> If this fires on a Windows runner at 3 a.m. and I cannot reproduce it, is there enough in the
> message to name a cause?

If the answer is "I would run it again", the assertion is unfinished.

## Where the answers are in this workspace

| The test drove | Print |
| --- | --- |
| a service (`service start`, a pool, a front end) | its **own** log: `harness::frontend::service_log(&home, id)` — service output never reaches `daemon.log`, per ADR 0009 |
| a `mix` command | `String::from_utf8_lossy(&output.stderr)`, and `stdout` when the assertion is about what was printed |
| the daemon's behaviour | `home.daemon_log()` |
| a file it wrote | the bytes that were there instead, not "assert failed" |
| an HTTP or RPC answer | the status **and** the body |

More than one applies more often than not. `php_extensions` printed the daemon's log and not the
pool's, which is exactly the half that mattered.

## Shape

```rust
assert!(
    started.status.success(),
    "the pool would not start
--- stderr ---
{}
--- the pool's own log ---
{}
--- daemon ---
{}",
    String::from_utf8_lossy(&started.stderr),
    harness::frontend::service_log(&home, &pool),
    home.daemon_log()
);
```

Sections with headers, because a reader is skimming a CI log and needs to know which program each
block came from.

## When the product is the thing that is silent

Sometimes the test cannot print what does not exist. A ready timeout once reported "not ready within
15s" and nothing else, because the daemon had the service's last lines in hand and dropped them.
Then the fix is in the product, not the test — and it ships with a test of its own that the message
now carries them (`a_service_that_was_not_ready_in_time_has_its_last_lines_in_the_daemon_log`).

**Check that test by removing the product change and watching it fail.** A diagnostics test that
would pass without the diagnostics proves nothing.
