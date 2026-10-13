# Instala o proxy local do Grade Agora TV para iniciar escondido junto com o Windows.
$ErrorActionPreference = 'Stop'
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
$vbs = Join-Path $dir 'proxy-oculto.vbs'

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host 'Node.js nao encontrado. Instale em https://nodejs.org e rode de novo.' -ForegroundColor Red
  exit 1
}

# Atalho na pasta Inicializar do usuario (nao precisa de administrador).
$startup = [Environment]::GetFolderPath('Startup')
$lnk = Join-Path $startup 'Grade Agora Proxy.lnk'
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($lnk)
$shortcut.TargetPath = "$env:WINDIR\System32\wscript.exe"
$shortcut.Arguments = "`"$vbs`""
$shortcut.WorkingDirectory = $dir
$shortcut.Description = 'Proxy local do Grade Agora TV'
$shortcut.Save()

# Inicia agora (se ja estiver rodando, a segunda copia sai sozinha).
Start-Process -FilePath "$env:WINDIR\System32\wscript.exe" -ArgumentList "`"$vbs`""

$ok = $false
for ($i = 0; $i -lt 15; $i++) {
  Start-Sleep -Seconds 1
  try {
    $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 'http://127.0.0.1:8787/'
    if ($r.Content -like '*proxy local ativo*') { $ok = $true; break }
  } catch {}
}

if ($ok) {
  Write-Host ''
  Write-Host 'Proxy local instalado e rodando!' -ForegroundColor Green
  Write-Host 'Endereco para colocar no site (Ajustes > Endereco do proxy):'
  Write-Host '  http://127.0.0.1:8787/api/proxy' -ForegroundColor Cyan
  Write-Host 'Ele inicia sozinho, escondido, sempre que voce entrar no Windows.'
} else {
  Write-Host "O proxy nao respondeu. Veja o log em $env:LOCALAPPDATA\GradeAgoraProxy.log" -ForegroundColor Yellow
}
