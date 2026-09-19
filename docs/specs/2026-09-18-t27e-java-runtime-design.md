---
status: implemented
date: 2026-09-18
task: T27e
---

# T27e — Java, the seventh runtime kind (design)

Proposed roadmap task **T27e**, phase 2, following T27d: *"A JDK is installed, pinned, listed and run
exactly as a runtime is; a `java` started through `bin/` runs the version the directory pinned, knows
where its own home is, and trusts the sites this home serves — and a Linux machine missing what a JDK
links is told so, without being refused."*

## What was observed, and how

`mixengine-packages` published Java as its **P20**: four LTS lines, `11`, `17`, `21` and `25`, every
cell borrowed from Microsoft Build of OpenJDK, `kind: "java"`, `provides` naming `java`, `javac`,
`jar`, `jshell`, `keytool` and `jlink` ([its packaging design](https://github.com/mixnz/mixengine-packages/blob/master/docs/superpowers/specs/2026-09-17-java-packaging-design.md)).
It left two sentences for this repository:

> the daemon has to accept the new field `requires.libraries` … and check, or tell the person about,
> those libraries on Linux.

> `JAVA_HOME` is the parent of the directory holding `provides.java`.

Five facts shape what those sentences cost here, each checked rather than assumed:

- **This build does not know Java.** `RuntimeKind` is closed at six, and `runtime_installs.kind`
  carries `CHECK (kind IN ('php', 'node', 'python', 'ruby', 'go', 'composer'))` from
  `0025_go_runtime.sql`. An index entry of `kind: "java"` is a word this build skips — so, as with Go,
  the kind comes first and both sentences after it.
- **`requires.libraries` already parses.** `index::Requires` is deliberately not
  `deny_unknown_fields`, so the field is read and dropped, exactly as `tzdata` is. Accepting it is
  free; *judging* it is the work.
- **A JDK trusts neither the operating system nor the bundle.** Java verifies against
  `lib/security/cacerts` inside its own home. No environment variable *adds* an authority to it:
  `javax.net.ssl.trustStore` *replaces* the store, reaches the JVM only through
  `JAVA_TOOL_OPTIONS` / `_JAVA_OPTIONS` / `JDK_JAVA_OPTIONS`, and each of those makes every `java`,
  `javac` and `mvn` print a `Picked up …` line on stderr. ADR 0034's mechanism — a generated bundle
  named by a variable — has no Java counterpart, so a `java` fetching `https://<site>.test` fails with
  `PKIX path building failed` unless the store itself holds this home's authority.
- **The Linux JDK links what it does not ship.** `libz.so.1` is imported by every launcher and by
  `libjli`; `libfreetype.so.6` by the font manager; the X11 family by AWT and the splash screen;
  `libasound.so.2` by `javax.sound`. A headless server runs a Spring Boot application without X11 or
  ALSA, so a missing soname is not, by itself, a JDK that cannot be used.
- **A session `JAVA_HOME` defeats a pin in tools the shim never sees.** `mvn` and `./gradlew` read
  `JAVA_HOME` before they look for `java` on the path. JDK installers commonly offer to set it
  machine-wide, so the machines that already had Java are the ones where it is set.

## Goal

`mix runtime install java 21` puts a JDK on the machine; `java --version` in a directory pinned to
it answers `21.0.x`; a program started through `bin/` sees `JAVA_HOME` naming that JDK and reaches
`https://<site>.test` over TLS without a flag; and on a Linux machine lacking `libasound.so.2` the
install says so and completes. Nothing changes for a machine that never installs Java.

## Scope

**In:**

- `RuntimeKind::Java`, and every consequence `RuntimeKind::ALL` already carries.
- A migration widening the `runtime_installs` `CHECK`.
- Six shim rows, and `JAVA_HOME` in the environment of every Java command.
- This home's authority inside each installed JDK's `cacerts`, kept current, and removed wherever
  the browsers' copy is removed.
- `requires.libraries` read, judged on Linux, and reported as a warning that never refuses.
- Two `mix doctor` checks.
- MixLab: the project form's list of kinds, and a notice for the new warning.
- ADR 0039, the feature documents, the handbook, the roadmap and the changelog.

**Out:**

- **Maven, Gradle, Kotlin, sbt.** Separate release trains, and each would be its own kind or tool.
- **Reading `.java-version`, `.sdkmanrc`, `pom.xml` or `build.gradle`** to pin. A directory is pinned
  the way every other language is — `mixengine.toml`, the project record, the default.
- **A gallery blueprint.** The packaging design records no blueprint demand, and none is invented.
- **Java 8, feature releases, `src.zip`** — the packaging design's own exclusions.
- **Package names for a missing soname.** They differ per distribution, and the daemon does not name
  what it did not measure.
- **Pointing a JDK at the operating system's store** (`-Djavax.net.ssl.trustStoreType=Windows-ROOT`,
  `KeychainStore-ROOT`). It exists on two of three systems, not on every line offered, and would
  need the same noisy variables.
- **A `jlink`-built runtime's trust.** `jlink` copies `cacerts` from `jmods/`, which this design does
  not touch; D12 says so in the handbook.

## Decisions

### The kind

**D1 — Java is the seventh `RuntimeKind`.** `RuntimeKind::Java`, spelled `java` everywhere the
others are spelled, `override_env` `MIXENGINE_JAVA`. `ALL` becomes seven in the order
`php, node, python, ruby, go, java, composer`: Composer stays last for T27c's reason. Every consumer
of `ALL` follows without a change of its own; `bindings/` is regenerated. The addition to the
`RuntimeKind` union is a breaking change for an exhaustive `switch` in any consumer of `bindings/`,
which is how T27d's addition was treated too.

**D2 — Migration `0026_java_runtime.sql` widens the `CHECK`.** Rebuilt exactly as 0025 rebuilt it,
with `'java'` added to the list. No column changes.

**D3 — The smoke test is `java --version`, run in a cleaned environment.** `--version` exists from
JDK 9, prints to stdout and exits zero; on Linux it is also what fails when `libz.so.1` is absent,
because the launcher imports it. `SmokeTest` gains a list of variables to remove from the child's
environment, and Java's is `JAVA_TOOL_OPTIONS`, `_JAVA_OPTIONS`, `JDK_JAVA_OPTIONS`, `CLASSPATH` and
`JAVA_HOME`: a daemon started from a session carrying a malformed `_JAVA_OPTIONS` would otherwise
refuse every JDK for a reason that has nothing to do with the JDK. Every other kind's list is empty.
The `keytool` invocations of D8 use the same list.

**D4 — Six shim rows.** `java`, `javac`, `jar`, `jshell`, `keytool` and `jlink` — exactly the keys
of `provides` — each `kind: Java`, `executable` equal to its name, `via: None`. The JDK's other tools
(`javadoc`, `jdeps`, `jcmd`, …) are not published under names of ours; a command already running
under a shim reaches them through `PATH`, whose first entry is that JDK's `bin/`.

**D5 — `JAVA_HOME` from the shim, for Java only, always.** A function beside `toolchain`, called from
`surroundings`, inserts `JAVA_HOME` when `kind` is `Java`, set to the directory two levels above
`provides.java` of the resolved install — `Contents/Home` on macOS, the archive root elsewhere. It is
derived from `provides.java` and not from the program being run, so `keytool` and `java` agree by
construction rather than by layout.

**A value already in the session is overwritten.** That is the opposite of `GOTOOLCHAIN`'s rule, and
the reason is the one T27d gave for `go env -w`: `JAVA_HOME` is usually a machine-wide setting an
installer wrote before MixEngine was here, and a `java` whose children are told about another JDK is
a pin that means half of what it says. The limit is stated rather than hidden: a shim reaches only
what it starts, so `mvn` or `./gradlew` typed in a terminal still reads the session's value — which
is D7's note and a handbook sentence.

**D6 — No globals directory.** `runtimes::globals::directory(Java)` is `None`, and the shim's
`install_globally` answers Java with the arm PHP, Go and Composer share.

**D7 — A doctor note, *the Java a project pins*.** `Ok` when no Java is installed, or when the
daemon's own environment carries nothing below. A `Note`, naming what it found, when it carries:

- a `JAVA_HOME` outside this home's `runtimes/java/` — `mvn` and `./gradlew` run outside a shim use
  that JDK instead of the pinned one; or
- a `JAVA_TOOL_OPTIONS`, `_JAVA_OPTIONS` or `JDK_JAVA_OPTIONS` containing `javax.net.ssl.trustStore`
  — every JVM it reaches reads that store instead of the `cacerts` D8 writes into.

A `Note` has no `ProblemId`. The daemon's environment is a proxy for the person's shell, and on macOS
and Linux, where a login shell's profile may never reach a user service, a weak one; the handbook
carries the rule for exactly that reason.

### Trust

**D8 — A JDK is told about the authority inside its own `cacerts`, with its own `keytool`.** ADR
**0039**. Three invocations, each of the `keytool` in that install's `provides`, each through
`mixengine_platform::process::without_a_window`, under a timeout, with D3's variables removed:

| Question | Invocation |
| --- | --- |
| Does it hold this authority? | `keytool -exportcert -rfc -cacerts -storepass changeit -alias mixengine-<key_id>` |
| Hold it | `keytool -importcert -noprompt -cacerts -storepass changeit -alias mixengine-<key_id> -file certs/ca/root.crt` |
| Let one go | `keytool -delete -cacerts -storepass changeit -alias mixengine-<key_id>` |

- **`-cacerts`, not a path.** It exists from JDK 9, locates the file itself, and handles JKS
  (11, 17) and the password-less PKCS12 18 moved to — nothing in Rust parses a keystore.
- **The answer is the exported certificate's DER, compared with the authority's.** `-list` output is
  localised; a PEM block is not. A non-zero exit is "not held".
- **The alias names the authority by key-id**, T49a's D5 applied to one more store: a removal names
  an authority, never a certificate, and a rotated authority has a different alias from the one it
  replaces.
- **`changeit` is a published default, not a secret.** A person who changed their `cacerts` password
  gets D11's problem, whose detail says so.
- **Through `mixengine_platform::process::run_once`**, which already gives a one-shot no window, a
  deadline, captured output and an environment built from a short allow-list — so D3's variables
  never reach `keytool` without a list of their own.
- **This is the one write into an installed runtime.** `docs/features/runtime-versions.md` calls
  `runtimes/<kind>/<version>/` immutable, and `Error::AlreadyInstalled`'s documentation leans on it.
  ADR 0039 names the exception — one file, `lib/security/cacerts`, one alias per authority — and the
  feature document says so where it states the rule.

**D9 — When: everywhere the browsers are asked, and after an install.** The browsers' databases are
the precedent in shape — a store the user owns, written without a prompt — so Java follows them call
for call rather than inventing a schedule:

| Moment | Browsers today | Java |
| --- | --- | --- |
| Daemon start | `install_in_browsers` after `ensure` | Reconcile every installed JDK — spawned, never awaited before `accept`, for the reason the trust bundle block gives |
| `mix doctor --repair` | `repair.rs` | Reconcile |
| `cert.ca_rotate` commits | install new, then remove old | Hold the new alias in every JDK, then let the old one go |
| `cert.ca_uninstall` | `remove_from_browsers` | Let the alias go from every JDK |
| `mix uninstall` | `remove_from_browsers`, in the residue rows | Let the alias go from every JDK right after the unprivileged removals, logged rather than a residue row of its own — it matters with `keep_home`, where a kept JDK must not go on trusting an authority the machine has been told to forget |
| A JDK installed | — | Reconcile once the row is written, beside `pools::ensure`: the post-install hook runs after the row for the reason that call gives, and reconcile walks rows |

**Reconcile** is: for each installed JDK, ask; hold when not held. It asks nothing when the authority
is not `Present`. At start it runs sequentially, one `keytool` process per JDK, which is the whole of
its cost on an ordinary start.

**D10 — One writer at a time.** Every `keytool` invocation that writes goes through one process-wide
`tokio::sync::Mutex` in the daemon's `certs/jdks.rs` — a `static`, because `Certificates` is cloned
and constructed in six places and a field would be six locks. A start's reconcile, a rotation and an install finishing in the
same second would otherwise be two JVMs rewriting one file.

**D11 — Nothing about trust fails a start or an install.** A refusal is a `tracing::warn!` and, for
an install, the install still succeeds — a JDK that cannot fetch a local site is more use than no
JDK. `mix doctor` gains a check, *every JDK trusts this home's authority*, `Ok` with no Java or no
usable authority, and otherwise a problem **`ProblemId::JavaTrustMissing`** naming the versions that
do not hold it, whose repair is D9's reconcile. A problem rather than a note on
`TrustBundleMissing`'s reasoning: it is something the daemon can write, and writing it destroys
nothing. The proto gains the variant, and `bindings/` is regenerated.

**D12 — What stays open, said in the handbook.** A `keytool -delete` by hand is put back at the next
start or repair. A runtime built with `jlink` carries `jmods/`' untouched `cacerts`, so it does not
trust this home's sites — pass it `-Djavax.net.ssl.trustStore` or import the authority into it.
Removing a JDK removes its `cacerts` with it; nothing else is cleaned up.

### What a Linux JDK expects of the machine

**D13 — The index reads `requires.libraries`.** `Requires` gains `libraries: Vec<String>`,
`#[serde(default, skip_serializing_if = "Vec::is_empty")]`, and `is_empty` counts it.

**D14 — The machine answers with `ldconfig -p`.** `MachineFacts` gains
`shared_libraries: Probe<BTreeSet<String>>`. On Linux it runs the first of `/sbin/ldconfig`,
`/usr/sbin/ldconfig` and `/usr/bin/ldconfig` that exists — a user's `PATH` often has no `sbin` — with
`without_a_window` and a timeout, and keeps the soname of each entry whose tag names this process's
architecture (`x86-64`, `AArch64`), so a 32-bit `libz` does not count. It is `Unknown` when no
`ldconfig` runs, when it fails, and **when it lists nothing**: a container with no `ld.so.cache`
answers "0 libs found", and treating that as every library missing would warn about `libz` on a
machine that has it. macOS and Windows answer `Unknown`. The probe is read once per request, not
once per release judged. `dlopen` is not used: loading X11 or ALSA into the daemon to ask a question
runs their constructors.

A library found only through `LD_LIBRARY_PATH` or a directory outside `ld.so.conf` is reported
missing. That is accepted because the answer is a warning, and the sentence says "does not list"
rather than "does not have".

**D15 — A new need, and a remedy that refuses nothing.** In `mixengine-proto`:

- `Need::SharedLibrary { soname }` — label `libz.so.1`, sentence *"the shared library libz.so.1,
  which this machine's loader does not list"*.
- `Remedy::InstallFromDistribution` — no fields; sentence *"install it with this distribution's
  package manager"*.

In `core::requirements`: `unmet` pushes a `SharedLibrary` only for a certain absence (T148's D2);
`judge` gives it `InstallFromDistribution` and never `ChooseVersion`, since every Linux release of a
line links the same set; `blocks` and `needs_consent` ignore it; `advisories` returns exactly these.
**`newest_met` ignores advisories too** — otherwise a JDK short of glibc could never be offered a
release that runs, because every release "lacks" `libasound`.

**D16 — The daemon and `mix` warn and carry on.** `requirements::refusal` judges the list without
its advisories, so a list of only advisories refuses nothing and `--yes` is not needed. The install
job writes one `tracing::warn!` naming the sonames. `mix runtime install`, `mix package install` and
`mix blueprint apply` print the advisories as a `warning:` before they start, naming the sonames and
D15's remedy, and proceed.

**D17 — MixLab shows a notice, not a question.** *(Section 3 of the reviewed design proposed a
dialog; a dialog is a gate, and `mix` asks nothing, so the window asks nothing either.)*

- `RequirementStep` gains `{ kind: "notice", needs }`, returned only when every unmet requirement is
  an advisory. A list that also blocks is `choose`; one that also needs consent is `consent`, whose
  dialog already lists every need.
- `requirementsAllowApply` allows a `notice`.
- `Languages.tsx` and `usePackages.ts` start the install at once on a `notice` and show an inline,
  dismissible notice on the screen listing the sonames and the remedy sentence. `ApplyDialog.tsx`
  shows the same notice in its plan phase and leaves Apply enabled.
- In a release row, shared-library needs collapse into one label — *"7 system libraries"* — with the
  sonames in its `title`, because eight sonames do not fit a table cell. `needLabel` gains the
  `shared_library` case for every other place a need is named.
- Strings in `en.ts` and `vi.ts`; the notice is built from `src/components/`
  (`using-shared-components`). Nothing in the client explains what a library is for: that would be
  business logic.

### The rest

**D18 — The desktop form lists it.** `RUNTIME_KINDS` in `ProjectForm.tsx` gains `"java"` before
`"composer"`, with an empty pin in the initial record; `monogram.test.ts` gains the name.

**D19 — Words.**

- **ADR 0039**, *a JDK is told about the authority inside its own `cacerts`*: D8–D10, with the
  alternatives — a generated truststore through `JAVA_TOOL_OPTIONS`, the operating system's store,
  nothing — and why each lost. ADR 0034 stays accepted: it still governs every kind that reads a
  bundle, and 0039 is the one kind that cannot. The decisions README index gains the row.
- `docs/features/runtime-versions.md`: Java in the kinds, the shim list and the trust table (row:
  *Java — no variable; the JDK's own `cacerts`, written with its `keytool`*), the immutability rule
  naming its one exception, a paragraph for D5, and one for D13–D17.
- `docs/features/tls.md`: the JDKs join the list of stores a rotation and an uninstall touch.
- `docs/guide/en/runtimes.md`: a *Java* section — install and pin, D5's rule and the `mvn` /
  `gradlew` caveat, HTTPS to `*.test`, D12's limits, and the Linux warning; `index.md` and
  `getting-started.md` as T27d touched them. The `vi/` pages translated, then
  `bash packaging/docs.sh --restamp`; `--reference` if a command's help changed.
- `README.md`: Java in the list of languages.
- `CHANGELOG.md`, `## Unreleased` → `### Added`: one line.
- `docs/roadmap/phase-2-runtimes.md`: T27e after T27d, pointing here, ticked when it lands with
  what was measured; `todo.md`'s phase-2 row to 16 / 16.

## Measured before a line of code is written

1. **`keytool` against each line, from a moved tree.** On 11, 17, 21 and 25: `-importcert -cacerts
   -storepass changeit` exits zero; `-exportcert -rfc` returns the same DER; a non-existent alias
   exits non-zero; on 21 and 25 the file is still a password-less PKCS12 afterwards
   (`keytool -list -cacerts` without `-storepass` still answers). If 18+ does not behave, D8 changes
   before anything else does.
2. **A handshake, not a listing — the one measurement taken after the code.** It needs a server
   whose leaf this home's authority signed, which is a sandbox MixEngine site; a hand-built chain
   measured earlier would prove a different one. A JDK unpacked outside the home fails against that
   site with `PKIX`, and an installed one succeeds. Step 1 is what stops the work early if the store
   cannot be written at all.
3. **The cost of one `keytool` start** on this Windows machine, which is what D9's start reconcile
   spends per JDK.
4. **`ldconfig -p` on Ubuntu in WSL**, with and without `libasound2`, including an entry whose tag
   carries `OS ABI:`, so D14's parser is written against real output.

## Testing

- **`mixengine-proto`**: `ALL` holds seven with Composer last; `MIXENGINE_JAVA`; `SharedLibrary`'s
  label, sentence and wire shape; `InstallFromDistribution`'s wire shape; `JavaTrustMissing`'s
  spelling.
- **`mixengine-core`**: a home at schema 0025 with one install of each of six kinds migrates and
  keeps every row and default; `smoke_test(Java)` is `java --version` with D3's variables removed;
  `shims::COMMANDS` holds the six; `Requires` round-trips `libraries`; `unmet` —
  listed soname nothing, unlisted soname `SharedLibrary`, `Unknown` nothing; `judge` gives
  `InstallFromDistribution`; `blocks` and `needs_consent` are false for advisories alone;
  `newest_met` still offers a version when glibc is short and advisories are present; the pure
  helpers behind D5 (home from `provides.java`, macOS layout included) and D8 (PEM-to-DER
  comparison, alias spelling).
- **`mixengine-platform`**: D14's parser over captured `ldconfig -p` text with a 32-bit entry, an
  `OS ABI:` tag, and an empty cache answering `Unknown`.
- **`mixengine-shim`**: `java` is handed `JAVA_HOME` naming its install, over a session value;
  `node` is not handed one.
- **`mixengine-daemon`**: `refusal` is `None` for advisories alone; D7's check `Ok` with nothing set
  and a `Note` for each of its two findings; D11's check is `Ok` with no Java installed; the
  repair plan maps `JavaTrustMissing` to an in-home repair.
- **A real JDK, `#[ignore]`d**: `crates/mixengine-core/tests/keytool.rs` runs `holds`, `hold` and
  `release` against a copy of a JDK named by `MIXENGINE_TEST_JDK`, because a script standing in for
  `keytool` would prove the arguments and not the store. Run by hand in this task, on all four lines.
- **`mixengine-cli`**: a list of advisories alone renders a `warning:` and does not ask for `--yes`.
- **`apps/desktop`**: `requirementStep` — advisories alone `notice`, plus glibc `choose`, plus
  Visual C++ `consent`; `requirementsAllowApply` allows `notice`; the collapsed label; `npm run
  build`, `npm test`, `npm run lint`.
- **Gates before a push**: `cargo fmt --check`, `clippy -D warnings`, suites by name, `cargo doc` with
  `-D warnings`, a `--release` check, `bash packaging/bindings.sh`; `clippy` in WSL for
  `linux/machine.rs`; the macOS target cross-check for `mixengine-platform`.
- **By hand, in a sandbox home against the real index**:
  - *Windows*: all four lines install; in a session exporting `JAVA_HOME` at another JDK,
    `bin/java` runs a program that prints `JAVA_HOME` and `java.home` naming the pinned install; the
    same program's `HttpClient` fetches `https://<site>.test` on 11, 17, 21 and 25;
    `mix cert ca-rotate` and the fetch still succeeds, and only the new alias is held; a hand
    `keytool -delete` makes `mix doctor` report `JavaTrustMissing` and `--repair` clears it; a daemon
    started with `JAVA_HOME` set shows D7's note.
  - *Linux, in WSL*: without `libasound2`, `mix runtime install java 21` prints the warning and
    completes; `java --version` runs; the HTTPS fetch succeeds.
  - *MixLab* (`npm run dev:app`): Java is in the project form and a pin saves. **The notice is not
    seen by hand**: this machine's probe answers `Unknown`, so it is proven by `requirementStep`'s
    tests only, and the report says so.

## What this closes, and where it is written

- `docs/roadmap/phase-2-runtimes.md`: T27e after T27d, ticked when it lands.
- ADR 0039, `docs/features/runtime-versions.md`, `docs/features/tls.md` and the handbook, per
  D19.
- The packaging repository's two sentences: `requires.libraries` is accepted and judged by D13–D17,
  and `JAVA_HOME` is rendered by D5 — in the shim, as T27d found "the daemon renders" means.
