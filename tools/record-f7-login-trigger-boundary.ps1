$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$startup = [Environment]::GetFolderPath('Startup')
$shortcut = Join-Path $startup 'LensSort AI - Local Control Server.lnk'
$isInstalled = Test-Path -LiteralPath $shortcut -PathType Leaf
$evidence = [ordered]@{
  status = 'external-input-required'
  createdAt = (Get-Date).ToUniversalTime().ToString('o')
  step = 'F7.1'
  isolatedVerification = 'artifacts/startup-isolation-verification.json'
  isolatedStartupVerification = 'artifacts/startup-verification.json'
  realStartupShortcutPresent = $isInstalled
  realWindowsLogoutLoginPerformed = $false
  webServerStartedAfterRealLogin = $false
  automaticPhotoProcessingAfterLogin = $false
  checks = @(
    'isolated Startup shortcut installation and removal passed',
    'isolated background launcher passed',
    'real Startup folder was not modified by verification',
    'actual Windows logout/login event was not performed',
    'actual post-login server observation is not available'
  )
  boundary = 'Manual or user-authorized Windows logout/login is required. Automated verification must not modify the real Startup folder or interrupt the current user session.'
  nextAction = 'User installs the startup shortcut and performs a controlled Windows logout/login; then verify the server log and /api/status without starting photo filtering.'
}
if ($isInstalled) {
  $shell = New-Object -ComObject WScript.Shell
  $link = $shell.CreateShortcut($shortcut)
  $evidence.shortcut = [ordered]@{ path = $shortcut; targetPath = $link.TargetPath; arguments = $link.Arguments; workingDirectory = $link.WorkingDirectory; sha256 = (Get-FileHash -LiteralPath $shortcut -Algorithm SHA256).Hash }
}
$json = $evidence | ConvertTo-Json -Depth 7
$evidencePath = Join-Path (Join-Path $root 'artifacts') 'f7-login-trigger-boundary.json'
[System.IO.File]::WriteAllText($evidencePath, $json, (New-Object System.Text.UTF8Encoding($false)))
$json
