; MixEngine — a per-user installer.
;
; `RequestExecutionLevel user` is the whole point: nothing here asks for UAC, so an update needs no
; administrator. The one file that must live somewhere an ordinary account cannot rewrite,
; `mixengine-elevate.exe`, is *not* placed by this installer — MixEngine installs it itself, inside
; the elevation prompt first-run setup already costs. See ADR 0015 and the T85 design, D1.
;
; Driven by packaging/windows/build.sh, which defines VERSION, STAGE, OUTFILE and INSTALL_SUBDIR —
; the last of them packaging/common.sh's MIX_INSTALL_WINDOWS, which mixengine-platform's
; `install::program_dirs` reads too, so the daemon and the window look where this writes (T107).

Unicode true
RequestExecutionLevel user
SetCompressor /SOLID lzma

!include "WinMessages.nsh"
!include "LogicLib.nsh"

!define NAME "MixEngine"
!define PUBLISHER "MixEngine"
!define UNINSTALL_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\MixEngine"

; Past this, `ReadRegStr` may have handed back a truncated value — see `AddToPath`.
!define PATH_LIMIT 1000

Name "${NAME} ${VERSION}"
OutFile "${OUTFILE}"
InstallDir "$LOCALAPPDATA\${INSTALL_SUBDIR}"
InstallDirRegKey HKCU "Software\MixEngine" "InstallDir"
ShowInstDetails show
ShowUninstDetails show

; **A components page, for one optional thing** — T105. The desktop shortcut is the only choice this
; installer offers, and `/S` (which `packaging/windows/probe.sh` uses) takes the defaults, so an
; unattended install still writes exactly what it wrote before plus the window itself.
Page components
Page directory
Page instfiles
UninstPage uninstConfirm
UninstPage instfiles

; "Is $1 somewhere inside $0?" — leaves 1 in $2 when it is and 0 when it is not.
;
; **A macro and not a function, and both of these are.** The NSIS convention for a function is to
; take its arguments on the stack and hand the result back the same way, which is four `Exch`es
; whose ordering is easy to get subtly wrong and impossible to test from here. Nothing outside this
; file calls either of these, so there is no convention to keep: expanded inline, they are ordinary
; straight-line code over `$0`–`$5` and a reader can check them by reading them.
!macro StrFind
  StrLen $3 $1
  StrCpy $4 0
  StrCpy $2 0
  ${Do}
    StrCpy $5 $0 $3 $4
    ${If} $5 == ""
      ${ExitDo}
    ${EndIf}
    ${If} $5 == $1
      StrCpy $2 1
      ${ExitDo}
    ${EndIf}
    IntOp $4 $4 + 1
  ${Loop}
!macroend

; "$0 with the first occurrence of $1 removed" — leaves the result in $0.
!macro StrCut
  StrLen $3 $1
  StrCpy $4 0
  ${Do}
    StrCpy $5 $0 $3 $4
    ${If} $5 == ""
      ${ExitDo}
    ${EndIf}
    ${If} $5 == $1
      StrCpy $6 $0 $4
      IntOp $7 $4 + $3
      StrCpy $7 $0 "" $7
      StrCpy $0 "$6$7"
      ${ExitDo}
    ${EndIf}
    IntOp $4 $4 + 1
  ${Loop}
!macroend

Section "MixEngine" SecCore
  SectionIn RO
  SetOutPath "$INSTDIR"
  File "${STAGE}\mix.exe"
  File "${STAGE}\mixengined.exe"
  ; Beside `mixengined.exe`, which is the only place `core::shims::source` looks. Without it the
  ; daemon starts, answers `status`, and `<root>\bin` stays empty — T85c.
  File "${STAGE}\mixengine-shim.exe"
  File "${STAGE}\mixengine-elevate.exe"
  ; MixLab, the window — T105. One name on every operating system: `updates::apply::swap` looks a
  ; payload's name up as `directory.join(binary_name(name))` and `binary_name` appends `.exe` and
  ; nothing else, so an install file spelled `MixLab.exe` is one every future update would skip.
  ; What a user actually clicks is the shortcut below, and that is named MixLab.
  File "${STAGE}\mixlab.exe"

  WriteUninstaller "$INSTDIR\uninstall.exe"

  WriteRegStr HKCU "Software\MixEngine" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayName" "${NAME}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "Publisher" "${PUBLISHER}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayIcon" "$INSTDIR\mix.exe"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "UninstallString" "$\"$INSTDIR\uninstall.exe$\""
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "NoRepair" 1

  ; **A flat Start Menu entry and not a one-item folder.** `SetShellVarContext` is left at its
  ; default, which under `RequestExecutionLevel user` is this account's own Start Menu — nothing
  ; here asks for UAC. The `SetOutPath` at the top of this section is also the shortcut's working
  ; directory.
  CreateShortcut "$SMPROGRAMS\MixLab.lnk" "$INSTDIR\mixlab.exe"

  ; `mixdb://`, per user — the merge design's D10. Taking the scheme over from a standalone MixDB
  ; that is still installed is intended: the merged application is what a `mixdb://` link opens from
  ; now on. What is *not* intended is taking it away again on uninstall if MixDB has since taken it
  ; back, which is `un.RemoveScheme` below.
  WriteRegStr HKCU "Software\Classes\mixdb" "" "URL:MixDB Protocol"
  WriteRegStr HKCU "Software\Classes\mixdb" "URL Protocol" ""
  WriteRegStr HKCU "Software\Classes\mixdb\DefaultIcon" "" "$INSTDIR\mixlab.exe,0"
  WriteRegStr HKCU "Software\Classes\mixdb\shell\open\command" "" '"$INSTDIR\mixlab.exe" "%1"'

  Call AddToPath
