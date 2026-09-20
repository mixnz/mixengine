# Phase 29 — One name to find it by

*Goal: the thing people open, the thing they search for and the repository they land in all have
one name, and the engine keeps its own where it is still the right one.*

Part of the [build plan](todo.md). Legend: `[ ]` todo · `[~]` in progress · `[x]` done.

Decision: [ADR 0044](../decisions/0044-mixlab-is-the-product-and-mixengine-is-the-engine.md), which
supersedes the naming paragraph of [ADR 0027](../decisions/0027-the-desktop-client-lives-in-this-repository.md).
It carries the scope table; this phase is the order the work happens in.

---

- [ ] **T176a** The repository is `mixnz/mixlab`. Renamed on GitHub, `repository =` in the root
      `Cargo.toml` follows, and every URL in the tree that names it. **Find out what happens to
      `https://mixnz.github.io/mixengine/` and write the answer down** — a repository rename
      redirects the git remote and the web UI, and Pages is the one that may not follow. ADR 0044
      accepts losing the inbound links; it does not accept not knowing.

      **Measured on 2026-09-20, straight after the rename:**

      | Asked for | Answer |
      | --- | --- |
      | `github.com/mixnz/mixengine` | `200`, redirected to `github.com/mixnz/mixlab` |
      | `github.com/mixnz/mixengine/releases/latest/download/latest.json` | `200`, the asset itself |
      | `mixnz.github.io/mixengine/` | **`404`** |
      | `mixnz.github.io/mixlab/` | `200` — GitHub moved the site with the repository |

      So **v0.0.1–v0.0.6 keep updating**: the `updates::feed::DEFAULT_URL` compiled into them still
      resolves through the redirect. An earlier draft of ADR 0044 decision 5 asserted the opposite
      and was wrong; this is why that decision asks for a measurement instead of a prediction. The
      handbook's old address is the one thing genuinely lost, as the ADR's *Hard, and accepted*
      paragraph says. The site at the new address still serves the deployment from before this
      task — the next run of `pages.yml` rebuilds it with the new `BASE_URL`.
- [ ] **T176b** `README.md` says what the product is called. MixLab is what you download; MixEngine
      is the engine inside it and the second download, for a machine with no screen. The sentence
      that answers *"do I need both?"* is one sentence and it is above the fold.
- [ ] **T176c** `docs/guide/` — 32 files, 398 occurrences, **read one at a time**. Where the word
      names the product it becomes MixLab; where it names the daemon, the CLI, the service manager
      or the headless distribution it stays. English and Vietnamese move together, because the
      handbook is one corpus ([ADR 0021](../decisions/0021-the-handbook-is-one-corpus-published-three-ways.md))
      and `mix docs` compiles both. A blind substitution here produces "the MixLab daemon", which is
      a worse sentence than the one it replaced.
- [ ] **T176d** What the packaging says about itself, and nothing it is built from. The `.deb`
      `Homepage:` and `packaging/README.md` follow the new repository; `tauri.conf.json`'s
      `productName` and `MIX_WINDOW_APP` already say MixLab and are left alone. **Release artifact
      names, the `mixengine/` directory inside the payload, `Package: mixengine`,
      `Programs\MixEngine` and `install::program_dirs` are not touched** — ADR 0044 decision 5 and
      decision 2 make all five identifiers, and renaming any of them ripples through `feed.sh`,
      `feed-check.sh`, `sign.sh` and `core::install` to buy a file name.
- [ ] **T176e** `mixnz/mixengine-sync` is renamed `mixnz/mixlab-sync` before it has a first commit,
      and the working copy beside it. Phase 30 is written against the new name already.

**Milestone M29** — searching for *MixLab* reaches the repository, the handbook and the download
page; the download page answers *"do I need both?"* in one sentence; `mix`, `mixengined`,
`MIXENGINE_HOME` and the ten crates are byte-for-byte unchanged; and `node scripts/check-docs.mjs`
passes with no link pointing at the old name.
