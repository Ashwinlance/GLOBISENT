$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$launcher = Join-Path $projectRoot 'scripts\windows\Start-GLOBISENT.bat'
if (-not (Test-Path -LiteralPath $launcher)) { throw "Launcher not found: $launcher" }
$runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
New-Item -Path $runKey -Force | Out-Null
$command = 'cmd.exe /c ""' + $launcher + '""'
New-ItemProperty -Path $runKey -Name 'GLOBISENT' -Value $command -PropertyType String -Force | Out-Null
Write-Host 'GLOBISENT will start when this Windows user signs in.' -ForegroundColor Green
Write-Host 'To undo this, run scripts\windows\Uninstall-Startup.ps1.'
