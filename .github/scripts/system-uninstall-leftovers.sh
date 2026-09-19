#!/usr/bin/env bash
# What the uninstall suite left behind, printed for a person reading `system`'s log. Called by
# `system`'s step of the same name, with `if: always()`: the suite asserts, this only shows. Every
# line answers "nothing there" as well as "something there", because an empty listing and a
# missing command look the same in a log.
set -euo pipefail

case "$RUNNER_OS" in
  Windows)
    reg query "HKLM\SYSTEM\CurrentControlSet\Control\Session Manager" /v PendingFileRenameOperations || echo "nothing scheduled for the next restart"
    ls -l "${ProgramFiles:-C:/Program Files}/MixEngine" 2>/dev/null || echo "no MixEngine directory under Program Files, which is the answer"
    ;;
  macOS)
    ls -la /etc/resolver/ 2>/dev/null || echo "no /etc/resolver, which is the answer"
    ls -l /Library/PrivilegedHelperTools/ | grep -i mixengine || echo "no helper, which is the answer"
    ls -l /Library/Logs/MixEngine 2>/dev/null || echo "no audit log directory, which is the answer"
    ;;
  *)
    ls -l /usr/local/libexec/mixengine 2>/dev/null || echo "no helper directory, which is the answer"
    ls -l /var/log/mixengine 2>/dev/null || echo "no audit log directory, which is the answer"
    ;;
esac
echo "--- the managed hosts block ---"
grep -c "BEGIN MixEngine" /etc/hosts 2>/dev/null || grep -c "BEGIN MixEngine" "${SystemRoot:-C:/Windows}/System32/drivers/etc/hosts" 2>/dev/null || echo "no block, which is the answer"
