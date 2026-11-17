@echo off
chcp 65001 >nul
setlocal EnableExtensions DisableDelayedExpansion
title ClipViral · Instalador para administradores

rem Arma el instalador de ClipViral para administradores:
rem con todo (Agente, Redes, Estadísticas); la primera vez crea la cuenta de administrador.
rem Nunca lleva tus datos: ni tu base de datos, ni server\.env, ni tu clave privada de licencias.

for /f %%e in ('echo prompt $E^| cmd') do set "ESC=%%e"
set "C0=%ESC%[0m"
set "CN=%ESC%[1m"
set "CC=%ESC%[96m"
set "CG=%ESC%[92m"
set "CR=%ESC%[91m"

cd /d "%~dp0"
echo.
echo   %CN%%CC%►  ClipViral · instalador para administradores%C0%
echo.

where npm >nul 2>nul
if errorlevel 1 (
  echo   %CR%Falta Node.js en esta PC. Instálalo desde nodejs.org y vuelve a abrir este archivo.%C0%
  goto :fin
)
if not exist "desktop\node_modules" (
  echo   %CR%Falta instalar los módulos de la app. Abre una terminal en la carpeta desktop y escribe: npm install%C0%
  goto :fin
)
if not exist "server\node_modules" (
  echo   %CR%Falta instalar los módulos del servidor. Abre una terminal en la carpeta server y escribe: npm install%C0%
  goto :fin
)

echo   Armando el instalador... tarda unos minutos.
echo.
cd /d "%~dp0desktop"
call npm run instalador-admin
if errorlevel 1 (
  echo.
  echo   %CR%No se pudo armar el instalador. Mira los mensajes de arriba.%C0%
  goto :fin
)
echo.
echo   %CG%¡Listo!%C0% El instalador está en desktop$OUT
explorer "%~dp0desktop$OUT"

:fin
echo.
pause
