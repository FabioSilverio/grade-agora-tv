@echo off
rem Mantem o proxy local rodando: se ele cair, reinicia em 5 segundos.
rem Iniciado escondido por proxy-oculto.vbs (nao precisa abrir na mao).
cd /d "%~dp0..\.."
set LOG=%LOCALAPPDATA%\GradeAgoraProxy.log
:loop
node server\local-proxy.mjs >> "%LOG%" 2>&1
if %errorlevel%==3 exit /b 0
timeout /t 5 /nobreak >nul
goto loop
