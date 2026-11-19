!macro customUnInstall
  ${ifNot} ${isUpdated}
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "com.poketokenbar.windows"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "com.poketokenbar.windows"
  ${endIf}
!macroend

# Stops only copies running from $INSTDIR; a ZIP-folder copy elsewhere hands its saves and pet state to the new app itself.
# electron-builder's default falls back to `taskkill /IM`, which closes every PokeTokenBar.exe window and disables the pet.
!macro customCheckAppRunning
  ${if} ${isUpdated}
    Sleep 1500
  ${endIf}
  System::Call 'kernel32::SetEnvironmentVariable(t "PTB_INSTALL_DIR", t "$INSTDIR\")'
  nsExec::Exec `"$PowerShellPath" -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "$$deadline = (Get-Date).AddSeconds(15); do { $$running = @(Get-CimInstance Win32_Process | Where-Object { $$_.ExecutablePath -and $$_.ExecutablePath.StartsWith($$env:PTB_INSTALL_DIR, [StringComparison]::OrdinalIgnoreCase) }); if ($$running.Count -eq 0) { exit 0 }; $$running | ForEach-Object { Stop-Process -Id $$_.ProcessId -Force -ErrorAction SilentlyContinue }; Start-Sleep -Milliseconds 300 } while ((Get-Date) -lt $$deadline); exit 1"`
  Pop $0
  ${if} $0 != 0
    DetailPrint `Could not stop ${PRODUCT_NAME} running from the install folder ($0).`
  ${endIf}
!macroend
