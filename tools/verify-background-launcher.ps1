$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$launcher = Join-Path $root 'tools\run-control-background.ps1'
$workspace = Join-Path ([System.IO.Path]::GetTempPath()) ('lenssort-background-verification-' + [guid]::NewGuid().ToString('N'))
$stateDir = Join-Path $workspace 'state'
$controlDir = Join-Path $workspace 'control'
$portProbe = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, 0)
$portProbe.Start()
$port = ([System.Net.IPEndPoint]$portProbe.LocalEndpoint).Port
$portProbe.Stop()
$previousPort = [Environment]::GetEnvironmentVariable('LENSSORT_PORT', 'Process')
$previousControlDir = [Environment]::GetEnvironmentVariable('LENSSORT_CONTROL_DIR', 'Process')
$env:LENSSORT_PORT = [string]$port
$env:LENSSORT_CONTROL_DIR = $controlDir
$launcherProcess = $null
$result = [ordered]@{ status = 'failed'; createdAt = (Get-Date).ToUniversalTime().ToString('o'); port = $port; checks = @(); workspace = $workspace }
$childPid = $null
try {
  New-Item -ItemType Directory -Path $stateDir -Force | Out-Null
  New-Item -ItemType Directory -Path $controlDir -Force | Out-Null
  $launcherProcess = Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $launcher, '-StateDirectory', $stateDir, '-PassThru') -WorkingDirectory $root -WindowStyle Hidden -PassThru
  $response = $null
  for ($attempt = 1; $attempt -le 30; $attempt++) {
    Start-Sleep -Milliseconds 500
    $pidPath = Join-Path $stateDir 'control-server.pid'
    if (Test-Path -LiteralPath $pidPath) { $childPid = [int](Get-Content -LiteralPath $pidPath -Raw).Trim() }
    try {
      $response = Invoke-WebRequest -UseBasicParsing -Uri ('http://127.0.0.1:' + $port + '/api/status') -TimeoutSec 2
      if ($response.StatusCode -eq 200 -and $childPid) { break }
    } catch { $response = $null }
  }
  if (-not $response) { throw 'Background launcher did not expose /api/status within 15 seconds' }
  if (-not $childPid) { throw 'Background launcher did not publish the child PID' }
  $status = $response.Content | ConvertFrom-Json
  if (-not $status.config -or -not $status.phase) { throw 'Background launcher returned an invalid control status' }
  if (-not (Get-Process -Id $childPid -ErrorAction SilentlyContinue)) { throw 'Published child PID is not running' }
  $listener = @(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction Stop)
  if (-not ($listener | Where-Object { $_.OwningProcess -eq $childPid })) { throw 'API port is not owned by the launched child PID' }
  $result.phase = $status.phase
  $result.input = $status.config.input
  $result.output = $status.config.output
  $result.apiStatus = $response.StatusCode
  $result.childPid = $childPid
  $result.checks += 'dynamic port and isolated control directory'
  $result.checks += 'api status returned from the launched server'
  $result.checks += 'published child PID is running'
  $result.status = 'passed'
} catch {
  $result.error = $_.Exception.Message
  throw
} finally {
  if (-not $childPid -and (Test-Path -LiteralPath (Join-Path $stateDir 'control-server.pid'))) { $childPid = [int](Get-Content -LiteralPath (Join-Path $stateDir 'control-server.pid') -Raw).Trim() }
  if (-not $childPid -and $launcherProcess) {
    $children = @(Get-CimInstance Win32_Process -Filter ('ParentProcessId = ' + $launcherProcess.Id) | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -like '*tools/start-control-server.js*' })
    if ($children.Count -eq 1) { $childPid = $children[0].ProcessId }
  }
  if ($childPid) {
    $identity = Get-CimInstance Win32_Process -Filter ('ProcessId = ' + $childPid)
    if ($identity -and $identity.ParentProcessId -ne $launcherProcess.Id) { $childPid = $null; $result.status = 'failed'; $result.cleanupError = 'Published PID does not belong to this launcher' }
  }
  if ($childPid) { Stop-Process -Id $childPid -Force -ErrorAction SilentlyContinue }
  if ($launcherProcess) { Stop-Process -Id $launcherProcess.Id -Force -ErrorAction SilentlyContinue }
  if ($childPid) { Wait-Process -Id $childPid -Timeout 10 -ErrorAction SilentlyContinue }
  if ($launcherProcess) { Wait-Process -Id $launcherProcess.Id -Timeout 10 -ErrorAction SilentlyContinue }
  [Environment]::SetEnvironmentVariable('LENSSORT_PORT', $previousPort, 'Process')
  [Environment]::SetEnvironmentVariable('LENSSORT_CONTROL_DIR', $previousControlDir, 'Process')
  try {
    if (Test-Path -LiteralPath $workspace) {
      $resolved = (Resolve-Path -LiteralPath $workspace).Path
      if ($resolved -ne [System.IO.Path]::GetFullPath($workspace) -or -not $resolved.StartsWith([System.IO.Path]::GetTempPath(), [StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe background test cleanup path' }
      for ($attempt = 1; $attempt -le 10; $attempt++) {
        try { Remove-Item -LiteralPath $resolved -Recurse -Force; break }
        catch { if ($attempt -eq 10) { throw }; Start-Sleep -Milliseconds 200 }
      }
    }
    $result.checks += 'only test processes terminated and temporary files removed'
  } catch {
    $result.status = 'failed'
    $result.cleanupError = $_.Exception.Message
  } finally {
    $result | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $root 'artifacts\background-launcher-verification.json') -Encoding utf8
  }
  if ($result.cleanupError) { throw $result.cleanupError }
}
$result | ConvertTo-Json -Depth 5