SectionEnd

; **Unselected by default**, which is what `/o` means and what makes this optional in the sense the
; roadmap asks for: a person who wants an icon on their desktop ticks a box, and nobody else grows
; one. A silent install takes the defaults, so `probe.sh`'s readings are unchanged.
Section /o "Desktop shortcut for MixLab" SecDesktop
  SetOutPath "$INSTDIR"
  CreateShortcut "$DESKTOP\MixLab.lnk" "$INSTDIR\mixlab.exe"
SectionEnd

; Append $INSTDIR to this user's PATH — and refuse rather than risk it.
;
; **The guard is not decoration.** NSIS's `ReadRegStr` silently truncates at `NSIS_MAX_STRLEN`, so
; writing back what it read can cut a long PATH in half. A PATH that was not extended is an
; inconvenience; a PATH that was truncated is somebody's afternoon. See the T85 design, D10.
;
; `<root>/bin` — the directory of runtime shims — is deliberately *not* written here. That one
; belongs to `path.install`, which writes it when somebody asks and takes it back off again; the two
; therefore own different segments of one value, which is what makes two authors safe.
Function AddToPath
  ReadRegStr $0 HKCU "Environment" "Path"
  StrLen $8 $0

  ${If} $8 >= ${PATH_LIMIT}
    DetailPrint "This account's PATH is too long for the installer to edit safely."
    DetailPrint "Add $INSTDIR to it by hand, or run: mix path install"
    Return
  ${EndIf}

  StrCpy $1 "$INSTDIR"
  !insertmacro StrFind

  ${If} $2 == 1
    Return
  ${EndIf}

  ${If} $0 == ""
    WriteRegExpandStr HKCU "Environment" "Path" "$INSTDIR"
  ${Else}
    WriteRegExpandStr HKCU "Environment" "Path" "$0;$INSTDIR"
  ${EndIf}

  ; So a shell started from Explorer afterwards picks it up without a logout.
  SendMessage ${HWND_BROADCAST} ${WM_WININICHANGE} 0 "STR:Environment" /TIMEOUT=5000
FunctionEnd

; Take exactly our own segment back out, leaving the rest of the value as it was.
;
; The separator is removed with the directory rather than after it, so a PATH that held only this
; entry does not end up as a lone `;` — and the second pass covers the case where the entry was
; first in the value and had no separator in front of it.
Function un.RemoveFromPath
  ReadRegStr $0 HKCU "Environment" "Path"
  StrLen $8 $0

  ${If} $8 >= ${PATH_LIMIT}
    DetailPrint "This account's PATH is too long to edit safely; $INSTDIR was left on it."
    Return
  ${EndIf}

  StrCpy $1 ";$INSTDIR"
  !insertmacro StrCut

  StrCpy $1 "$INSTDIR"
  !insertmacro StrCut

  WriteRegExpandStr HKCU "Environment" "Path" "$0"
  SendMessage ${HWND_BROADCAST} ${WM_WININICHANGE} 0 "STR:Environment" /TIMEOUT=5000
FunctionEnd

; Take `mixdb://` back — **only if it is still ours**.
;
; A standalone MixDB may still be installed and still be in use, and the merge design's D7 rule is
; that the old copy is never touched. So this reads the command back and looks for our own
; `$INSTDIR` inside it: a machine where MixDB re-registered itself after us keeps MixDB's handler,
; which is the correct outcome and the quiet one.
Function un.RemoveScheme
  ReadRegStr $0 HKCU "Software\Classes\mixdb\shell\open\command" ""

  ${If} $0 == ""
    Return
  ${EndIf}

  StrCpy $1 "$INSTDIR"
  !insertmacro StrFind

  ${If} $2 == 1
    DeleteRegKey HKCU "Software\Classes\mixdb"
  ${Else}
    DetailPrint "mixdb:// now points somewhere else; leaving it alone."
  ${EndIf}
FunctionEnd

Section "Uninstall"
  ; **Only the files this installer wrote.** What MixEngine did to the *machine* — the hosts block,
  ; the resolver wiring, the CA in every store, the port grant, and the helper it installed — is
  ; `mix uninstall`'s, which is roadmap task T87 and does not exist yet. Saying so in the log beats
  ; pretending this removed it.
  DetailPrint "Removing the files this installer wrote."
  DetailPrint "What MixEngine changed on this machine is removed by `mix uninstall` (not yet built)."

  Call un.RemoveFromPath
  Call un.RemoveScheme

  ; One `Delete` per `File` above, and the pairing is not decoration: `RMDir` below removes an
  ; empty directory and says nothing when it does not, so a binary with no line here would stay on
  ; the machine for ever with no sign of it.
  Delete "$INSTDIR\mix.exe"
  Delete "$INSTDIR\mixengined.exe"
  Delete "$INSTDIR\mixengine-shim.exe"
  Delete "$INSTDIR\mixengine-elevate.exe"
  Delete "$INSTDIR\mixlab.exe"
  Delete "$INSTDIR\uninstall.exe"

  ; Both shortcuts. `Delete` says nothing about a file that is not there, so the optional one needs
  ; no condition — and a condition would need the section state, which an uninstaller does not have.
  Delete "$SMPROGRAMS\MixLab.lnk"
  Delete "$DESKTOP\MixLab.lnk"

  RMDir "$INSTDIR"

  DeleteRegKey HKCU "${UNINSTALL_KEY}"
  DeleteRegKey HKCU "Software\MixEngine"
SectionEnd
