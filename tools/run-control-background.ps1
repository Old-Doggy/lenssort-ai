param([string]$StateDirectory, [switch]$PassThru)

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$stateDir = if ($StateDirectory) { [System.IO.Path]::GetFullPath($StateDirectory) } else { Join-Path $root 'data\service-state' }
New-Item -ItemType Directory -Path $stateDir -Force | Out-Null
$logPath = Join-Path $stateDir 'startup.log'
$node = (Get-Command node.exe -ErrorAction SilentlyContinue).Source
if (-not $node) {
  Add-Content -LiteralPath $logPath -Value ((Get-Date -Format o) + ' node.exe not found in PATH')
  throw 'node.exe not found in PATH'
}
$output = Join-Path $stateDir 'control-server.out.log'
$errorOutput = Join-Path $stateDir 'control-server.err.log'
$pidPath = Join-Path $stateDir 'control-server.pid'
try {
  $child = Start-Process -FilePath $node -ArgumentList @('tools/start-control-server.js') -WorkingDirectory $root -WindowStyle Hidden -RedirectStandardOutput $output -RedirectStandardError $errorOutput -PassThru
  Set-Content -LiteralPath $pidPath -Value ([string]$child.Id) -Encoding ascii
  Add-Content -LiteralPath $logPath -Value ((Get-Date -Format o) + ' control server launch requested; pid=' + $child.Id)
  if ($PassThru) { $child }
} catch {
  Add-Content -LiteralPath $logPath -Value ((Get-Date -Format o) + ' launch failed: ' + $_.Exception.Message)
  throw
}
