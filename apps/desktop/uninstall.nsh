!macro customUnInstall
  ; Electron registers the per-user login entry using app.setName("kanbun").
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "kanbun"
!macroend
