param(
  [Parameter(Mandatory=$true)][string]$ExtensionId,
  [ValidateSet('Chrome','Edge','Both')][string]$Browser='Chrome'
)
$ErrorActionPreference = 'Stop'
$Here = Split-Path -Parent $MyInvocation.MyCommand.Path
$HostPy = Join-Path $Here 'host.py'
$Exe = Join-Path $Here 'dist\flow_automation_native.exe'
$Manifest = Join-Path $Here 'com.veo.automation.native.json'

# Native Messaging requires an executable path. Build the tiny Python host to EXE.
try {
  python -m PyInstaller --version | Out-Null
} catch {
  throw "PyInstaller chưa có. Hãy chạy: python -m pip install pyinstaller"
}
python -m PyInstaller --onefile --noconsole --name flow_automation_native --distpath (Join-Path $Here 'dist') --workpath (Join-Path $Here 'build') --specpath $Here $HostPy
if (!(Test-Path $Exe)) { throw "Không tạo được $Exe" }

$origin = "chrome-extension://$ExtensionId/"
$obj = @{
  name = 'com.veo.automation.native'
  description = 'Flow Automation Local shutdown helper'
  path = $Exe
  type = 'stdio'
  allowed_origins = @($origin)
}
$obj | ConvertTo-Json -Depth 4 | Set-Content -Encoding UTF8 $Manifest

function Register-Host($root) {
  New-Item -Path $root -Force | Out-Null
  Set-Item -Path $root -Value $Manifest
}
if ($Browser -eq 'Chrome' -or $Browser -eq 'Both') {
  Register-Host 'HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.veo.automation.native'
}
if ($Browser -eq 'Edge' -or $Browser -eq 'Both') {
  Register-Host 'HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\com.veo.automation.native'
}
Write-Host "Installed Native Host for $Browser"
Write-Host "Allowed origin: $origin"
Write-Host "Restart browser, then press Test Native Host in the extension."
