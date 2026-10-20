!macro customInstall
  DetailPrint "Configuring Ollama AI runtime for Raphael..."
  nsExec::ExecToLog 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\resources\scripts\setup-ollama.ps1"'
!macroend
