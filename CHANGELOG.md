# Changelog

Every released version of MixEngine, newest first. Dates are the day the release was published, not
the day it was tagged.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). Until 1.0.0 a minor version may change
the API — `PROTOCOL_VERSION` in `mixengine-proto` is what a client should check, and
[ADR 0019](.claude/decisions/0019-an-added-response-member-is-optional.md) says what it does and
does not move for.

## [Unreleased]

## [0.1.0] — unreleased

The first release: a public beta. Everything below arrived across nine phases of
[the build plan](.claude/roadmap/todo.md), and what is listed here is what a person gets rather than
the order it was built in.

### Added

- **Runtimes.** PHP 7.0 through the newest stable, Node.js 16+, Python 3.10+ and Ruby 3.2+, each
  version an immutable directory of its own, none of them touching what the operating system already
  has. A directory chooses its version through `mixengine.toml`, a registered project or the global
  default — **no shell hook, nothing to activate** — and `mix runtime resolve` says which of the
  four sources decided, without running anything.
- **Services** with generated configuration: Caddy, nginx, php-fpm, MariaDB, MySQL, PostgreSQL,
  Redis and Memcached. Everything under `etc/` is rendered from SQLite and is disposable; what a
  person edits is an override, never the generated file.
- **Sites.** `http://blog.test` works after first-run setup with **zero further prompts** — hosts
  entries, a local DNS server and resolver wiring are done once, through one elevation.
- **HTTPS, automatically.** A local CA in the operating system's own trust store, leaf issuance,
  renewal, and a green padlock in every browser including Firefox's own NSS databases.
- **LAN sharing**, so a site opens from a phone on the same network.
- **Blueprints**: capture a working environment, sign it, apply it somewhere else.
- **Extensions**, with a signed registry — phpMyAdmin, Adminer and MixDB among them.
- **`mix doctor`**, eighteen checks with repairs that say what they will do before doing it, and
  `mix doctor --bundle` for a diagnostics archive carrying no credentials.
- **Installers**: NSIS per-user and a portable zip on Windows, a `.pkg` on macOS, AppImage, `.deb`
  and `.rpm` on Linux — across **six OS/arch targets**, ARM64 Windows and ARM64 Linux included.
- **`mix self-update`**, against a minisign-signed feed, verified before the JSON is parsed:
  download → verify → unpack → smoke → stop → swap, so a developer's database is not down for the
  length of a download.
- **A published API contract**, `ts-rs` bindings generated from `mixengine-proto`, committed and
  released as an artifact beside the binaries. This is what a graphical client is built against;
  there is no GUI in this repository, per
  [ADR 0011](.claude/decisions/0011-no-gui-in-this-repository.md).
- **A handbook** in English and Vietnamese, published at `mixnz.github.io/mixengine` and readable
  offline through `mix docs`, which answers before a home is resolved or a socket is opened.
- **Crash reports**, recorded by default and **transmitted by nothing** — there is no telemetry and
  no endpoint
  ([ADR 0022](.claude/decisions/0022-a-crash-report-is-recorded-by-default-and-sent-by-nothing.md)).

### Security

- **Nothing runs as root.** The few operations that need privilege — the hosts file, the OS trust
  store, resolver configuration, firewall rules — are done by a short-lived `mixengine-elevate` that
  validates every request itself rather than trusting the daemon, and exits
  ([ADR 0005](.claude/decisions/0005-on-demand-elevation.md)).
- **No Docker and no VM.** Managed processes are native
  ([ADR 0003](.claude/decisions/0003-no-container-isolation.md)).
- A supervised child never inherits Administrators on Windows
  ([ADR 0010](.claude/decisions/0010-supervised-child-never-inherits-administrators.md)).
- Every downloaded artifact is verified by SHA-256 against a minisign-signed index whose public key
  is compiled into the binary, and is proven to *run* before it is registered.

### Known limitations

Named here because each was measured rather than assumed, and none of them is a surprise waiting to
happen:

- **A machine with Smart App Control enforcing is not supported.** MixEngine detects it, names it
  where a program will not load, and does not ask anyone to turn it off — turning it off cannot be
  undone without reinstalling Windows. A code signing certificate does not repair this: it would
  cover the four images this project builds, while PHP, nginx, Caddy, Python and Ruby are all
  unsigned upstream and Smart App Control judges each image load on its own file
  ([ADR 0017](.claude/decisions/0017-smart-app-control-is-an-unsupported-configuration.md)).
- **Nothing is code-signed or notarised**, by design and not by omission. Expect SmartScreen on
  Windows and the Gatekeeper "Open Anyway" path on macOS at first launch.
- **On a Windows machine with an ARM processor, some versions run under emulation.** Upstream
  publishes no ARM64 Windows build of six of the eleven things MixEngine installs — PHP among them —
  so the x86_64 build is installed and Windows runs it. `mix runtime available` marks those rows
  `emulated` ([ADR 0023](.claude/decisions/0023-an-arm64-windows-machine-runs-the-x86_64-build.md)).
- **`redis 7.2.15` cannot be installed on Windows**, on either architecture: it builds there and
  does not start.
- **Two readings have not been taken**, and both need hardware rather than code — the first run of a
  freshly built unsigned binary against Defender's `HostsFileHijack` heuristic on a clean Windows 11
  machine, and macOS 15's Gatekeeper flow in Finder. They are roadmap tasks **T41a** and **T86a**,
  they gate publishing rather than building, and this release is cut with them open deliberately.
- **Two homes on one machine bootstrapping a service of the same name can collide** over a shared
  `/tmp` view on Unix — roadmap task **T33b**.

[Unreleased]: https://github.com/mixnz/mixengine/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/mixnz/mixengine/releases/tag/v0.1.0
