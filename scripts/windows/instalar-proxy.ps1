# Instala o gravador + proxy local do Grade Agora TV para rodar escondido e iniciar
# junto com o Windows. Grava os agendamentos mesmo com o site fechado.
$ErrorActionPreference = 'Stop'
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repo = Resolve-Path (Join-Path $dir '..\..')
$vbs = Join-Path $dir 'proxy-oculto.vbs'

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host 'Node.js nao encontrado. Instale em https://nodejs.org e rode de novo.' -ForegroundColor Red
  exit 1
}

# Para a versao que estiver rodando (para trocar pela nova).
Get-CimInstance Win32_Process |
  Where-Object { $_.CommandLine -like '*proxy-loop.cmd*' -or $_.CommandLine -like '*local-proxy.mjs*' -or $_.CommandLine -like '*local.mjs*' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 1

Write-Host 'Preparando o gravador (npm install + build)...'
Push-Location $repo
try {
  npm install --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { throw 'npm install falhou' }
  npm run build:local
  if ($LASTEXITCODE -ne 0) { throw 'build do gravador falhou' }
} finally {
  Pop-Location
}

# Atalho na pasta Inicializar do usuario (nao precisa de administrador).
$startup = [Environment]::GetFolderPath('Startup')
$lnk = Join-Path $startup 'Grade Agora Proxy.lnk'
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($lnk)
$shortcut.TargetPath = "$env:WINDIR\System32\wscript.exe"
$shortcut.Arguments = "`"$vbs`""
$shortcut.WorkingDirectory = $dir
$shortcut.Description = 'Gravador e proxy local do Grade Agora TV'
$shortcut.Save()

Start-Process -FilePath "$env:WINDIR\System32\wscript.exe" -ArgumentList "`"$vbs`""

$status = $null
for ($i = 0; $i -lt 20; $i++) {
  Start-Sleep -Seconds 1
  try {
    $status = Invoke-RestMethod -TimeoutSec 2 'http://127.0.0.1:8787/api/local/status'
    if ($status.ok) { break }
  } catch {}
}

if ($status -and $status.ok) {
  Write-Host ''
  Write-Host 'Gravador do PC instalado e rodando!' -ForegroundColor Green
  Write-Host "Gravacoes vao para: $($status.outputDir)"
  Write-Host 'No site, em Ajustes > Endereco do proxy, use:'
  Write-Host '  http://127.0.0.1:8787/api/proxy' -ForegroundColor Cyan
  Write-Host 'Ele inicia sozinho, escondido, sempre que voce entrar no Windows.'
} else {
  Write-Host "O gravador nao respondeu. Veja o log em $env:LOCALAPPDATA\GradeAgoraProxy.log" -ForegroundColor Yellow
}
