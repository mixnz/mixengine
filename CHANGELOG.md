# Changelog

## 0.0.1-beta.1 — unreleased

The first public beta.

- PHP 7.0+, Node.js 16+, Python 3.10+ and Ruby 3.2+, one immutable directory per version, chosen
  per directory with no shell hook and nothing to activate.
- Caddy, nginx, php-fpm, MariaDB, MySQL, PostgreSQL, Redis and Memcached, run from generated
  configuration that is regenerated rather than edited.
- `http://blog.test` and trusted HTTPS with no prompts after first-run setup; LAN sharing,
  blueprints, extensions and `mix doctor`.
- Installers for six OS/arch targets, a signature-verified `mix self-update`, a handbook in English
  and Vietnamese, and a published TypeScript API contract for clients.

A MixEngine built from source keeps its own home directory (`MixEngine-dev`), so a working tree
cannot migrate the database a released MixEngine is using.

Nothing is code-signed or notarised, by design: expect SmartScreen on Windows and Gatekeeper's
"Open Anyway" on macOS. A machine with Smart App Control enforcing is not supported. On ARM64
Windows some runtimes have no build of their own and run under emulation, marked `emulated` in
`mix runtime available`.
