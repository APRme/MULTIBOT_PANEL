param(
  [string]$ConfigPath = "panel.config.json",
  [int]$RestartDelaySeconds = 15,
  [switch]$NoRestart
)

$ErrorActionPreference = "Stop"
Set-Location -LiteralPath $PSScriptRoot

function Resolve-ConfigPath {
  param([string]$PathText)

  if ([System.IO.Path]::IsPathRooted($PathText)) {
    return $PathText
  }

  return Join-Path $PSScriptRoot $PathText
}

$resolvedConfigPath = Resolve-ConfigPath -PathText $ConfigPath
$indexPath = Join-Path $PSScriptRoot "index.js"

if (-not (Test-Path -LiteralPath $indexPath)) {
  Write-Error "[MULTIBOT_PANEL] index.js not found: $indexPath"
  exit 1
}

if (-not (Test-Path -LiteralPath $resolvedConfigPath)) {
  Write-Error "[MULTIBOT_PANEL] config not found: $resolvedConfigPath"
  exit 1
}

$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCommand) {
  Write-Error "[MULTIBOT_PANEL] node was not found in PATH"
  exit 1
}

Write-Host "[MULTIBOT_PANEL] Starting..."
Write-Host "[MULTIBOT_PANEL] Config: $resolvedConfigPath"

while ($true) {
  & $nodeCommand.Source $indexPath $resolvedConfigPath
  $exitCode = $LASTEXITCODE

  if ($exitCode -eq 0) {
    Write-Host "[MULTIBOT_PANEL] Process exited normally."
    exit 0
  }

  Write-Warning "[MULTIBOT_PANEL] Process exited with code $exitCode."

  if ($NoRestart) {
    exit $exitCode
  }

  Write-Host "[MULTIBOT_PANEL] Restarting in $RestartDelaySeconds seconds..."
  Start-Sleep -Seconds $RestartDelaySeconds
}
