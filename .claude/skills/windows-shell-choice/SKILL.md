---
name: windows-shell-choice
description: Use before running any command on this Windows machine — a git command, a script, gh, sed, node, cargo, anything with quotes or $ in it — and whenever a command hangs, prints "accepts at most 1 arg", mangles a string, or writes characters nobody typed.
---

# Which shell, on this machine

**Anything whose text matters** — quotes, `$`, backticks, `--jq`, a commit message, a heredoc —
**goes through Git Bash or through a file.** PowerShell is for Windows programs and for `cargo`,
`git` and `gh` calls whose arguments are plain words.

Every row below was paid for on this repository.

## What PowerShell breaks

| Written as | What happens | Why |
| --- | --- | --- |
| `bash scripts/ask-ci.sh` | **hangs forever**, no output, no run created | reads a stdin PowerShell never closes |
| `git commit -F -` | fails | stdin again |
| `wsl -e bash -lc "for i in $(seq 1 3)"` | the loop arrives empty | PowerShell expands `$(...)` first |
| `gh run view X --jq "\(.name)"` | `accepts at most 1 arg(s), received 2` | it strips the inner quotes |
| `"...`build`..."` in a string | writes a **backspace character** into the file | `` ` `` is its escape character |
| `bash -c "node …"` | `node: command not found` | `bash` can resolve to WSL, another PATH |

## What Git Bash breaks

| Written as | What happens | Why |
| --- | --- | --- |
| `reg query "HKLM\…" /v Name` | `ERROR: Invalid syntax` | MSYS rewrites `/v` as a path |
| `tar -xf D:\a\_temp\x.zip` | treats `D` as a **remote host** | GNU tar; use `"$SYSTEMROOT/System32/tar.exe"` |

## What is not installed

| Here | Not here |
| --- | --- |
| `rg` `sed` `awk` `curl` `tar` `unzip` `git` `gh` `node` `python` | **`jq`** `fd` `yq` |

A missing program in a pipeline yields an empty string, not an error, so its absence arrives as a
wrong answer. **JSON from `gh` never goes through a pipe:** `gh … --json f1,f2 --jq '<filter>'`,
since `gh` embeds jq. Piping to jq left a watcher polling run 35481399561 for twenty minutes after
it had finished. A `PreToolUse` hook — `~/.claude/hooks/no-jq.mjs`, registered in
`~/.claude/settings.json`, so it covers every project and every worktree on this machine — now
refuses these three and names what to use instead. It ignores heredoc bodies and quoted strings, so
writing about them still works.

## The recipes

| To | Do |
| --- | --- |
| run a repository script | the Bash tool: `bash .github/scripts/fetch-package.sh --probe "caddy version" …` |
| ask GitHub something | `gh run view <id> --json jobs --jq '<filter>'`, from Git Bash so the quotes survive |
| commit a real message | write it to a scratchpad file, then `git commit -F <path>` — never `-m` with several lines from PowerShell, never `-F -` |
| edit a file mechanically | `sed -i` in Git Bash, or the Edit tool; never build the replacement inside a PowerShell string. Then `grep -c $'\x08' <file>` — 0, or a control character landed |
| reach WSL | put the body in a `.sh` file and run the file: `wsl -e bash -l /mnt/c/…/thing.sh` |
| use a heredoc | `<<'EOF'` in the Bash tool, quoted so nothing expands. Through PowerShell it does not work |

## A command that hangs

Kill it rather than wait — here a hang is almost always a program on a stdin that will never close.
Then run it from Git Bash, or hand it its input as a file.

## A loop nobody is watching

A `Monitor` or a background task reports by printing, so one that prints nothing looks the same
whether it is working, stuck, or reading an empty variable forever. **An answer that could not be
read is not an answer of "no."** Print on every exit path, and to stdout — only stdout becomes a
notification.

The other half of that rule: **an event already reported is not an event.** A loop that re-reads a
finished job every ninety seconds will say the same thing forty times and be stopped for the volume.
Keep what was last printed in a variable and print the difference, not the state.

```bash
command -v gh >/dev/null || { echo "FATAL: no gh on PATH"; exit 3; }          # dependencies, at the top
[ -z "$state" ] && { echo "FATAL: gh run view said nothing"; exit 3; }        # empty is a failure, not "not yet"
[ "$SECONDS" -gt 2400 ] && { echo "TIMEOUT: 40 minutes, giving up"; exit 4; } # a deadline of its own
```

## Not a shell problem

`cargo test -p <crate>` failing with "mixengined.exe is not there" or "fakeservice is not there":
those suites drive real binaries. `cargo build -p mixengine-daemon --bin mixengined`,
`cargo build -p mixengine-testkit --bin fakeservice`, or `cargo test --workspace`.
