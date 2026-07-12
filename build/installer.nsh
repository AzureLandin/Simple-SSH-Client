; Assisted uninstall: ask whether to remove NodeShell user data.
; App userData is pinned to %APPDATA%\nodeshell (see src/main/index.ts).

!macro customUnInstall
  ${ifNot} ${isUpdated}
    ${IfNot} ${Silent}
      MessageBox MB_YESNO|MB_ICONQUESTION \
        "Also delete NodeShell user data?$\r$\n(hosts, credentials, settings)$\r$\n$\r$\n是否同时删除用户数据？$\r$\n（主机列表、凭据、设置）" \
        IDNO nodeshell_skip_delete_app_data

      ; Electron per-user data lives under the current user profile.
      SetShellVarContext current
      RMDir /r "$APPDATA\nodeshell"

      nodeshell_skip_delete_app_data:
    ${EndIf}
  ${endif}
!macroend
