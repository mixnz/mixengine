# 0039. A JDK is told about the authority inside its own `cacerts`

**Status**: Accepted
**Date**: 2026-09-18

## Context

[ADR 0034](0034-mixengines-authority-reaches-a-runtime-through-a-generated-bundle.md) brings this
home's authority to a runtime through a generated bundle named by an environment variable. A JDK has
no such variable. It verifies against `lib/security/cacerts` inside its own home;
`javax.net.ssl.trustStore` *replaces* that store rather than adding to it, and reaches a JVM only
through `JAVA_TOOL_OPTIONS`, `_JAVA_OPTIONS` or `JDK_JAVA_OPTIONS`, each of which makes every
`java`, `javac` and `mvn` print a `Picked up …` line on standard error. Without something, a `java`
fetching `https://<site>.test` fails with `PKIX path building failed` — the complaint T132 answered
for every other language.

Measured on 2026-09-18, on Microsoft Build of OpenJDK 11, 17, 21 and 25 for Windows x86_64:
`keytool -importcert -cacerts -storepass changeit` succeeds on every line, an export of the alias
returns the same certificate, and the store still holds its 118 public roots afterwards — an HTTPS
request to a public site keeps working, which is what a password-protected or re-encrypted `cacerts`
would have broken.

## Decision

The daemon writes this home's authority into each installed JDK's `cacerts` with **that JDK's own
`keytool`**, `-cacerts -storepass changeit`, under the alias `mixengine-<key_id>`. It does so at
every moment it asks the browsers — daemon start, `mix doctor --repair`, a committed `cert.ca_rotate`,
`cert.ca_uninstall` and `mix uninstall` — and once more after a JDK is installed, which is the one
moment a store nobody has written to appears. Writes are serialised by one lock. Nothing about it
fails a start, an install or a request: a refusal is logged, and `mix doctor` reports the JDK as
`java_trust_missing` and repairs it without a prompt.

**This is the one write into an installed runtime.**
[runtime-versions.md](../features/runtime-versions.md) calls `runtimes/<kind>/<version>/` immutable
and `Error::AlreadyInstalled` leans on it; the exception is one file, `lib/security/cacerts`, and one
alias per authority. ADR 0034 stays accepted and unchanged: it governs every kind that reads a
bundle, and this is the one kind that cannot.

## Consequences

A Java program reaches this home's own HTTPS sites with no flag and no `Picked up …` noise. An
installed tree is no longer byte for byte what the index published, so a future integrity check over
a runtime directory has to know about this file. A runtime built with `jlink` copies `cacerts` from
`jmods/` and does not trust these sites. A `cacerts` whose password somebody changed makes `keytool`
refuse, which the doctor reports rather than working around. Each moment above costs one JVM start
per installed JDK — measured at 220–300 ms on this machine — which is why the one at daemon start is
spawned rather than awaited.

## Alternatives considered

- **A generated truststore through `JAVA_TOOL_OPTIONS`.** Lost to the `Picked up JAVA_TOOL_OPTIONS`
  line on every JVM start, and to fighting a variable that is the person's to set.
- **Pointing a JDK at the operating system's store** (`-Djavax.net.ssl.trustStoreType=Windows-ROOT`,
  `KeychainStore-ROOT`). Exists on two of the three systems, not on every line offered, and needs
  the same variables to get there.
- **Nothing, and a handbook sentence.** A Java project could not call its own sites, which is the
  complaint this whole phase exists to answer.
