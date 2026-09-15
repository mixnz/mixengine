# 0034. MixEngine's authority reaches a runtime through a generated bundle of this machine's roots

**Status**: Accepted
**Date**: 2026-09-15

## Context

A complaint from somebody using the finished product: a Node program fetching a page from one of
this home's own sites failed with `unable to verify the first certificate`, while a browser on the
same machine showed a padlock on the same site at the same moment.

Both were right. `.claude/features/tls.md` has MixEngine install its authority into the **operating
system's** trust store, which is what a browser reads. No language runtime reads that store:

- **Node** ships a compiled-in copy of the Mozilla set and consults nothing else unless told to.
- **Ruby**'s OpenSSL is compiled here with its default-path functions resolving against the loaded
  `libcrypto` — a `ssl/cert.pem` inside the moved tree.
- **Python** uses OpenSSL's default paths, and `certifi`'s vendored bundle above them.
- **PHP** uses `openssl.cafile` and `curl.cainfo`, and the Windows artifact ships **no CA file at
  all** — so PHP there could not verify *any* HTTPS through the openssl stream wrapper. The local
  site is the case that made somebody notice, not the only one it was failing on.

So nothing was broken. MixEngine had simply never told a runtime anything.

Design:
[docs/superpowers/specs/2026-09-15-t130-what-a-terminal-inherits-design.md](../../docs/superpowers/specs/2026-09-15-t130-what-a-terminal-inherits-design.md).

## Decision

**MixEngine generates `etc/ca/bundle.pem` — every root this machine already trusts, and then its own
authority — and hands each runtime that file through the runtime's own mechanism.**

The machine's roots are read through `mixengine_platform::TrustStore::roots`, which is
`rustls-native-certs` over the Windows `ROOT` store, macOS's trust settings and Linux's
`ca-certificates`. The file is rendered at every daemon start and again after `cert.ca_rotate`, whose
fingerprint appears in the header so that a rotation makes it a *changed* file.

| runtime | mechanism | file |
| --- | --- | --- |
| Node | `NODE_EXTRA_CA_CERTS` | `certs/ca/root.crt` |
| Python | `SSL_CERT_FILE`, `REQUESTS_CA_BUNDLE` | `etc/ca/bundle.pem` |
| Ruby | `SSL_CERT_FILE` | `etc/ca/bundle.pem` |
| PHP, Composer | `openssl.cafile`, `curl.cainfo` in the generated ini set | `etc/ca/bundle.pem` |

**Node is handed the authority and everyone else the bundle**, and the asymmetry is the whole design:
`NODE_EXTRA_CA_CERTS` *adds* to what Node already trusts. Every other mechanism here **replaces** a
trust store, so a runtime pointed at a file holding one certificate would trust this home's sites and
nothing else on the internet — `pip install` would be the first thing to stop working.

**PHP goes through the ini set rather than the environment**, because `PHP_INI_SCAN_DIR` names that
directory for a `php` in a terminal *and* is set on the php-fpm spec. So `php -r` and `curl_exec()`
in a browser get the same answer, which is the property T28's `conf.d` model exists to hold — and it
is the case that matters most, since a site calling another site of this home over HTTPS runs inside
the pool.

## Consequences

**Python and Ruby stop using their own curated root sets and start using the machine's.** On a
corporate laptop with an inspection proxy's certificate in the OS store, a Python script will now
trust that proxy — exactly as the browser beside it already does. This is the intended behaviour and
it is the reason this decision has a record rather than a line in a module doc.

**A store that reads short writes nothing.** Fewer than `ROOT_FLOOR` (20) roots is a store that was
read wrong rather than a machine that trusts nothing, and writing a bundle from it would replace a
working trust store with a broken one on the next command somebody typed. The file is not written, a
stale one is removed, and `mix doctor` reports it — `TrustBundleMissing` is a problem only when the
store *can* be read.

**Twenty was chosen against a measurement, and the measurement is worth recording**: a daemon run
against a stock Windows 11 answered **35** roots, not the hundred-and-something a Linux
`ca-certificates` holds — that store is seeded with a small set and fetches the rest on demand. The
floor exists to tell a read that failed from one that worked, and nothing more; raising it towards a
distribution's figure would refuse a working Windows.

**A variable the person already set is never overwritten.** Somebody who exported `SSL_CERT_FILE` for
a corporate authority meant it, and a tool that overrode it would be one that cannot be used inside
the company that installed it. `mix doctor` reports the shadowing instead.

**PHP on Windows can now verify HTTPS at all.** Not a side effect worth hiding: the artifact ships no
CA file, so before this every `file_get_contents("https://…")` there failed, and the fix arrives with
the rest.

**The bundle is as fresh as the daemon's last start.** A machine that has not restarted its daemon
since a root was revoked keeps trusting it — the same exposure every pinned bundle in every language
already has, and shorter than most.

## Alternatives considered

**Ship a Mozilla root set with MixEngine.** Rejected: it would make MixEngine responsible for keeping
a public trust list current, on its own release schedule, for every machine that installed it.

**Ask each runtime where its own default bundle is and merge into that.** Rejected: it is a subprocess
per runtime version, it has no answer at all for Node or for PHP on Windows, and it would produce a
different trust set per language on one machine — which is exactly the confusion the complaint came
from.

**Use `--use-system-ca` and its equivalents instead of a file.** Rejected: the flag exists only in
recent Node and has no counterpart in the other three. A file works on every version this project
ships.
