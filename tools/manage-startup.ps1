[CmdletBinding(SupportsShouldProcess)]
param(
  [ValidateSet('install', 'uninstall', 'status', 'validate')]
  [string]$Mode = 'status',
  [string]$StartupDirectory
)

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$launcher = Join-Path $root 'tools\run-control-background.ps1'
$powershell = (Get-Command powershell.exe -ErrorAction Stop).Source
$node = (Get-Command node.exe -ErrorAction SilentlyContinue).Source
$startup = if ($StartupDirectory) { (Resolve-Path -LiteralPath $StartupDirectory -ErrorAction Stop).Path } else { [Environment]::GetFolderPath('Startup') }
$shortcut = Join-Path $startup 'LensSort AI - Local Control Server.lnk'

function Test-Setup {
  if (-not $node) { throw 'node.exe not found in PATH' }
  if (-not (Test-Path -LiteralPath $launcher -PathType Leaf)) { throw 'background launcher missing' }
  if (-not (Test-Path -LiteralPath $startup -PathType Container)) { throw 'Current-user Startup folder is unavailable' }
  [pscustomobject]@{ status = 'valid'; root = $root; launcher = $launcher; powershell = $powershell; node = $node; startup = $startup; shortcut = $shortcut; trigger = 'current-user-startup-folder' } | ConvertTo-Json
}

function New-StartupShortcut {
  $shell = New-Object -ComObject WScript.Shell
  $link = $shell.CreateShortcut($shortcut)
  $link.TargetPath = $powershell
  $link.Arguments = '-NoProfile -ExecutionPolicy Bypass -File "' + $launcher + '"'
  $link.WorkingDirectory = $root
  $link.Description = 'Starts the LensSort AI local web control server; does not start photo filtering.'
  $link.Save()
}

if ($Mode -eq 'validate') { Test-Setup; exit 0 }

if ($Mode -eq 'status') {
  if (-not (Test-Path -LiteralPath $shortcut -PathType Leaf)) { [pscustomobject]@{ status = 'not-installed'; startup = $startup; shortcut = $shortcut } | ConvertTo-Json; exit 0 }
  [pscustomobject]@{ status = 'installed'; startup = $startup; shortcut = $shortcut } | ConvertTo-Json -Depth 4
  exit 0
}

if ($Mode -eq 'install') {
  Test-Setup | Out-Null
  if ($PSCmdlet.ShouldProcess($shortcut, 'create current-user startup shortcut')) {
    New-StartupShortcut
    [pscustomobject]@{ status = 'installed'; shortcut = $shortcut; launcher = $launcher; note = 'Starts the local web server at user logon; photo filtering still requires the webpage button.' } | ConvertTo-Json
  }
  exit 0
}

if ($Mode -eq 'uninstall') {
  if (-not (Test-Path -LiteralPath $shortcut -PathType Leaf)) { [pscustomobject]@{ status = 'not-installed'; shortcut = $shortcut } | ConvertTo-Json; exit 0 }
  if ($PSCmdlet.ShouldProcess($shortcut, 'remove current-user startup shortcut')) {
    Remove-Item -LiteralPath $shortcut -Force
    [pscustomobject]@{ status = 'uninstalled'; shortcut = $shortcut } | ConvertTo-Json
  }
  exit 0
}

throw 'Unsupported mode'
