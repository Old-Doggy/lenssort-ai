$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$workspace = Join-Path ([System.IO.Path]::GetTempPath()) ('lenssort-startup-isolation-' + [guid]::NewGuid().ToString('N'))
$realShortcut = Join-Path ([Environment]::GetFolderPath('Startup')) 'LensSort AI - Local Control Server.lnk'
$beforeHash = if (Test-Path -LiteralPath $realShortcut) { (Get-FileHash -LiteralPath $realShortcut -Algorithm SHA256).Hash } else { $null }
$previousPort = [Environment]::GetEnvironmentVariable('LENSSORT_PORT', 'Process')
$previousControl = [Environment]::GetEnvironmentVariable('LENSSORT_CONTROL_DIR', 'Process')
$sentinel = $null
$report = [ordered]@{ status = 'failed'; createdAt = (Get-Date).ToUniversalTime().ToString('o'); checks = @() }
try {
  New-Item -ItemType Directory -Path $workspace -Force | Out-Null
  $env:LENSSORT_PORT = '0'
  $env:LENSSORT_CONTROL_DIR = Join-Path $workspace 'control'
  $sentinel = & (Join-Path $root 'tools\run-control-background.ps1') -StateDirectory $workspace -PassThru
  $origin = $null
  for ($attempt = 0; $attempt -lt 60; $attempt++) {
    Start-Sleep -Milliseconds 250
    $log = Join-Path $workspace 'control-server.out.log'
    if (Test-Path -LiteralPath $log) {
      $entry = Get-Content -LiteralPath $log -Encoding UTF8 | Select-Object -First 1
      if ($entry) { $origin = ($entry | ConvertFrom-Json).origin; break }
    }
  }
  if (-not $origin) { throw 'Sentinel server did not become ready' }
  $tokenBefore = (Invoke-RestMethod -Uri ($origin + '/api/status')).token
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $root 'tools\verify-startup.ps1') | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Isolated startup verifier failed' }
  $background = & (Join-Path $root 'tools\verify-background-launcher.ps1') | ConvertFrom-Json
  if ($background.status -ne 'passed') { throw 'Background verifier failed' }
  if ($env:LENSSORT_PORT -ne '0' -or $env:LENSSORT_CONTROL_DIR -ne (Join-Path $workspace 'control')) { throw 'Verifier changed the caller environment' }
  $report.checks += 'caller environment restored exactly'
  if (-not (Get-Process -Id $sentinel.Id -ErrorAction SilentlyContinue)) { throw 'Existing same-name server was stopped' }
  if ((Invoke-RestMethod -Uri ($origin + '/api/status')).token -ne $tokenBefore) { throw 'Existing server identity changed' }
  $report.checks += 'existing same-name server remains alive with the same API identity'
  $afterHash = if (Test-Path -LiteralPath $realShortcut) { (Get-FileHash -LiteralPath $realShortcut -Algorithm SHA256).Hash } else { $null }
  if ($beforeHash -ne $afterHash) { throw 'Real startup configuration changed' }
  $report.checks += 'real startup shortcut presence and bytes unchanged'
  $report.existingStartupPresent = [bool]$beforeHash
  $report.status = 'passed'
} catch {
  $report.error = $_.Exception.Message
  throw
} finally {
  if ($sentinel) { Stop-Process -Id $sentinel.Id -Force -ErrorAction SilentlyContinue; Wait-Process -Id $sentinel.Id -Timeout 10 -ErrorAction SilentlyContinue }
  [Environment]::SetEnvironmentVariable('LENSSORT_PORT', $previousPort, 'Process')
  [Environment]::SetEnvironmentVariable('LENSSORT_CONTROL_DIR', $previousControl, 'Process')
  $resolved = [System.IO.Path]::GetFullPath($workspace)
  if (-not $resolved.StartsWith([System.IO.Path]::GetTempPath(), [StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe sentinel cleanup path' }
  try {
    for ($attempt = 0; $attempt -lt 10; $attempt++) {
      try { if (Test-Path -LiteralPath $resolved) { Remove-Item -LiteralPath $resolved -Recurse -Force }; break }
      catch { if ($attempt -eq 9) { throw }; Start-Sleep -Milliseconds 200 }
    }
  } catch { $report.status = 'failed'; $report.cleanupError = $_.Exception.Message }
  $reportPath = Join-Path (Join-Path $root 'artifacts') 'startup-isolation-verification.json'
  [System.IO.File]::WriteAllText($reportPath, ($report | ConvertTo-Json -Depth 5), (New-Object System.Text.UTF8Encoding($false)))
  if ($report.cleanupError) { throw $report.cleanupError }
}
$report | ConvertTo-Json -Depth 5
