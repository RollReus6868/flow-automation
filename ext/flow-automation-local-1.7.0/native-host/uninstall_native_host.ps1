$paths = @(
  'HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.veo.automation.native',
  'HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\com.veo.automation.native'
)
foreach($p in $paths){ if(Test-Path $p){ Remove-Item $p -Recurse -Force } }
Write-Host 'Native Host registry entries removed.'
