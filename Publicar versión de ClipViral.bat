@echo off
chcp 65001 >nul
setlocal EnableExtensions DisableDelayedExpansion
title ClipViral · Publicar versión

rem Arma el instalador único de ClipViral (conectado a tu VPS) y lo sube al VPS como actualización.
rem Las apps instaladas avisan solas que hay versión nueva y la descargan desde la misma app.
rem Nunca lleva tus datos: ni tu base de datos, ni server\.env, ni tus claves.

for /f %%e in ('echo prompt $E^| cmd') do set "ESC=%%e"
set "C0=%ESC%[0m"
set "CN=%ESC%[1m"
set "CC=%ESC%[96m"
set "CR=%ESC%[91m"

cd /d "%~dp0"
echo.
echo   %CN%%CC%►  ClipViral · publicar versión nueva%C0%

where node >nul 2>nul
if errorlevel 1 (
  echo   %CR%Falta Node.js en esta PC. Instálalo desde nodejs.org y vuelve a abrir este archivo.%C0%
  goto :fin
)
if not exist "desktop\node_modules" (
  echo   %CR%Falta instalar los módulos de la app. Abre "Iniciar ClipViral.bat" una vez y vuelve a abrir este archivo.%C0%
  goto :fin
)
node server\scripts\publicar-version.js %*

:fin
echo.
pause
