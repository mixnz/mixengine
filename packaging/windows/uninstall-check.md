# Checking the Windows uninstaller by hand

Roadmap task T182, design
[docs/specs/2026-09-24-t182-removing-mixlab-is-one-act-design.md](../../docs/specs/2026-09-24-t182-removing-mixlab-is-one-act-design.md).

The uninstaller undoes real machine state: the hosts block, the certificate authority, the NRPT
rule, the port grant. Nothing in CI can click a UAC prompt, so these cases are walked by a person,
on a machine or VM whose MixLab setup they are prepared to lose.

Build the setup with `bash packaging/windows/build.sh`, install it, and set up at least one `.test`
site so there is something outside the home to undo. Then:

1. **The icon.** Installed apps shows MixLab with the MixLab icon, and so do the setup and
   `uninstall.exe`.
2. **The window is open.** Start Uninstall with MixLab running. The choices page offers *Also delete
   MixLab's data*, unticked. Clicking Uninstall asks to close MixLab; OK closes it and continues,
   Cancel leaves everything as it was.
3. **UAC declined.** Decline the prompt. The uninstaller says MixLab is still installed.
   `mix uninstall --dry-run` still lists every machine row as `would`, and
   `%LOCALAPPDATA%\Programs\MixEngine` is intact.
4. **A program in the way.** Start `php -S 127.0.0.1:8099` through the shim in a terminal, then
   Uninstall with the data box ticked. The page names `php` and stays open; nothing changed. Close
   it and click Uninstall again: it goes through.
5. **A finished run.** Nothing is left under `%LOCALAPPDATA%\Programs\MixEngine`; no `MixLab.lnk`
   in the Start menu; no `HKCU\Software\Classes\mixlab`; `%LOCALAPPDATA%\MixEngine` is gone when the
   box was ticked and there when it was not; no `MixEngine.removing-*` beside it.
6. **A relocated folder.** With `[paths]` `logs = "D:\\mixlogs"` in `config.toml` before the first
   start, the second box appears and lists `D:\mixlogs`. Each of the four combinations removes
   exactly what the design's D2 table says.
7. **Silent.** `uninstall.exe /S` with MixLab open closes it, keeps both kinds of data, and exits 0.
8. **An update over a running copy.** Running a newer setup while MixLab and the daemon are up asks,
   closes both, and installs without an "error opening file for writing" dialog.
