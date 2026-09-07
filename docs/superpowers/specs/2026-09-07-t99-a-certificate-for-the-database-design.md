# T99 — a certificate for the database (design)

Proposed roadmap task **T99**, phase 3: *"MariaDB serves a certificate this home's authority signed,
so an 11.4 client that insists on TLS gets it, and a start no longer pays for a 4096-bit key it throws
away on stop."*

## What was measured, and how

Two CI runs on `master`, read back to the line.

**Run 34128004289, `bench (ubuntu-latest)`.** The M3 warm start's median was 11.1 s against the
ten-second budget, and every slow round's `mariadb.err` had the same shape: InnoDB up, then four to
thirteen seconds of nothing, then `Server socket created`. Between those two lines
[`mysqld_main`](https://github.com/MariaDB/server/blob/11.4/sql/mysqld.cc) runs `init_ssl()`, and
since 11.4 the server's `ssl` option defaults to on. A server with no certificate configured then
**generates one at every start** —
[`vio_keygen`](https://github.com/MariaDB/server/blob/11.4/vio/viosslfactories.c) asks OpenSSL for a
4096-bit RSA key. A prime search is why one runner gave 4 s one round and 13 s the next, and why the
`bench` job has called this suite "bimodal on ubuntu" since it was written. The Windows build compiles
the same function against bundled wolfSSL (`cmake/ssl.cmake` picks `bundled` on `WIN32`, and
`vio_keygen` sits outside the `#ifndef HAVE_WOLFSSL` block), so it pays too, on a faster key generator.

**Run 34137287084, `test` on all three systems.** Commit `869927f` answered the first run with
`skip-ssl` in the recipe, and the real-server suite then failed at `mariadb.rs:351`:

```
ERROR 2026 (HY000): TLS/SSL error: SSL is required, but the server does not support it
```

The rule is the client's, read from
[`plugins/auth/my_auth.c`](https://github.com/mariadb-corporation/mariadb-connector-c/blob/3.4/plugins/auth/my_auth.c)
and [`include/sslopt-vars.h`](https://github.com/MariaDB/server/blob/11.4/include/sslopt-vars.h): an
11.4 command-line client verifies the server's certificate by default, and it disables that only for
a TCP login **with no password on its command line**. So the daemon's own steps — password in
`MYSQL_PWD`, never on the command line — passed, the suite's `--password=` probes passed, and the one
call with `--password=Ch0sen!Pw` was refused before the server saw it. A person running
`mariadb -h 127.0.0.1 -P 3306 -u blog -p` against a `skip-ssl` server would be refused the same way.
**`skip-ssl` is a regression for every 11.4 client on the machine, and it is withdrawn by this
design.**

**What the client checks on a loopback connection.** For `127.0.0.1` (and `localhost` on Windows)
`is_local_connection` is true, so with no `--ssl-ca` the verification flags carry neither `HOST` nor
`TRUST` and any certificate the server presents is accepted. For other host names the chain is
checked against the OS store first, and a certificate that fails that check falls back to the
password-hash validation `password_and_hashing` implements. Either way, **a certificate signed by an
authority this machine trusts is at least as good as the self-signed one the server generates**, and
for a client that does ask for `TRUST` — a GUI tool with "verify server certificate" ticked — it is
better.

## Goal

MariaDB starts with a certificate already on disk, signed by this home's authority, so `init_ssl`
loads two PEM files instead of searching for primes. TLS stays on. No client-side flag changes, no
budget changes. The M3 number on Linux comes back inside the envelope the other two systems already
show, and the "bimodal" footnotes in the roadmap close.

## Scope

**In:**

- A leaf per MariaDB instance under `certs/services/<service-id>.{key,crt}`, issued by this home's
  authority, ECDSA P-256 like every other key this project makes.
- Issuance at render, in the generator's one step that already touches a disk (the one that creates
  `logs/` and the data directory), and a `Recipe` hook that says which services want one.
- `ssl_cert` / `ssl_key` in MariaDB's template when a usable pair exists, the certificate's
  fingerprint in the file's header comment, and nothing about TLS when none does.
- Withdrawing `skip-ssl` and the two unit tests written for it.
- A real-server assertion that the connection the suite makes is encrypted, so the certificate is
  proved served and not merely written.
- Roadmap: T99 in phase 3, the M3 footnote in `todo.md` closed on the bench number, the
  `warm_start.rs` diagnosis comment corrected.

**Out:**

- **MySQL.** `mysqld --initialize` writes RSA certificates into the data directory once, and MySQL's
  clients do not insist on TLS; there is no per-start cost to remove.
- **PostgreSQL.** `ssl` is off by default and nothing here turns it on.
- **Reloading a running server's certificate** (`FLUSH SSL`). A service leaf is renewed at the next
  start; a database that ran for a year without one is addressed below rather than handled.
- **`mix cert status` and `mix doctor`.** Both enumerate certificates from `sites` rows and will not
  see `certs/services/`; teaching them to is a task of its own if anybody asks.
- **Instances bound off loopback.** `service.bind` can name another address; the certificate covers it
  when it is an IPv4 literal, and nothing more is promised.

## Decisions

### D1 — a leaf from the authority, not `skip-ssl`, and not the server's own key

Three candidates were on the table:

| | Start cost | 11.4 CLI with a password over TCP | Client with "verify" on |
| --- | --- | --- | --- |
| Server generates its own (today) | 4–13 s on a CI runner | works | fails chain, falls back to password hash |
| `skip-ssl` | none | **refused, error 2026** | refused |
| Leaf from the home's CA (this design) | milliseconds | works | works when the CA is trusted, else the same fallback |

The third column is what removes `skip-ssl` from consideration; the first is what removes the status
quo. The leaf is signed by the authority T48 already generates at every daemon start, so on any home
that renders at all the signer exists, and the trust store install T49 batches into the first-run
prompt is what makes the last column true without a second prompt.

### D2 — where the pair lives, and what it says

`certs/services/<service-id>.key` and `.crt`, beside `certs/sites/`, named by the service id
(`mariadb@main`), which `ServiceId` already restricts to characters every filesystem here accepts.

Subject alternative names: `localhost`, then the bind address when it is an IPv4 literal
(`127.0.0.1` by default). Common name `localhost`. **IPv4 only**, for the reason `leaf::names`
already gives — the reuse check compares the SAN list read back off disk against the one asked for,
and a name that does not round-trip is a certificate reissued at every start. `::1` is therefore not
covered; a client connecting to `::1` with verification on takes the password-hash fallback, which is
what it takes today.

`serverAuth` only, `digitalSignature` only, `IsCa::ExplicitNoCa` — the T50 leaf profile unchanged.

### D3 — lifetime and renewal

**Ninety days, reissued at a start with fewer than thirty left** — the site leaf's numbers, deliberately.
`tls.md` argues ninety days from browsers, which never see this certificate, but a second lifetime
would be a second rule to keep in step, and a database restarted less than once a quarter is not the
laptop this product is for. A server that has run past its certificate's expiry keeps answering
loopback clients — verification there checks no validity period — and a client that does verify says
so in its own words at the next connection. `mix service restart` is the renewal.

The reuse check asks the site leaf's four questions: both halves present and each other's, the names
equal, thirty days or more left, and signed by the authority this home has **now** — so T54's
rotation reissues service leaves for the same reason it reissues site leaves.

### D4 — issued where the generator already writes, read where the recipe reads

`Generator::render` is the one place in `generate` that touches a disk — it creates `logs/` and the
data directory because a server that names its own directory does not create it. A service leaf is
the same kind of thing: a file the configuration names and the server will not make for itself. So it
is ensured there, just before the render, for every prepared service whose recipe answers
`Recipe::certificate(&Context) -> Option<Vec<String>>` with a name list. MariaDB answers; every other
recipe keeps the default `None`.

The result reaches the template the way a site's does: a `ServiceCertificate { certificate, key,
fingerprint }` on the `Context`, filled by reading the pair back through `read` and not by describing
what was just written — `ca::ensure`'s promise, kept a third time.

**Issuance that fails does not fail the start.** No authority, a key the machine will not produce, a
directory that will not write: the daemon logs it at `warn`, the context carries `None`, the template
writes no `ssl_*` line, and the server does what it did before this task — generates its own, slowly,
and starts. The failure mode of this design is the status quo, never a database that will not start.

### D5 — the template writes two lines and a fingerprint, or nothing

```
# certificate: <sha256 fingerprint>
ssl_cert = "<certs>/services/mariadb@main.crt"
ssl_key  = "<certs>/services/mariadb@main.key"
```

Quoted and forward-slashed like every other path in the file, for T33a's reason. The fingerprint is
in the header for T51's reason — a reissue to the same path must change the file, or a rewrite finds
no difference — even though MariaDB does not reload on a changed file: the header is what makes a
`mix service` reading of the file say which certificate it was rendered for.

`ssl_cert` implies `ssl` on in every series the index publishes, which is why `ssl = on` is not
written. `skip-ssl` is not written either, on any path.

### D6 — the daemon's own clients change nothing

The readiness ping, the health probe, the shutdown and the provisioning steps all pass the password
in `MYSQL_PWD` and connect to `127.0.0.1`: verification is off for the passwordless command line and
would pass for the loopback address if it were on. No argument list changes. The suite's
`with_the_password` helper — the call that failed — also changes nothing: it is the proof, and the
proof has to be the client a person would run.

### D7 — one new check in the real-server suite, and the bench is the other

`mariadb.rs` gains an assertion that the connection made with a password reports a cipher —
`SHOW STATUS LIKE 'Ssl_cipher'` non-empty — which is what distinguishes "the certificate was written"
from "the certificate was served". The M3 bench needs no new assertion: the number is the assertion,
and the next `bench (ubuntu-latest)` run is what closes the roadmap's footnote.

## Testing

- **Unit, `certs::service`**: issue on an empty home; reuse when all four questions answer yes;
  reissue when the names change, when fewer than thirty days remain, when the authority's identity
  changes; key first on disk; `read` names half a pair.
- **Unit, the MariaDB recipe**: with a certificate on the context the file carries both paths and
  the fingerprint; without one it carries no `ssl` directive of any kind; `skip-ssl` appears on no
  path; `extra` still renders last.
- **Unit, the generator**: a MariaDB row on a home with an authority renders with a pair on disk; on
  a home with none it renders without and the start is not refused.
- **Integration, `mariadb.rs`** (real server, all three systems): the existing flow, plus D7's cipher
  check.
- **Bench, `warm_start.rs`**: no change; read the number.

## What this closes, and where it is written

- `todo.md`'s "M3's tail" debt row, on the next green bench.
- The "bimodal on ubuntu" footnotes stay as history; `warm_start.rs`'s comment and the phase 3
  milestone note already say what it was.
- A one-paragraph addition to `.claude/features/tls.md` under a new "Services" heading: databases get
  a leaf from the same authority, under `certs/services/`, and why.
- ADR: none proposed. Nothing accepted is changed — `tls.md`'s "SANs = exactly the site's domains" is
  about site leaves, and this is not one.
