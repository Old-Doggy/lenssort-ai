$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$manager = Join-Path $root 'tools\manage-startup.ps1'
$startup = Join-Path ([System.IO.Path]::GetTempPath()) ('lenssort-startup-verification-' + [guid]::NewGuid().ToString('N'))
$shortcut = Join-Path $startup 'LensSort AI - Local Control Server.lnk'
$checks = [System.Collections.Generic.List[string]]::new()
$reportPath = Join-Path $root 'artifacts\startup-verification.json'
$run = {
  param([string]$mode)
  $output = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $manager -Mode $mode -StartupDirectory $startup
  if ($LASTEXITCODE -ne 0) { throw ('Startup manager failed in mode ' + $mode + ': ' + $LASTEXITCODE) }
  $output
}
$result = [ordered]@{ status = 'failed'; createdAt = (Get-Date).ToUniversalTime().ToString('o'); mechanism = 'isolated current-user Startup folder fixture'; checks = $checks; shortcut = $shortcut }

try {
  New-Item -ItemType Directory -Path $startup -Force | Out-Null
  & $run 'validate' | Out-Null
  $checks.Add('isolated configuration validates')
  & $run 'install' | Out-Null
  if (-not (Test-Path -LiteralPath $shortcut -PathType Leaf)) { throw 'Startup shortcut was not created in the isolated fixture' }
  $shell = New-Object -ComObject WScript.Shell
  $link = $shell.CreateShortcut($shortcut)
  if ($link.TargetPath -notlike '*powershell.exe' -or $link.Arguments -notlike '*run-control-background.ps1*' -or $link.WorkingDirectory -ne $root) { throw 'Startup shortcut target is incorrect' }
  $checks.Add('shortcut points to background launcher and project root')
  $status = (& $run 'status' | ConvertFrom-Json)
  if ($status.status -ne 'installed') { throw 'Installed status was not reported' }
  $checks.Add('installed status reported')
  & $run 'uninstall' | Out-Null
  if (Test-Path -LiteralPath $shortcut) { throw 'Startup shortcut remained after isolated uninstall' }
  $checks.Add('isolated uninstall removes the test shortcut')
  $final = (& $run 'status' | ConvertFrom-Json)
  if ($final.status -ne 'not-installed') { throw 'Final status was not not-installed' }
  $checks.Add('final status is not-installed')
  $result.status = 'passed'
  $result.note = 'The real user Startup folder was never modified. The startup launcher starts the local web server only; it does not press the webpage filtering button.'
} catch {
  $result.error = $_.Exception.Message
  throw
} finally {
  try {
    if (Test-Path -LiteralPath $startup) {
      $resolved = (Resolve-Path -LiteralPath $startup).Path
      if ($resolved -ne [System.IO.Path]::GetFullPath($startup) -or -not $resolved.StartsWith([System.IO.Path]::GetTempPath(), [StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe test cleanup path' }
      Remove-Item -LiteralPath $resolved -Recurse -Force
    }
  } catch {
    $result.status = 'failed'
    $result.cleanupError = $_.Exception.Message
  } finally {
    [System.IO.File]::WriteAllText($reportPath, ($result | ConvertTo-Json -Depth 5), (New-Object System.Text.UTF8Encoding($false)))
  }
  if ($result.cleanupError) { throw $result.cleanupError }
  $result | ConvertTo-Json -Depth 5
}
