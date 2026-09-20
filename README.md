# MixLab

A local web development environment. Run several PHP, Node.js, Python, Ruby, Go and Java versions side
by side and let each directory choose its own; run the web server, databases and caches your projects need;
and give every site a real name like `https://blog.test` with a certificate your browser trusts.
No Docker, no virtual machine, no configuration file written by hand — and nothing of MixLab's
stays on your machine as a root process.

**MixLab is the application; MixEngine is the engine inside it.** One download gives you both — you
never install two things. For a machine with no screen, MixEngine is published on its own as a
headless archive, and every capability still reaches you through the `mix` command line.

Windows, macOS and Linux, from one Rust workspace.

## Documentation

- **[The handbook](https://mixnz.github.io/mixlab/)** — installing, a first site, and every
  subsystem, in English and Vietnamese.
- **[llms.txt](https://mixnz.github.io/mixlab/llms.txt)** — the same pages as plain Markdown at
  predictable addresses, for a program. Every page is also `mix docs <topic>`, offline.
- Its source is [`docs/guide/`](docs/guide/); the site is generated from it by
  `bash packaging/docs.sh`.
- **[`bindings/`](bindings/)** — the daemon's JSON-RPC API as TypeScript types, generated from
  `mixengine-proto` and published with every release.

## Build it

```bash
cargo check --workspace --all-targets
cargo clippy --workspace -- -D warnings
cargo test --workspace
cargo run -p mixengine-cli -- status
```

## Working on MixLab

[`CLAUDE.md`](CLAUDE.md) is the whole system on one page, and [`docs/`](docs/README.md) holds
the detail it deliberately keeps out: architecture, feature specifications, coding standards,
decision records, and the ordered build plan.

## Licence

MIT or Apache-2.0, at your option.
