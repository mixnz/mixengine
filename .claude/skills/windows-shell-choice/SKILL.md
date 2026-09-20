---
name: windows-shell-choice
description: Use before running any command on this Windows machine — a git command, a script, gh, sed, node, cargo, anything with quotes or $ in it — and whenever a command hangs, prints "accepts at most 1 arg", mangles a string, or writes characters nobody typed.
---

# Which shell, on this machine

Two shells reach the same files here: **PowerShell 5.1** and **Git Bash**. They fail differently,
and every failure below was paid for on this repository rather than read somewhere.

**The rule in one line:** anything whose text matters — quotes, `$`, backticks, `--jq`, a commit
message, a heredoc — goes through Git Bash or through a file. PowerShell is for Windows programs and
for `cargo`, `git` and `gh` calls whose arguments are plain words.

## What each one breaks

| Written as | In PowerShell | Why |
| --- | --- | --- |
| `bash scripts/ask-ci.sh` | **hangs forever**, no output, no run created | the script reads from a stdin PowerShell never closes; the task has to be killed |
| `wsl -e bash -lc "for i in $(seq 1 3)"` | `seq` runs *in PowerShell*, the loop arrives empty | PowerShell expands `$(...)` before WSL sees it |
| `gh run view X --jq "\(.name)"` | `accepts at most 1 arg(s), received 2` | PowerShell strips the inner quotes |
| `"...`build`..."` in a string | writes a **backspace character** into the file | `` `b `` is PowerShell's escape for backspace, and `` ` `` is its escape character |
| `git commit -F -` | fails | stdin again |
| `bash -c "node …"` | `node: command not found` | `bash` from PowerShell can resolve to WSL, a different machine with a different PATH |

| Written as | In Git Bash | Why |
| --- | --- | --- |
| `reg query "HKLM\…" /v Name` | `ERROR: Invalid syntax` | MSYS rewrites `/v` as a path |
| `tar -xf D:\a\_temp\x.zip` | treats `D` as a **remote host** | GNU tar; use `"$SYSTEMROOT/System32/tar.exe"` for zips |
| `cargo test -p mixengine-cli` | "mixengined.exe is not there" | not a shell problem — see the last section |

## The safe way to do the five things that keep coming up

**Run a repository script.** Git Bash, through the Bash tool:

```bash
bash .github/scripts/fetch-package.sh --probe "caddy version" caddy 2.11.4 MIXENGINE_CADDY_PACKAGE
```

**Ask GitHub something.** Git Bash, so `--jq` survives:

```bash
gh run view 35470533602 --json jobs --jq '.jobs[] | select(.conclusion == "failure") | .name'
```

**Commit with a real message.** Write the message to a file in the scratchpad, then `git commit -F
<path>` from either shell. Never `-m` with a multi-line string from PowerShell, and never `-F -`.

**Edit a file mechanically.** `sed -i` in Git Bash, or the Edit tool. **Never build the replacement
text inside a PowerShell string** — that is where the backspace came from. After any scripted edit
of prose, check what landed:

```bash
grep -c $'\x08' <file>   # 0, or a control character got written
```

**Reach WSL.** Put the commands in a `.sh` file in the scratchpad and run the file. Do not pass a
script body through `wsl -e bash -lc "…"` from PowerShell.

```bash
wsl -e bash -l /mnt/c/Users/.../scratchpad/thing.sh
```

## Heredocs

`python - <<'EOF'` and `bash <<'EOF'` in the **Bash tool** work here and are used throughout this
repository's history. The quoted `'EOF'` matters: it stops the shell expanding anything inside.
What does not work is a heredoc, or any multi-line string, passed through PowerShell.

## When a command hangs

Kill it rather than waiting: on this machine a hang is almost always a program waiting on a stdin
that will never close, and it will still be there in ten minutes. Then run the same thing from Git
Bash, or give it its input as a file.

## Not a shell problem

`cargo test -p <crate>` failing with "mixengined.exe is not there" or "fakeservice is not there" is
this workspace's own rule: those suites drive real binaries. Build them first —
`cargo build -p mixengine-daemon --bin mixengined`, `cargo build -p mixengine-testkit --bin
fakeservice` — or run `cargo test --workspace`.
