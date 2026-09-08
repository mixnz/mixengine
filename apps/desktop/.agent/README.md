# .agent

Notes, conventions and decisions for agents (Claude Code) working on this project. Read the file
covering a topic before making changes in that area. The root [AGENT.md](../AGENT.md) is the short
entry point; everything detailed lives here.

## Structure

- `architecture/` — how the app is put together: process model, module layout, the paths data takes.
  Describes what exists, not what to do.
- `conventions/` — concrete, repeating code rules (naming, file layout, component patterns). One
  topic per file, named after the topic (e.g. `css-modules.md`).
- `decisions/` — architectural or technical decisions worth recording, with their reasoning (a
  library choice, a data-structure change). Named `YYYY-MM-DD-slug.md`.
- `notes/` — short-lived context: work in progress, things to follow up. Not a home for lasting
  conventions.
- `reviews/` — one file per full technical review of the repository, dated. Findings with a
  stable id and a status; the folder's own README says how they are written.

## Adding a file

- Pick the folder that matches the nature of the content (lasting convention vs. one-off decision
  vs. temporary note).
- Short kebab-case filename that says what is inside.
- Keep it dense: the rule, the reason if it isn't obvious, an example. No filler.
