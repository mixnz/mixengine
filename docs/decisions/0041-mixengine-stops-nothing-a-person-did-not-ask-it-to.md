# 0041. MixEngine stops nothing a person did not ask it to stop

**Status**: Accepted
**Date**: 2026-09-19

## Context

A person using MixLab does not know or care how MixEngine saves memory. What they notice is that a
site that worked this morning does not open now, and at that point they blame the app, not an idle
policy. On a default home two things produced exactly that, and both were the design working as
written:

- **Idle shutdown was on by default.** T70 gave a php-fpm pool 30 minutes and T70a gave every
  database and cache 60. The next request is supposed to start them again. When it does, the first
  load is slow. When it does not, because the wake was never built for that path or it failed, the
  site is down, and the Dashboard shows **Stopped** in red for something nobody stopped.
- **The front end did not come back with the daemon.** `service.create` left `autostart` off, and
  T116/T129 refused to turn it on for anybody. After a reboot, after *Start MixEngine*, or after any
  fresh daemon, nothing listened on 80/443 and every site was dead until somebody started Caddy by
  hand. The on-demand fallback could not help, because it lives inside the front end's own
  configuration.

## Decision

**A site that was up stays up until a person stops it.** Saving resources is something a person
turns on.

1. **No recipe idle-stops by default.** `Recipe::idle_default()` answers `None` everywhere. The
   numbers T70/T70a chose move to `Recipe::idle_when_saving()`, and a row nobody set (`idle_minutes
   IS NULL`) gets them only while the home's switch is on. That switch is the `settings` row
   `services.save_resources`, off when absent. MixLab shows it as *Save battery*; the CLI has
   `mix service save-resources`. A row somebody did set (`0` or `n` minutes) keeps what they said.
2. **A front end is created with `autostart` on** unless the request says otherwise. A one-time
   migration turns it on for the `caddy` and `nginx` rows that already exist.

The mechanism does not change. Idle shutdown is still measured by real signals, still exempts what
something running depends on, and still honours keep-warm. Only the defaults change.

## Consequences

- **An upgrade changes behaviour for homes that never chose.** Rows at `NULL` stop being
  idle-stopped. This is the intended effect, and the CHANGELOG says it.
- **Somebody who deliberately turned a front end's autostart off gets it turned on once** by the
  migration. That is rarer and cheaper to undo than every site being dead after a reboot.
- A laptop with *Save battery* off keeps pools and databases running once they have started. On a
  development machine that costs tens to a few hundred MB and almost no CPU while idle.
- Keep-warm only matters while *Save battery* is on, so MixLab stops showing it on every project.
  The column, the API field and `mix project keep-warm` stay.

## Alternatives considered

**Keep the defaults and make the wake better.** A wake that works still makes the first load slow,
and one that fails is a dead site. This leaves the person paying for an optimisation they never
asked for.

**Per-service defaults in the UI.** People think "my laptop's battery", not "php-fpm, 30 minutes".
`mix service idle` stays for the few who want per-service control.

**A three-state `autostart` (unset / on / off), the way `idle_minutes` has one.** This would respect
a deliberate off exactly. It costs a schema change to a column every client reads, in order to
protect a choice almost nobody made. The one-time migration is simpler, and it is honest about the
case it overrides.
