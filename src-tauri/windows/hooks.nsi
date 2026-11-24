; UT Stems installer hooks (Tauri NSIS). The processing engine is not inside the installer;
; the app downloads it into $INSTDIR\engine on first start. Uninstalling removes it too.

!macro NSIS_HOOK_PREUNINSTALL
  RMDir /r "$INSTDIR\engine"
!macroend
