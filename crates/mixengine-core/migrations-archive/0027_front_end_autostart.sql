-- The web server starts with the daemon — roadmap task **T167e**, ADR 0041.
--
-- `service.create` now creates a front end with `autostart` on unless it is told otherwise. This is
-- the same answer for the front ends that already exist: until now nothing ever turned it on, so a
-- reboot or a fresh daemon left port 80 empty and every site down until somebody started Caddy by
-- hand.
--
-- **One time, and it overrides a deliberate off.** `autostart` has two states, not three, so this
-- cannot tell a front end nobody touched from one somebody turned off on purpose. The second is rare
-- and a click to undo; the first is every home. The CHANGELOG says so.
--
-- **The two package names are spelled out** because a migration cannot ask the recipe catalogue
-- which programs are front ends. It is a fact about the rows as they are today, frozen with this
-- file. An extension's service has no `package_id` and is not touched.

UPDATE services
   SET autostart = 1
 WHERE package_id IN (SELECT id FROM packages WHERE name IN ('caddy', 'nginx'));
