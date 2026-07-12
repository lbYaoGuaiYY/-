$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$env:U2NET_HOME = Join-Path $projectRoot ".qingshe-models"
$stdoutLog = Join-Path $projectRoot "asset-removal.out.log"
$stderrLog = Join-Path $projectRoot "asset-removal.err.log"

$service = Start-Process `
  -FilePath "pnpm.cmd" `
  -ArgumentList @("assets:server") `
  -WorkingDirectory $projectRoot `
  -RedirectStandardOutput $stdoutLog `
  -RedirectStandardError $stderrLog `
  -WindowStyle Hidden `
  -PassThru

try {
  Set-Location $projectRoot
  & pnpm dev
  exit $LASTEXITCODE
}
finally {
  if (-not $service.HasExited) {
    Stop-Process -Id $service.Id
  }
}
