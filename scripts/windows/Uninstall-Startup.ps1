$ErrorActionPreference = 'Stop'
$runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
if (Test-Path -LiteralPath $runKey) {
  Remove-ItemProperty -Path $runKey -Name 'GLOBISENT' -ErrorAction SilentlyContinue
}
Write-Host 'GLOBISENT automatic startup has been removed for this Windows user.' -ForegroundColor Yellow
