---
status: implemented
date: 2026-09-24
task: T182
---

# A service says which version it runs

## The problem

A person installs MySQL 5.7, creates its service, and is shown `mysql@main`. Nothing on the
screen or in `mix service list` says which MySQL that is. The name after the `@` is a label the
person chose, or accepted when the form filled in `main`, and it means nothing to MixEngine
(`docs/features/services.md`). What a person actually wants to know is *which version is running*,
and nothing tells them.

`service.create` takes the version (`ServiceCreate::version`), and the `services` row keeps it
through its parent: `packages.version` for a server, `runtime_installs.version` for php-fpm. **But
it never goes back out.** `ServiceSummary`, the type `service.list` and `service.status` answer with,
has no version member. So neither client can show it without a second source, and a client working
it out by itself (reading the id, remembering what it sent to `service.create`) is business logic
in a client.

## What was considered and not done

**Putting the version in the id** (`mysql@5.7`), filled in by the create form. The id cannot be
changed once created: it is the config directory, the log directory, the socket and the keyring
address. The version is a fact about the service that may change later. An id holding a version
becomes wrong the day that happens, and it can never be corrected. The id stays a name
(`@main` remains the form's suggestion) and the version is reported next to it.

## The design

### Protocol: `ServiceSummary::version`

```rust
/// Which version of its program this service runs — roadmap task **T182**.
#[serde(default, skip_serializing_if = "Option::is_none")]
pub version: Option<PackageVersion>,
```

Optional, as [ADR 0019](../decisions/0019-an-added-response-member-is-optional.md) requires of an
added response member: a newer MixLab talking to a daemon built before T182 reads the member as
absent and draws no version instead of refusing the whole list.

**[`None`] covers four cases, and a client treats all four the same way: it draws nothing.**

- the daemon predates T182;
- the service is declared but has no row, and has no state for the same reason;
- the service comes from an extension (`services.extension_id`). The extension's version is the
  extension's, not the program's, and `services::version` already leaves this case out;
- the stored text does not parse as a `PackageVersion`, which only happens to a hand-edited row. A
  listing does not fail over one bad cell (see `listening_port`).

The four do not need telling apart: in each one, nothing trustworthy can be shown.

**The full version as installed** (`5.7.44`, `11.4.3`, `8.3.33`), not a shortened line. That is
what is on disk, and a client that wants `5.7` can drop the rest itself. Shortening is display
only, not a decision.

### Daemon

`ServiceRecord` gains `version: Option<PackageVersion>`. `services::records`, the one query a listing
makes, gets the same two `LEFT JOIN`s and the same `coalesce(p.version, r.version)` that
`services::version` uses, so `service.list` stays one query and does not become one per row.
`services::record`, the single-row reader, is changed the same way so that the two readers cannot
drift apart. `rpc::summary` copies the field across.

`services::version` stays as it is (`project.export` reads it). Folding it into `record` is a
possible cleanup, but not part of this task.

### CLI

`mix service list` gains a `VERSION` column right after `SERVICE`: the id and the version are read
together. A missing version prints the table's existing `MISSING` mark. `mix service status
<service>` prints it on the same terms. `--json` changes by itself, since it is the type.

### Desktop

Wherever a service is drawn by its id, the version is drawn next to it in secondary text:
`mysql@main · 5.7.44`. That means the Dashboard's service rows and the ServicesDetail header. With
no version, nothing is drawn: no dash and no "unknown". The create form keeps suggesting `main`.

### Bindings and docs

- `packaging/bindings.sh` regenerates `bindings/ServiceSummary.ts`.
- `docs/features/services.md`: next to the paragraph on instance names, a sentence saying the name
  is a label and the version is reported by `ServiceSummary::version`.
- `docs/features/client-surface.md`: the Dashboard and Services entries name `version` among what
  they draw from `service.list`.
- `docs/guide/{en,vi}/services.md`: the example output of `mix service list` shows the column.

## Testing

- **core:** `records` and `record` report the package's version for a package-parented row, the
  runtime's for php-fpm, and `None` for an extension-parented row.
- **proto:** the existing floor test (a summary from before a role existed) still decodes with
  `version` absent, and a round trip keeps it.
- **CLI:** `render::service_list` prints `VERSION` next to `SERVICE`, with `MISSING` when absent.
- **desktop:** a row with a version draws it; a row without one draws no separator and no
  placeholder.

## Out of scope

- Changing a service's version in place (upgrade from 5.7 to 8.0). This design only makes that
  future change visible when it lands, and it is the reason the version is kept out of the id.
- Changing existing ids, or the `main` suggestion.
