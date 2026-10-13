# Remove o proxy local do Grade Agora TV da inicializacao e encerra o que estiver rodando.
$startup = [Environment]::GetFolderPath('Startup')
Remove-Item (Join-Path $startup 'Grade Agora Proxy.lnk') -ErrorAction SilentlyContinue

Get-CimInstance Win32_Process |
  Where-Object { $_.CommandLine -like '*proxy-loop.cmd*' -or $_.CommandLine -like '*local-proxy.mjs*' -or $_.CommandLine -like '*local.mjs*' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

Write-Host 'Proxy local removido.' -ForegroundColor Green
