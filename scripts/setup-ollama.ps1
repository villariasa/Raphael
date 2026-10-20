# Raphael - Automated Ollama Setup Script for Windows Installer
[CmdletBinding()]
param()

$ErrorActionPreference = 'SilentlyContinue'

Write-Host "=========================================="
Write-Host " Raphael - Ollama AI Runtime Setup"
Write-Host "=========================================="

$localOllama = "$env:LOCALAPPDATA\Programs\Ollama\ollama.exe"
$systemOllama = "$env:ProgramFiles\Ollama\ollama.exe"
$hasOllama = (Get-Command ollama -ErrorAction SilentlyContinue) -or (Test-Path $localOllama) -or (Test-Path $systemOllama)

if ($hasOllama) {
    Write-Host "[OK] Ollama is already installed on this machine."
    exit 0
}
    Write-Host "[INFO] Ollama not found. Initiating silent installation..."
    $installerPath = "$env:TEMP\OllamaSetup.exe"

    try {
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 -bor [Net.SecurityProtocolType]::Tls13
        Write-Host "[INFO] Downloading Ollama installer from https://ollama.com/download/OllamaSetup.exe..."
        
        $client = New-Object System.Net.WebClient
        $client.DownloadFile("https://ollama.com/download/OllamaSetup.exe", $installerPath)

        if (Test-Path $installerPath) {
            Write-Host "[INFO] Running Ollama installer silently..."
            $process = Start-Process -FilePath $installerPath -ArgumentList "/SP-", "/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART" -Wait -PassThru
            Write-Host "[OK] Ollama installation completed with exit code $($process.ExitCode)."
            Remove-Item -Path $installerPath -Force -ErrorAction SilentlyContinue
        } else {
            Write-Warning "[WARN] Downloaded installer not found at $installerPath."
        }
    } catch {
        Write-Warning "[WARN] Could not automatically download Ollama: $($_.Exception.Message)"
        Write-Host "[INFO] Raphael will prompt to complete setup when launched."
    }
}

exit 0
